const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * Persistence for consolidation header + line items.
 * Posting status is stored as a 2-digit code ('02'=PENDING, '03'=POSTED, '07'=FAILED).
 */
class ConsolidationRepository {
  async findConsolRefsByPrefix(prefix) {
    const db = await cds.connect.to('db');
    return db.run(SELECT.from(EntityNames.CONSOLIDATION_HEADER).columns('CONSOL_REF_ID')
      .where({ CONSOL_REF_ID: { like: `${prefix}%` } }));
  }
  async findSapRefsByPrefix(prefix) {
    const db = await cds.connect.to('db');
    return db.run(SELECT.from(EntityNames.CONSOLIDATION_HEADER).columns('SAP_REF_DOCUMENT')
      .where({ SAP_REF_DOCUMENT: { like: `${prefix}%` } }));
  }
  async insertDocuments(documents) {
    if (!documents?.length) return { headersInserted:0, lineItemsInserted:0 };
    const db = await cds.connect.to('db');
    const headers = documents.map((d) => d.header);
    const lineItems = documents.flatMap((d) => d.lineItems);
    await db.run(INSERT.into(EntityNames.CONSOLIDATION_HEADER).entries(headers));
    if (lineItems.length) {
      await db.run(INSERT.into(EntityNames.CONSOLIDATION_LINE_ITEM).entries(lineItems));
    }
    return { headersInserted: headers.length, lineItemsInserted: lineItems.length };
  }
  async updatePostingResult(consolRefId, result, changedBy = Constants.SYSTEM_USER) {
    if (!consolRefId) throw new Error('CONSOL_REF_ID is required to update posting result');
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const postingStatus = this._normalizePostingStatus(result);
    const existing = await db.run(
      SELECT.one.from(EntityNames.CONSOLIDATION_HEADER)
        .columns('RETRY_COUNT','POSTING_STATUS','SAP_REF_DOCUMENT')
        .where({ CONSOL_REF_ID: consolRefId })
    );
    if (!existing) throw new Error(`Consolidation reference ${consolRefId} not found`);

    const isFailed = postingStatus === '07';  // POSTING_FAILED
    const isPosted = postingStatus === '03';  // POSTED
    const sapRef = NormalizeUtil.text(result.sapRefDocument) || existing.SAP_REF_DOCUMENT || null;

    const payload = {
      SAP_REF_DOCUMENT: sapRef,
      POSTING_STATUS: postingStatus,
      POST_DATE: now,
      HTTP_STATUS: result.httpStatus ?? null,
      ERROR_CODE: isPosted ? null
        : (NormalizeUtil.text(result.errorCode) || (isFailed ? Constants.ERROR_CODES.POSTING_FAILED : null)),
      ERROR_DETAIL: isPosted ? null
        : (result.errorDetail ? String(result.errorDetail).substring(0,255) : null),
      RETRY_COUNT: isFailed
        ? Number(existing.RETRY_COUNT || 0) + 1
        : Number(existing.RETRY_COUNT || 0)
    };
    await db.run(UPDATE(EntityNames.CONSOLIDATION_HEADER).set(payload).where({ CONSOL_REF_ID: consolRefId }));
    await db.run(UPDATE(EntityNames.CONSOLIDATION_LINE_ITEM).set(payload).where({ CONSOL_REF_ID: consolRefId }));
    return { consolRefId, postingStatus, payload };
  }
  _normalizePostingStatus(result = {}) {
    const status = String(result.postingStatus || '').trim().toUpperCase();
    if (['POSTED','SUCCESS','S','03'].includes(status)) return '03';
    if (['POSTING_FAILED','FAILED','ERROR','E','07'].includes(status)) return '07';
    if (result.sapRefDocument && !result.errorCode && !result.errorDetail) return '03';
    if (['POSTING_PENDING','PENDING','02'].includes(status)) return '02';
    return '07';
  }
}
module.exports = ConsolidationRepository;
