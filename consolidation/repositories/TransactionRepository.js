const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * Transaction access for consolidation.
 * Note: ROW_STATUS, CONSOL_STATUS are now 2-digit codes.
 */
class TransactionRepository {
  async findCandidates(scenario, { companyCode, postingDate } = {}) {
    const db = await cds.connect.to('db');
    const retryableStatuses = (scenario.retryableConsolStatuses || ['01']).map((s) => String(s).trim());
    const alwaysRetry = new Set(retryableStatuses.filter((s) => s !== '01'));

    const where = {
      ROW_STATUS: '01',       // VALID
      CONSOL_STATUS: { in: retryableStatuses },
      PAYMENT_TYPE:  { in: scenario.paymentTypeAliases },
      PAYMENT_SUB_TYPE: { in: scenario.paymentSubTypeAliases }
    };
    if (companyCode) {
      where.COMPANY_CODE = String(companyCode).trim();
    } else if (scenario.allowedCompanyCodes?.length) {
      where.COMPANY_CODE = { in: scenario.allowedCompanyCodes };
    }
    const rows = await db.run(SELECT.from(EntityNames.TRANSACTION).where(where));
    const successStatuses = new Set(['01']);   // TXN_STATUS = SUCCESS
    const requestedDate = DateUtil.dbDate(postingDate);

    return (rows||[])
      .map((r) => this._normalizeRow(r))
      .filter((r) => successStatuses.has(NormalizeUtil.upper(r.TXN_STATUS)))
      .filter((r) => this._matchesPostingDateOrRetry(r, requestedDate, alwaysRetry))
      .map((r) => this._withPaymentCodes(r))
      .sort((a,b) => this._sortKey(a).localeCompare(this._sortKey(b)));
  }
  _matchesPostingDateOrRetry(row, requestedDate, alwaysRetry) {
    const status = NormalizeUtil.text(row.CONSOL_STATUS);
    if (alwaysRetry.has(status)) return true;
    if (!requestedDate) return true;
    return DateUtil.dbDate(row.TXN_CREATED_DATE) === requestedDate;
  }
  _normalizeRow(row) {
    return {
      ...row,
      COMPANY_CODE:      NormalizeUtil.text(row.COMPANY_CODE),
      MOBI_PORTAL_CODE:  NormalizeUtil.text(row.MOBI_PORTAL_CODE),
      MOBI_REFERENCE_ID: NormalizeUtil.text(row.MOBI_REFERENCE_ID),
      PAYMENT_TYPE:      NormalizeUtil.text(row.PAYMENT_TYPE),
      PAYMENT_SUB_TYPE:  NormalizeUtil.text(row.PAYMENT_SUB_TYPE),
      MERCHANT_ID:       NormalizeUtil.text(row.MERCHANT_ID),
      HOST_NAME:         NormalizeUtil.text(row.HOST_NAME),
      CONSOL_STATUS:     NormalizeUtil.text(row.CONSOL_STATUS),
      ROW_STATUS:        NormalizeUtil.text(row.ROW_STATUS),
      TXN_STATUS:        NormalizeUtil.text(row.TXN_STATUS)
    };
  }
  async markPostingPending(records, consolRefId, changedBy) {
    if (!records?.length) return 0;
    return this._updateTransactionGroups(records, {
      CONSOL_STATUS: Constants.CONSOL_STATUS.POSTING_PENDING,   // '02'
      CONSOL_REF_ID: consolRefId,
      ERROR_CODE: null, ERROR_DETAIL: null
    }, changedBy);
  }
  async markRecoverableError(records, { consolStatus, errorCode, errorDetailByTransaction = new Map() }, changedBy) {
    if (!records?.length) return 0;
    const grouped = new Map();
    for (const r of records) {
      const detail = String(errorDetailByTransaction.get(this.transactionKey(r)) || errorCode || consolStatus || 'CONSOL_ERROR').substring(0,500);
      const groupKey = [r.COMPANY_CODE, r.PAYMENT_TYPE, errorCode||'', detail].join('|');
      if (!grouped.has(groupKey)) grouped.set(groupKey, { records:[], errorDetail:detail, errorCode });
      grouped.get(groupKey).records.push(r);
    }
    let count = 0;
    for (const g of grouped.values()) {
      count += await this._updateTransactionGroups(g.records, {
        CONSOL_STATUS: consolStatus, ERROR_CODE: g.errorCode || errorCode, ERROR_DETAIL: g.errorDetail
      }, changedBy);
    }
    return count;
  }
  async updatePostingResultStatus(consolRefId, postingStatus, changedBy) {
    if (!consolRefId) return 0;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const consolStatus = postingStatus === '03' ? '03' : '07';
    await db.run(UPDATE(EntityNames.TRANSACTION).set({
      CONSOL_STATUS: consolStatus, CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
    }).where({ CONSOL_REF_ID: consolRefId }));
    return 1;
  }
  async _updateTransactionGroups(records, payload, changedBy) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const groups = new Map();
    for (const r of records) {
      const k = [r.COMPANY_CODE, r.PAYMENT_TYPE].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r.MOBI_REFERENCE_ID);
    }
    let count = 0;
    for (const [gk, refs] of groups.entries()) {
      const [companyCode, paymentType] = gk.split('|');
      const unique = [...new Set(refs)].filter(Boolean);
      for (let i=0;i<unique.length;i+=Constants.DB_CHUNK_SIZE) {
        const chunk = unique.slice(i,i+Constants.DB_CHUNK_SIZE);
        await db.run(UPDATE(EntityNames.TRANSACTION).set({
          ...payload, CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
        }).where({
          COMPANY_CODE: companyCode, PAYMENT_TYPE: paymentType, MOBI_REFERENCE_ID: { in: chunk }
        }));
        count += chunk.length;
      }
    }
    return count;
  }
  transactionKey(r) {
    return [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
  }
  _withPaymentCodes(r) {
    return { ...r,
      PAYMENT_TYPE_CODE: NormalizeUtil.paymentCode(r.PAYMENT_TYPE),
      PAYMENT_SUB_TYPE_CODE: NormalizeUtil.paymentCode(r.PAYMENT_SUB_TYPE)
    };
  }
  _sortKey(r) {
    return [
      r.COMPANY_CODE || '', r.MOBI_PORTAL_CODE || '',
      r.TXN_CREATED_DATE || '', r.TXN_CURRENCY || '',
      r.HOST_NAME || '', r.MERCHANT_ID || '', r.MOBI_REFERENCE_ID || ''
    ].join('|');
  }
}
module.exports = TransactionRepository;
