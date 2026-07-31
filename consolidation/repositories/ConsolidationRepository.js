'use strict';

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const SC_POSTED = Constants.POSTING_STATUS.POSTED;
const SC_POSTING_FAILED = Constants.POSTING_STATUS.POSTING_FAILED;
const SC_POSTING_PENDING = Constants.POSTING_STATUS.POSTING_PENDING;
const SC_CONSOL_PENDING = Constants.POSTING_STATUS.CONSOLIDATION_PENDING;

class ConsolidationRepository {
  async findConsolRefsByPrefix(prefix) {
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.from(EntityNames.CONSOLIDATION_HEADER).columns('CONSOL_REF_ID')
        .where({ CONSOL_REF_ID: { like: `${prefix}%` } })
    );
  }

  async findSapRefsByPrefix(prefix) {
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.from(EntityNames.CONSOLIDATION_HEADER).columns('SAP_REF_DOCUMENT')
        .where({ SAP_REF_DOCUMENT: { like: `${prefix}%` } })
    );
  }

  async insertDocuments(documents) {
    if (!documents?.length) return { headersInserted: 0, lineItemsInserted: 0 };

    const db = await cds.connect.to('db');
    const headers = documents.map((d) => d.header);
    const lineItems = documents.flatMap((d) => d.lineItems);

    await db.run(INSERT.into(EntityNames.CONSOLIDATION_HEADER).entries(headers));

    if (lineItems.length) {
      await db.run(INSERT.into(EntityNames.CONSOLIDATION_LINE_ITEM).entries(lineItems));
    }

    return { headersInserted: headers.length, lineItemsInserted: lineItems.length };
  }

  /**
   * Update HEADER+LINE_ITEM STATUS_CODE and related fields after a posting
   * callback from SAP/CPI.
   *
   * @param {string} consolRefId
   * @param {object} result - { sapRefDocument, postingStatus, httpStatus, errorCode?, errorDetail? }
   * @param {string} changedBy
   */
  async updatePostingResult(consolRefId, result, changedBy = Constants.SYSTEM_USER) {
    if (!consolRefId) throw new Error('CONSOL_REF_ID is required to update posting result');

    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusCode = this._normalizeStatusCode(result);

    const existing = await db.run(
      SELECT.one.from(EntityNames.CONSOLIDATION_HEADER)
        .columns('RETRY_COUNT', 'STATUS_CODE', 'SAP_REF_DOCUMENT')
        .where({ CONSOL_REF_ID: consolRefId })
    );

    if (!existing) throw new Error(`Consolidation reference ${consolRefId} not found`);

    const isFailed = statusCode === SC_POSTING_FAILED;
    const sapRef = NormalizeUtil.text(result.sapRefDocument)
      || existing.SAP_REF_DOCUMENT || null;

    const payload = {
      SAP_REF_DOCUMENT: sapRef,
      STATUS_CODE: statusCode,
      POST_DATE: now,
      HTTP_STATUS: result.httpStatus ?? null,
      RETRY_COUNT: isFailed
        ? Number(existing.RETRY_COUNT || 0) + 1
        : Number(existing.RETRY_COUNT || 0)
    };

    await db.run(UPDATE(EntityNames.CONSOLIDATION_HEADER).set(payload).where({ CONSOL_REF_ID: consolRefId }));

    const linePayload = {
      SAP_REF_DOCUMENT: sapRef,
      STATUS_CODE: statusCode,
      POST_DATE: now,
      HTTP_STATUS: result.httpStatus ?? null
    };
    await db.run(UPDATE(EntityNames.CONSOLIDATION_LINE_ITEM).set(linePayload).where({ CONSOL_REF_ID: consolRefId }));

    return { consolRefId, statusCode, payload };
  }

  _normalizeStatusCode(result = {}) {
    const raw = result.postingStatus;
    const status = String(raw || '').trim().toUpperCase();

    if (['POSTED', 'SUCCESS', 'S', '03', SC_POSTED].includes(status)) return SC_POSTED;
    if (['POSTING_FAILED', 'FAILED', 'ERROR', 'E', '07', SC_POSTING_FAILED].includes(status)) return SC_POSTING_FAILED;
    if (result.sapRefDocument && !result.errorCode && !result.errorDetail) return SC_POSTED;
    if (['POSTING_PENDING', 'PENDING', '02', SC_POSTING_PENDING].includes(status)) return SC_POSTING_PENDING;
    if (['CONSOLIDATION_PENDING', SC_CONSOL_PENDING].includes(status)) return SC_CONSOL_PENDING;

    if (/^\d{3}$/.test(status) && StatusCodeUtil.toText(status) !== status) {
      return status;
    }

    return SC_POSTING_FAILED;
  }
}

module.exports = ConsolidationRepository;
