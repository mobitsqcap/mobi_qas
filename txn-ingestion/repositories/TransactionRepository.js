'use strict';

const cds = require('@sap/cds');
const { SELECT, INSERT } = cds.ql;

const ENTITY = 'mobi.db.MOBI_DB_TRANSACTION';
const QUERY_CHUNK_SIZE = 500;

class TransactionRepository {
  async findExistingMobiReferenceIds(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const result = new Set();
    if (!unique.length) return result;

    const db = await cds.connect.to('db');
    for (let index = 0; index < unique.length; index += QUERY_CHUNK_SIZE) {
      const rows = await db.run(
        SELECT.from(ENTITY)
          .columns('MOBI_REFERENCE_ID')
          .where({ MOBI_REFERENCE_ID: { in: unique.slice(index, index + QUERY_CHUNK_SIZE) } })
      );
      for (const row of rows || []) result.add(String(row.MOBI_REFERENCE_ID));
    }
    return result;
  }

  async findHostReferenceDates(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const result = [];
    if (!unique.length) return result;

    const db = await cds.connect.to('db');
    for (let index = 0; index < unique.length; index += QUERY_CHUNK_SIZE) {
      const rows = await db.run(
        SELECT.from(ENTITY)
          .columns('HOST_REFERENCE_ID', 'TXN_CREATED_DATE', 'TXN_PAID_DATE')
          .where({ HOST_REFERENCE_ID: { in: unique.slice(index, index + QUERY_CHUNK_SIZE) } })
      );
      result.push(...(rows || []));
    }
    return result;
  }

  async insertBatch(records, runner = null) {
    if (!records?.length) return;
    const db = runner || await cds.connect.to('db');
    await db.run(INSERT.into(ENTITY).entries(records));
  }
}

module.exports = TransactionRepository;

// -----------------------------
// 'use strict';

// /**
//  * TransactionRepository.
//  *
//  * MOBI_DB_TRANSACTION has a single STATUS_CODE : String(20) column holding 3-digit
//  * global codes. Candidates are transactions with STATUS_CODE in the retryable set
//  * (041/053 + recoverable errors 055/056/057/058/059/062).
//  */

// const cds = require('@sap/cds');
// const { SELECT, UPDATE } = cds.ql;

// const EntityNames = require('../constants/EntityNames');
// const Constants = require('../constants/ConsolidationConstants');
// const DateUtil = require('../utils/DateUtil');
// const NormalizeUtil = require('../utils/NormalizeUtil');

// class TransactionRepository {
//   async findCandidates(scenario, { companyCode, postingDate } = {}) {
//     const db = await cds.connect.to('db');

//     const retryableStatuses = (scenario.retryableConsolStatuses || Constants.PENDING_CONSOL_STATUSES)
//       .map((s) => String(s).trim());

//     const DATE_SCOPED_STATUSES = new Set([
//       Constants.TXN_STATUS.SUCCESS,
//       Constants.CONSOL_STATUS.PENDING
//     ]);

//     const alwaysRetry = new Set(retryableStatuses.filter((s) => !DATE_SCOPED_STATUSES.has(s)));

//     const where = {
//       STATUS_CODE: { in: retryableStatuses },
//       PAYMENT_TYPE: { in: scenario.paymentTypeAliases },
//       PAYMENT_SUB_TYPE: { in: scenario.paymentSubTypeAliases }
//     };

//     if (companyCode) {
//       where.COMPANY_CODE = String(companyCode).trim();
//     } else if (scenario.allowedCompanyCodes?.length) {
//       where.COMPANY_CODE = { in: scenario.allowedCompanyCodes };
//     }

//     const rows = await db.run(SELECT.from(EntityNames.TRANSACTION).where(where));

//     const requestedDate = DateUtil.dbDate(postingDate);

//     return (rows || [])
//       .map((r) => this._normalizeRow(r))
//       .filter((r) => this._matchesPostingDateOrRetry(r, requestedDate, alwaysRetry))
//       .map((r) => this._withPaymentCodes(r))
//       .sort((a, b) => this._sortKey(a).localeCompare(this._sortKey(b)));
//   }

//   _matchesPostingDateOrRetry(row, requestedDate, alwaysRetry) {
//     const status = NormalizeUtil.text(row.STATUS_CODE);
//     if (alwaysRetry.has(status)) return true;
//     if (!requestedDate) return true;
//     return DateUtil.dbDate(row.TXN_CREATED_DATE) === requestedDate;
//   }

//   _normalizeRow(row) {
//     return {
//       ...row,
//       COMPANY_CODE: NormalizeUtil.text(row.COMPANY_CODE),
//       MOBI_PORTAL_CODE: NormalizeUtil.text(row.MOBI_PORTAL_CODE),
//       MOBI_REFERENCE_ID: NormalizeUtil.text(row.MOBI_REFERENCE_ID),
//       PAYMENT_TYPE: NormalizeUtil.text(row.PAYMENT_TYPE),
//       PAYMENT_SUB_TYPE: NormalizeUtil.text(row.PAYMENT_SUB_TYPE),
//       MERCHANT_ID: NormalizeUtil.text(row.MERCHANT_ID),
//       HOST_NAME: NormalizeUtil.text(row.HOST_NAME),
//       STATUS_CODE: NormalizeUtil.text(row.STATUS_CODE),
//       TXN_STATUS: NormalizeUtil.text(row.TXN_STATUS)
//     };
//   }

//   async markPostingPending(records, consolRefId, changedBy) {
//     if (!records?.length) return 0;
//     return this._updateTransactionGroups(records, {
//       STATUS_CODE: Constants.CONSOL_STATUS.POSTING_PENDING,
//       CONSOL_REF_ID: consolRefId
//     }, changedBy);
//   }

//   async markRecoverableError(records, consolStatusOrOpts, changedBy) {
//     let consolStatus;
//     if (consolStatusOrOpts && typeof consolStatusOrOpts === 'object') {
//       consolStatus = consolStatusOrOpts.consolStatus;
//     } else {
//       consolStatus = consolStatusOrOpts;
//     }
//     if (!records?.length || !consolStatus) return 0;

//     const groups = new Map();
//     for (const r of records) {
//       const k = [r.COMPANY_CODE, r.PAYMENT_TYPE].join('|');
//       if (!groups.has(k)) groups.set(k, []);
//       groups.get(k).push(r);
//     }

//     let count = 0;
//     for (const recs of groups.values()) {
//       count += await this._updateTransactionGroups(recs, {
//         STATUS_CODE: consolStatus
//       }, changedBy);
//     }
//     return count;
//   }

//   async updatePostingResultStatus(consolRefId, postingStatus, changedBy) {
//     if (!consolRefId) return 0;

//     const db = await cds.connect.to('db');
//     const now = DateUtil.nowTimestamp();

//     const txStatusCode = (String(postingStatus || '').trim() === Constants.POSTING_STATUS.POSTED)
//       ? Constants.CONSOL_STATUS.POSTED
//       : Constants.CONSOL_STATUS.POSTING_FAILED;

//     // Diagnostic: confirm transactions carry this CONSOL_REF_ID. It is stamped
//     // on the transactions during consolidation by markPostingPending. If none
//     // are found the UPDATE below is a no-op, which is the usual reason the
//     // transaction STATUS_CODE does not move to 061/062.
//     const linked = await db.run(
//       SELECT.from(EntityNames.TRANSACTION).columns('MOBI_REFERENCE_ID')
//         .where({ CONSOL_REF_ID: consolRefId }).limit(1)
//     );
//     if (!linked || !linked.length) {
//       console.warn(
//         `[TransactionRepository] updatePostingResultStatus: no transactions carry ` +
//         `CONSOL_REF_ID=${consolRefId}. Transaction STATUS_CODE will NOT change. ` +
//         `Ensure markPostingPending ran during consolidation (it sets CONSOL_REF_ID).`
//       );
//     }

//     await db.run(UPDATE(EntityNames.TRANSACTION).set({
//       STATUS_CODE: txStatusCode,
//       CHANGED_BY: changedBy,
//       CHANGED_TIMESTAMP: now
//     }).where({ CONSOL_REF_ID: consolRefId }));

//     return 1;
//   }

//   async _updateTransactionGroups(records, payload, changedBy) {
//     const db = await cds.connect.to('db');
//     const now = DateUtil.nowTimestamp();

//     const groups = new Map();
//     for (const r of records) {
//       const k = [r.COMPANY_CODE, r.PAYMENT_TYPE].join('|');
//       if (!groups.has(k)) groups.set(k, []);
//       groups.get(k).push(r.MOBI_REFERENCE_ID);
//     }

//     let count = 0;
//     for (const [gk, refs] of groups.entries()) {
//       const [companyCode, paymentType] = gk.split('|');
//       const unique = [...new Set(refs)].filter(Boolean);

//       for (let i = 0; i < unique.length; i += Constants.DB_CHUNK_SIZE) {
//         const chunk = unique.slice(i, i + Constants.DB_CHUNK_SIZE);
//         await db.run(UPDATE(EntityNames.TRANSACTION).set({
//           ...payload,
//           CHANGED_BY: changedBy,
//           CHANGED_TIMESTAMP: now
//         }).where({
//           COMPANY_CODE: companyCode,
//           PAYMENT_TYPE: paymentType,
//           MOBI_REFERENCE_ID: { in: chunk }
//         }));
//         count += chunk.length;
//       }
//     }
//     return count;
//   }

//   transactionKey(r) {
//     return [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
//   }

//   _withPaymentCodes(r) {
//     return {
//       ...r,
//       PAYMENT_TYPE_CODE: NormalizeUtil.paymentCode(r.PAYMENT_TYPE),
//       PAYMENT_SUB_TYPE_CODE: NormalizeUtil.paymentCode(r.PAYMENT_SUB_TYPE)
//     };
//   }

//   _sortKey(r) {
//     return [
//       r.COMPANY_CODE || '', r.MOBI_PORTAL_CODE || '',
//       r.TXN_CREATED_DATE || '', r.TXN_CURRENCY || '',
//       r.HOST_NAME || '', r.MERCHANT_ID || '', r.MOBI_REFERENCE_ID || ''
//     ].join('|');
//   }
// }

// module.exports = TransactionRepository;
