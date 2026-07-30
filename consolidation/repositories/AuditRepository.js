'use strict';

/**
 * Consolidation AuditRepository — target schema: MOBI_DB_AUDIT.
 *
 * We write strict per-event rows (RUN / TRANSACTION / DOCUMENT / POSTING / PATCH).
 * STATUS_CODE is always a 3-digit global code from StatusCodeUtil.STATUS.
 * STATUS_MESSAGE holds human-readable detail.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const IdUtil = require('../utils/IdUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const SC = Object.freeze({
  STARTED: StatusCodeUtil.toCode('STARTED'),
  PROCESSING: StatusCodeUtil.toCode('PROCESSING'),
  COMPLETED: StatusCodeUtil.toCode('COMPLETED'),
  FAILED: StatusCodeUtil.toCode('FAILED'),
  PARTIAL: StatusCodeUtil.toCode('PARTIALLY_COMPLETED'),
  SUCCESS: StatusCodeUtil.toCode('SUCCESS'),
  POSTING_PENDING: StatusCodeUtil.toCode('POSTING_PENDING'),
  POSTED: StatusCodeUtil.toCode('POSTED'),
  POSTING_FAILED: StatusCodeUtil.toCode('POSTING_FAILED')
});

const PROCESS_NAME = Constants.AUDIT.PROCESS_NAME;

class AuditRepository {
  constructor({ softFail = false } = {}) { this.softFail = softFail; }

  async createRun({
    runId, scenarioCode, status = 'STARTED',
    totalRecords = 0, successCount = 0, errorCount = 0,
    errorCode = null, errorDetail = null, processStartAt = null,
    processEndAt = null, companyCode = null, paymentType = null,
    paymentSubType = null, changedBy = Constants.SYSTEM_USER
  }) {
    const now = DateUtil.nowTimestamp();
    const startTime = processStartAt || now;
    const statusCode = StatusCodeUtil.toCode(status, SC.STARTED);

    const message = [
      `Scenario=${scenarioCode || 'RUN'} started`,
      companyCode ? `company=${companyCode}` : null,
      paymentType ? `paymentType=${paymentType}` : null,
      paymentSubType ? `subType=${paymentSubType}` : null
    ].filter(Boolean).join(', ');

    const entry = {
      AUDIT_ID: IdUtil.uuid(),
      PROCESS_ID: runId,
      PROCESS_NAME: PROCESS_NAME,
      PROCESS_TYPE: Constants.AUDIT.PROCESS_TYPES.RUN,
      OBJECT_ID: scenarioCode || runId,
      OBJECT_NAME: scenarioCode ? `Consolidation ${scenarioCode}` : 'Consolidation Run',
      STATUS_CODE: statusCode,
      STATUS_MESSAGE: String(errorDetail || message).substring(0, 500),
      START_TIME: startTime,
      END_TIME: processEndAt || null,
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    };

    await this._insert([entry]);
    return entry;
  }

  async completeRun(runAuditId, {
    status, totalRecords, successCount, errorCount,
    errorCode = null, errorDetail = null, processEndAt = null, changedBy
  }) {
    if (!runAuditId) return null;
    return this._safe(async () => {
      const db = await cds.connect.to('db');
      const now = DateUtil.nowTimestamp();
      const endTime = processEndAt || now;
      const statusCode = StatusCodeUtil.toCode(status, SC.COMPLETED);

      const message = String(errorDetail || '')
        || buildRunCompletionMessage(status, totalRecords, successCount, errorCount);

      await db.run(UPDATE(EntityNames.AUDIT).set({
        STATUS_CODE: statusCode,
        STATUS_MESSAGE: message.substring(0, 500),
        END_TIME: endTime,
        CREATED_BY: changedBy,
        CREATED_TIMESTAMP: now
      }).where({ AUDIT_ID: runAuditId }));

      return { AUDIT_ID: runAuditId, STATUS_CODE: statusCode };
    });
  }

  async insertTransactionErrors({
    runId, scenarioCode, records,
    errorCodeByTransaction = new Map(),
    errorDetailByTransaction = new Map(),
    defaultErrorCode, defaultStatus = 'FAILED',
    processStartAt = null, changedBy
  }) {
    if (!records?.length) return 0;

    const now = DateUtil.nowTimestamp();
    const startTime = processStartAt || now;

    const entries = records.map((r) => {
      const key = this._txnKey(r);
      const logicalCode = errorCodeByTransaction.get(key) || defaultErrorCode;
      const detail = errorDetailByTransaction.get(key)
        || (logicalCode ? `Error: ${logicalCode}` : 'Error');
      const statusCode = mapErrorCodeToStatus(logicalCode, SC.FAILED);

      return {
        AUDIT_ID: IdUtil.uuid(),
        PROCESS_ID: runId,
        PROCESS_NAME: PROCESS_NAME,
        PROCESS_TYPE: Constants.AUDIT.PROCESS_TYPES.TRANSACTION,
        OBJECT_ID: r.MOBI_REFERENCE_ID || r.CONSOL_REF_ID || null,
        OBJECT_NAME: buildTransactionObjectName(r, scenarioCode),
        STATUS_CODE: statusCode,
        STATUS_MESSAGE: String(detail).substring(0, 500),
        START_TIME: startTime,
        END_TIME: now,
        CREATED_BY: changedBy,
        CREATED_TIMESTAMP: now
      };
    });

    await this._insert(entries);
    return entries.length;
  }

  async insertDocumentSuccesses({
    runId, scenarioCode, documents, processStartAt = null, changedBy
  }) {
    if (!documents?.length) return 0;

    const now = DateUtil.nowTimestamp();
    const startTime = processStartAt || now;
    const entries = [];

    for (const doc of documents) {
      const header = doc.header || {};
      const sources = doc.sourceTransactions || [];
      const refList = sources.map((s) => s.MOBI_REFERENCE_ID).filter(Boolean);

      const detail = refList.length > 1
        ? `Consolidated ${refList.length} transactions into ${header.CONSOL_REF_ID}`
        : `Consolidated ${header.CONSOL_REF_ID}`;

      entries.push({
        AUDIT_ID: IdUtil.uuid(),
        PROCESS_ID: runId,
        PROCESS_NAME: PROCESS_NAME,
        PROCESS_TYPE: Constants.AUDIT.PROCESS_TYPES.DOCUMENT,
        OBJECT_ID: header.CONSOL_REF_ID || null,
        OBJECT_NAME: `${scenarioCode || ''} Document ${header.CONSOL_REF_ID || ''}`.trim(),
        STATUS_CODE: SC.POSTING_PENDING,
        STATUS_MESSAGE: detail.substring(0, 500),
        START_TIME: startTime,
        END_TIME: now,
        CREATED_BY: changedBy,
        CREATED_TIMESTAMP: now
      });
    }

    await this._insert(entries);
    return entries.length;
  }

  async applyPostingResult({
    consolRefId, postingStatus, errorCode = null,
    errorDetail = null, sapRefDocument = null, changedBy
  }) {
    if (!consolRefId) return { updated: 0 };

    const now = DateUtil.nowTimestamp();
    const statusText = mapPostingStatusToText(postingStatus);
    const statusCode = StatusCodeUtil.toCode(statusText, SC.POSTING_FAILED);

    const statusMessage = statusCode === SC.POSTED
      ? (sapRefDocument ? `Posted SAP ${sapRefDocument}` : 'Posted').substring(0, 500)
      : String(errorDetail || errorCode || 'Posting failed').substring(0, 500);

    const db = await cds.connect.to('db');

    const existing = await db.run(
      SELECT.from(EntityNames.AUDIT).columns('AUDIT_ID')
        .where({ OBJECT_ID: consolRefId })
        .and({ PROCESS_NAME: PROCESS_NAME })
        .orderBy({ CREATED_TIMESTAMP: 'desc' })
    );

    const payload = {
      STATUS_CODE: statusCode,
      STATUS_MESSAGE: statusMessage,
      END_TIME: now,
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    };

    if (existing && existing.length) {
      const ids = existing.map((r) => r.AUDIT_ID).filter(Boolean);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await db.run(UPDATE(EntityNames.AUDIT).set(payload).where({ AUDIT_ID: { in: chunk } }));
      }
      return { updated: ids.length, status: statusText };
    }

    await this._insert([{
      AUDIT_ID: IdUtil.uuid(),
      PROCESS_ID: IdUtil.runId('POST'),
      PROCESS_NAME: PROCESS_NAME,
      PROCESS_TYPE: Constants.AUDIT.PROCESS_TYPES.POSTING,
      OBJECT_ID: consolRefId,
      OBJECT_NAME: `Posting result ${consolRefId}`,
      STATUS_CODE: statusCode,
      STATUS_MESSAGE: statusMessage,
      START_TIME: now,
      END_TIME: now,
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    }]);

    return { updated: 1, status: statusText, inserted: true };
  }

  async updatePatchAudit({ auditId, consolRefId, docRefItem, changedFields, changedBy }) {
    const now = DateUtil.nowTimestamp();
    const payload = {
      STATUS_CODE: SC.SUCCESS,
      STATUS_MESSAGE: `Line item ${docRefItem} patched: fields changed = ${Object.keys(changedFields || {}).join(', ')}`.substring(0, 500),
      END_TIME: now,
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    };

    if (auditId) {
      const db = await cds.connect.to('db');
      await db.run(UPDATE(EntityNames.AUDIT).set(payload).where({ AUDIT_ID: auditId }));
      return { updated: 1, auditId };
    }

    const db = await cds.connect.to('db');
    await db.run(INSERT.into(EntityNames.AUDIT).entries({
      AUDIT_ID: IdUtil.uuid(),
      PROCESS_ID: `PATCH-${consolRefId}-${docRefItem}`,
      PROCESS_NAME: PROCESS_NAME,
      PROCESS_TYPE: Constants.AUDIT.PROCESS_TYPES.PATCH,
      OBJECT_ID: `${consolRefId}/${docRefItem}`,
      OBJECT_NAME: `Patch ${consolRefId} item ${docRefItem}`,
      STATUS_CODE: payload.STATUS_CODE,
      STATUS_MESSAGE: payload.STATUS_MESSAGE,
      START_TIME: now,
      END_TIME: now,
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    }));
    return { inserted: true };
  }

  _txnKey(r) {
    return [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
  }

  async _insert(entries) {
    if (!entries?.length) return;
    return this._safe(async () => {
      const db = await cds.connect.to('db');
      for (let i = 0; i < entries.length; i += 200) {
        await db.run(INSERT.into(EntityNames.AUDIT).entries(entries.slice(i, i + 200)));
      }
    });
  }

  async _safe(fn) {
    try { return await fn(); }
    catch (error) {
      console.error('[AuditRepository]', error.stack || error.message);
      if (!this.softFail) throw error;
      return null;
    }
  }
}

function buildRunCompletionMessage(status, total, success, errors) {
  const s = String(status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'COMPLETED') {
    return `Completed: ${success || 0} consolidated of ${total || 0} total records`;
  }
  if (s === 'PARTIAL' || s === 'PARTIALLY_COMPLETED') {
    return `Partial run: ${success || 0} consolidated, ${errors || 0} recoverable errors of ${total || 0} total`;
  }
  if (s === 'ERROR' || s === 'FAILED') {
    return `Run failed: ${errors || 0} errors of ${total || 0} total records`;
  }
  return `Run ended with status ${status}`;
}

function buildTransactionObjectName(r, scenarioCode) {
  return scenarioCode || 'TXN';
}

function mapPostingStatusToText(postingStatus) {
  const s = String(postingStatus || '').trim().toUpperCase();
  if (['POSTED', 'SUCCESS', 'S', '03', StatusCodeUtil.toCode('POSTED')].includes(s)) return 'POSTED';
  if (['POSTING_PENDING', 'PENDING', '02', StatusCodeUtil.toCode('POSTING_PENDING')].includes(s)) return 'POSTING_PENDING';
  return 'POSTING_FAILED';
}

function mapErrorCodeToStatus(code, defaultCode) {
  if (!code) return defaultCode;
  const raw = String(code).trim().toUpperCase();

  if (/^\d{3}$/.test(raw) && StatusCodeUtil.toText(raw) !== raw) return raw;

  const mapped = Constants.ERROR_TO_STATUS_CODE[raw];
  if (mapped) return mapped;

  switch (raw) {
    case '04': return Constants.ERROR_TO_STATUS_CODE.GL_ACCOUNT_MISSING;
    case '05': return Constants.ERROR_TO_STATUS_CODE.BP_MASTER_MISSING;
    case '06': return Constants.ERROR_TO_STATUS_CODE.CONSOLIDATION_FAILED;
    case '07': return Constants.ERROR_TO_STATUS_CODE.POSTING_FAILED;
    case '09': return Constants.ERROR_TO_STATUS_CODE.MERCHANT_BP_MISSING;
    case '10': return Constants.ERROR_TO_STATUS_CODE.HOST_BP_MISSING;
  }

  const viaToCode = StatusCodeUtil.toCode(raw);
  if (viaToCode && /^\d{3}$/.test(viaToCode)) return viaToCode;

  return defaultCode;
}

module.exports = AuditRepository;
