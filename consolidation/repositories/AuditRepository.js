/**
 * Consolidation AuditRepository – updated for per-record audit rows and PATCH tracking.
 */
const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

class AuditRepository {
  constructor({ softFail = false } = {}) { this.softFail = softFail; }

  async createRun({ runId, scenarioCode, status = 'STARTED',
                    totalRecords=0, successCount=0, errorCount=0,
                    errorCode=null, errorDetail=null, processStartAt=null,
                    processEndAt=null, companyCode=null, paymentType=null,
                    paymentSubType=null, changedBy = Constants.SYSTEM_USER }) {
    const now = DateUtil.nowTimestamp();
    const entry = {
      AUDIT_ID: require('../../utils/IdUtil').uuid(),
      RUN_ID: runId,
      FILE_NAME: `CONSOLIDATION${scenarioCode || 'RUN'}`,
      STATUS: status, STATUS_CODE: StatusCodeUtil.toCode('SYSTEM', status, '05'),
      TOTAL_RECORDS: totalRecords, SUCCESS_COUNT: successCount, ERROR_COUNT: errorCount,
      ERROR_CODE: errorCode || '', ERROR_DETAIL: errorDetail || '',
      PROCESS_START_AT: processStartAt || now, PROCESS_END_AT: processEndAt,
      CONSOL_REF_ID: null, MOBI_REFERENCE_ID: null,
      COMPANY_CODE: companyCode, MOBI_PORTAL_CODE: null,
      PAYMENT_TYPE: paymentType, PAYMENT_SUB_TYPE: paymentSubType,
      MERCHANT_ID: null, HOST_NAME: null,
      ERROR_FILE_PATH: null,
      CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
      CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
    };
    await this._insert([entry]);
    return entry;
  }

  async completeRun(runAuditId, { status, totalRecords, successCount, errorCount,
                                    errorCode=null, errorDetail=null,
                                    processEndAt=null, changedBy }) {
    if (!runAuditId) return null;
    return this._safe(async () => {
      const db = await cds.connect.to('db');
      const now = DateUtil.nowTimestamp();
      await db.run(UPDATE(EntityNames.AUDIT).set({
        STATUS: status, STATUS_CODE: StatusCodeUtil.toCode('SYSTEM', status, '04'),
        TOTAL_RECORDS: totalRecords, SUCCESS_COUNT: successCount, ERROR_COUNT: errorCount,
        ERROR_CODE: errorCode || '',
        ERROR_DETAIL: String(errorDetail || '').substring(0, 500),
        PROCESS_END_AT: processEndAt || now,
        CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
      }).where({ AUDIT_ID: runAuditId }));
      return { AUDIT_ID: runAuditId, STATUS: status };
    });
  }

  async insertTransactionErrors({ runId, scenarioCode, records,
                                   errorCodeByTransaction = new Map(),
                                   errorDetailByTransaction = new Map(),
                                   defaultErrorCode, defaultStatus = 'ERROR',
                                   processStartAt=null, changedBy }) {
    if (!records?.length) return 0;
    const now = DateUtil.nowTimestamp();
    const entries = records.map((r) => {
      const key = this._txnKey(r);
      const code = errorCodeByTransaction.get(key) || defaultErrorCode;
      const detail = errorDetailByTransaction.get(key) || code;
      return {
        AUDIT_ID: require('../../utils/IdUtil').uuid(),
        RUN_ID: runId,
        FILE_NAME: `CONSOLIDATION${scenarioCode}`,
        STATUS: 'ERROR', STATUS_CODE: '04',
        TOTAL_RECORDS:1, SUCCESS_COUNT:0, ERROR_COUNT:1,
        ERROR_CODE: code || '',
        ERROR_DETAIL: String(detail || '').substring(0, 500),
        PROCESS_START_AT: processStartAt || now, PROCESS_END_AT: now,
        CONSOL_REF_ID: r.CONSOL_REF_ID || null,
        MOBI_REFERENCE_ID: r.MOBI_REFERENCE_ID || null,
        COMPANY_CODE: r.COMPANY_CODE || null,
        MOBI_PORTAL_CODE: r.MOBI_PORTAL_CODE || null,
        PAYMENT_TYPE: r.PAYMENT_TYPE || null,
        PAYMENT_SUB_TYPE: r.PAYMENT_SUB_TYPE || null,
        MERCHANT_ID: r.MERCHANT_ID || null,
        HOST_NAME: r.HOST_NAME || null,
        CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
        CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
      };
    });
    await this._insert(entries);
    return entries.length;
  }

  async insertDocumentSuccesses({ runId, scenarioCode, documents, processStartAt=null, changedBy }) {
    if (!documents?.length) return 0;
    const now = DateUtil.nowTimestamp();
    const entries = [];
    for (const doc of documents) {
      const header = doc.header || {};
      const sources = doc.sourceTransactions || [];
      const first = sources[0] || {};
      const refList = sources.map((s) => s.MOBI_REFERENCE_ID).filter(Boolean);
      const detail = refList.length > 1
        ? `Consolidated ${refList.length} transactions into ${header.CONSOL_REF_ID}`
        : `Consolidated ${header.CONSOL_REF_ID}`;
      entries.push({
        AUDIT_ID: require('../../utils/IdUtil').uuid(), RUN_ID: runId,
        FILE_NAME: `CONSOLIDATION${scenarioCode}`,
        STATUS: 'POSTING_PENDING', STATUS_CODE: '02',
        TOTAL_RECORDS: sources.length || 1,
        SUCCESS_COUNT: sources.length || 1, ERROR_COUNT: 0,
        ERROR_CODE:'', ERROR_DETAIL: detail.substring(0,500),
        PROCESS_START_AT: processStartAt || now, PROCESS_END_AT: now,
        CONSOL_REF_ID: header.CONSOL_REF_ID || null,
        MOBI_REFERENCE_ID: first.MOBI_REFERENCE_ID || null,
        COMPANY_CODE: header.COMPANY_CODE || first.COMPANY_CODE || null,
        MOBI_PORTAL_CODE: header.MOBI_PORTAL_CODE || first.MOBI_PORTAL_CODE || null,
        PAYMENT_TYPE: header.PAYMENT_TYPE || first.PAYMENT_TYPE || null,
        PAYMENT_SUB_TYPE: header.PAYMENT_SUB_TYPE || first.PAYMENT_SUB_TYPE || null,
        MERCHANT_ID: first.MERCHANT_ID || null,
        HOST_NAME: first.HOST_NAME || null,
        CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
        CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
      });
    }
    await this._insert(entries);
    return entries.length;
  }

  async applyPostingResult({ consolRefId, postingStatus, errorCode=null,
                             errorDetail=null, sapRefDocument=null, changedBy }) {
    if (!consolRefId) return { updated: 0 };
    const now = DateUtil.nowTimestamp();
    const statusText = this._mapPostingToAuditStatus(postingStatus);
    const statusCode = StatusCodeUtil.toCode('POSTING', statusText, '07');
    const db = await cds.connect.to('db');
    const existing = await db.run(
      SELECT.from(EntityNames.AUDIT).columns('AUDIT_ID')
        .where({ CONSOL_REF_ID: consolRefId }).orderBy({ CREATED_TIMESTAMP: 'desc' })
    );
    const payload = {
      STATUS: statusText, STATUS_CODE: statusCode,
      ERROR_CODE: statusText === 'POSTED' ? null : (errorCode || '07'),
      ERROR_DETAIL: statusText === 'POSTED'
        ? (sapRefDocument ? `Posted SAP ${sapRefDocument}` : 'Posted').substring(0,500)
        : String(errorDetail || errorCode || '').substring(0,500),
      PROCESS_END_AT: now,
      SUCCESS_COUNT: statusText === 'POSTED' ? 1 : 0,
      ERROR_COUNT:   statusText === 'POSTING_FAILED' ? 1 : 0,
      CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
    };
    if (existing && existing.length) {
      const ids = existing.map((r) => r.AUDIT_ID).filter(Boolean);
      for (let i=0;i<ids.length;i+=500) {
        const chunk = ids.slice(i,i+500);
        await db.run(UPDATE(EntityNames.AUDIT).set(payload).where({ AUDIT_ID: { in: chunk } }));
      }
      return { updated: ids.length, status: statusText };
    }
    await this._insert([{
      AUDIT_ID: require('../../utils/IdUtil').uuid(),
      RUN_ID:   require('../../utils/IdUtil').runId('POST'),
      FILE_NAME:'POSTING_RESULT',
      STATUS: statusText, STATUS_CODE: statusCode,
      TOTAL_RECORDS:1, SUCCESS_COUNT: payload.SUCCESS_COUNT, ERROR_COUNT: payload.ERROR_COUNT,
      ERROR_CODE: payload.ERROR_CODE || '', ERROR_DETAIL: payload.ERROR_DETAIL || '',
      PROCESS_START_AT: now, PROCESS_END_AT: now,
      CONSOL_REF_ID: consolRefId,
      CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
      CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
    }]);
    return { updated:1, status: statusText, inserted:true };
  }

  /**
   * NEW: Track PATCH (line-item update) results in audit.
   */
  async updatePatchAudit({ auditId, consolRefId, docRefItem, changedFields, changedBy }) {
    const now = DateUtil.nowTimestamp();
    const payload = {
      STATUS: 'PATCHED', STATUS_CODE: '03', // using '03' as PATCH tracking code
      ERROR_CODE: '', ERROR_DETAIL: `Line item ${docRefItem} patched: fields changed = ${Object.keys(changedFields || {}).join(', ')}`.substring(0,500),
      CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
    };
    // If auditId is provided, update that audit record; otherwise insert a new audit entry for the patch
    if (auditId) {
      const db = await cds.connect.to('db');
      await db.run(UPDATE(EntityNames.AUDIT).set(payload).where({ AUDIT_ID: auditId }));
      return { updated: 1, auditId };
    }
    // Insert a dedicated audit row for the PATCH
    const db = await cds.connect.to('db');
    await db.run(INSERT.into(EntityNames.AUDIT).entries({
      AUDIT_ID: require('../../utils/IdUtil').uuid(),
      RUN_ID: `PATCH-${consolRefId}-${docRefItem}`,
      FILE_NAME: 'PATCH_RESULT',
      STATUS: 'PATCHED', STATUS_CODE: '03',
      TOTAL_RECORDS: 1, SUCCESS_COUNT: 1, ERROR_COUNT: 0,
      ERROR_CODE: '', ERROR_DETAIL: payload.ERROR_DETAIL,
      PROCESS_START_AT: now, PROCESS_END_AT: now,
      CONSOL_REF_ID: consolRefId,
      MOBI_REFERENCE_ID: null,
      COMPANY_CODE: null, MOBI_PORTAL_CODE: null,
      PAYMENT_TYPE: null, PAYMENT_SUB_TYPE: null,
      MERCHANT_ID: null, HOST_NAME: null,
      CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
      CHANGED_BY: '', CHANGED_TIMESTAMP: ''
    }));
    return { inserted: true };
  }

  _mapPostingToAuditStatus(postingStatus) {
    const s = String(postingStatus || '').trim().toUpperCase();
    if (['POSTED','SUCCESS','S','03'].includes(s)) return 'POSTED';
    if (['POSTING_PENDING','PENDING','02'].includes(s)) return 'POSTING_PENDING';
    return 'POSTING_FAILED';
  }

  _txnKey(r) {
    return [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
  }

  async _insert(entries) {
    if (!entries?.length) return;
    return this._safe(async () => {
      const db = await cds.connect.to('db');
      for (let i=0;i<entries.length;i+=200) {
        await db.run(INSERT.into(EntityNames.AUDIT).entries(entries.slice(i,i+200)));
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

module.exports = AuditRepository;
// const cds = require('@sap/cds');
// const { UPSERT, INSERT, UPDATE } = cds.ql;
// const EntityNames = require('../constants/EntityNames');
// const Constants   = require('../constants/ConsolidationConstants');
// const DateUtil    = require('../utils/DateUtil');
// const StatusCodeUtil = require('../utils/StatusCodeUtil');
// // 
// /**
//  * End-user facing audit trail for consolidation.
//  *
//  *  - All STATUS / ERROR_CODE fields are stored as 2-digit codes.
//  *  - ERROR_DETAIL is always human-readable text (operations view).
//  *  - Every failure updates the audit log (even partial failures).
//  */
// class AuditRepository {
//   constructor({ softFail = false } = {}) { this.softFail = softFail; }

//   async createRun({ runId, scenarioCode, status = 'STARTED',
//                     totalRecords=0, successCount=0, errorCount=0,
//                     errorCode=null, errorDetail=null, processStartAt=null,
//                     processEndAt=null, companyCode=null, paymentType=null,
//                     paymentSubType=null, changedBy = Constants.SYSTEM_USER }) {
//     const now = DateUtil.nowTimestamp();
//     const entry = {
//       AUDIT_ID: require('../utils/IdUtil').uuid(),
//       RUN_ID: runId,
//       FILE_NAME: `CONSOLIDATION${scenarioCode || 'RUN'}`,
//       STATUS: status, STATUS_CODE: StatusCodeUtil.toCode('SYSTEM', status, '05'),
//       TOTAL_RECORDS: totalRecords, SUCCESS_COUNT: successCount, ERROR_COUNT: errorCount,
//       ERROR_CODE: errorCode || '', ERROR_DETAIL: errorDetail || '',
//       PROCESS_START_AT: processStartAt || now, PROCESS_END_AT: processEndAt,
//       CONSOL_REF_ID: null, MOBI_REFERENCE_ID: null,
//       COMPANY_CODE: companyCode, MOBI_PORTAL_CODE: null,
//       PAYMENT_TYPE: paymentType, PAYMENT_SUB_TYPE: paymentSubType,
//       MERCHANT_ID: null, HOST_NAME: null,
//       ERROR_FILE_PATH: null,
//       CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
//       CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
//     };
//     await this._insert([entry]);
//     return entry;
//   }

//   async completeRun(runAuditId, { status, totalRecords, successCount, errorCount,
//                                     errorCode=null, errorDetail=null,
//                                     processEndAt=null, changedBy }) {
//     if (!runAuditId) return null;
//     return this._safe(async () => {
//       const db = await cds.connect.to('db');
//       const now = DateUtil.nowTimestamp();
//       await db.run(UPDATE(EntityNames.AUDIT).set({
//         STATUS: status, STATUS_CODE: StatusCodeUtil.toCode('SYSTEM', status, '04'),
//         TOTAL_RECORDS: totalRecords, SUCCESS_COUNT: successCount, ERROR_COUNT: errorCount,
//         ERROR_CODE: errorCode || '',
//         ERROR_DETAIL: String(errorDetail || '').substring(0, 500),
//         PROCESS_END_AT: processEndAt || now,
//         CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
//       }).where({ AUDIT_ID: runAuditId }));
//       return { AUDIT_ID: runAuditId, STATUS: status };
//     });
//   }

//   async insertTransactionErrors({ runId, scenarioCode, records,
//                                    errorCodeByTransaction = new Map(),
//                                    errorDetailByTransaction = new Map(),
//                                    defaultErrorCode, defaultStatus = 'ERROR',
//                                    processStartAt=null, changedBy }) {
//     if (!records?.length) return 0;
//     const now = DateUtil.nowTimestamp();
//     const entries = records.map((r) => {
//       const key = this._txnKey(r);
//       const code = errorCodeByTransaction.get(key) || defaultErrorCode;
//       const detail = errorDetailByTransaction.get(key) || code;
//       return {
//         AUDIT_ID: require('../utils/IdUtil').uuid(),
//         RUN_ID: runId,
//         FILE_NAME: `CONSOLIDATION${scenarioCode}`,
//         STATUS: 'ERROR', STATUS_CODE: '04',
//         TOTAL_RECORDS:1, SUCCESS_COUNT:0, ERROR_COUNT:1,
//         ERROR_CODE: code || '',
//         ERROR_DETAIL: String(detail || '').substring(0, 500),
//         PROCESS_START_AT: processStartAt || now, PROCESS_END_AT: now,
//         CONSOL_REF_ID: r.CONSOL_REF_ID || null,
//         MOBI_REFERENCE_ID: r.MOBI_REFERENCE_ID || null,
//         COMPANY_CODE: r.COMPANY_CODE || null,
//         MOBI_PORTAL_CODE: r.MOBI_PORTAL_CODE || null,
//         PAYMENT_TYPE: r.PAYMENT_TYPE || null,
//         PAYMENT_SUB_TYPE: r.PAYMENT_SUB_TYPE || null,
//         MERCHANT_ID: r.MERCHANT_ID || null,
//         HOST_NAME: r.HOST_NAME || null,
//         CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
//         CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
//       };
//     });
//     await this._insert(entries);
//     return entries.length;
//   }

//   async insertDocumentSuccesses({ runId, scenarioCode, documents, processStartAt=null, changedBy }) {
//     if (!documents?.length) return 0;
//     const now = DateUtil.nowTimestamp();
//     const entries = [];
//     for (const doc of documents) {
//       const header = doc.header || {};
//       const sources = doc.sourceTransactions || [];
//       const first = sources[0] || {};
//       const refList = sources.map((s) => s.MOBI_REFERENCE_ID).filter(Boolean);
//       const detail = refList.length > 1
//         ? `Consolidated ${refList.length} transactions into ${header.CONSOL_REF_ID}`
//         : `Consolidated ${header.CONSOL_REF_ID}`;
//       entries.push({
//         AUDIT_ID: require('../utils/IdUtil').uuid(), RUN_ID: runId,
//         FILE_NAME: `CONSOLIDATION${scenarioCode}`,
//         STATUS: 'POSTING_PENDING', STATUS_CODE: '02',
//         TOTAL_RECORDS: sources.length || 1,
//         SUCCESS_COUNT: sources.length || 1, ERROR_COUNT: 0,
//         ERROR_CODE:'', ERROR_DETAIL: detail.substring(0,500),
//         PROCESS_START_AT: processStartAt || now, PROCESS_END_AT: now,
//         CONSOL_REF_ID: header.CONSOL_REF_ID || null,
//         MOBI_REFERENCE_ID: first.MOBI_REFERENCE_ID || null,
//         COMPANY_CODE: header.COMPANY_CODE || first.COMPANY_CODE || null,
//         MOBI_PORTAL_CODE: header.MOBI_PORTAL_CODE || first.MOBI_PORTAL_CODE || null,
//         PAYMENT_TYPE: header.PAYMENT_TYPE || first.PAYMENT_TYPE || null,
//         PAYMENT_SUB_TYPE: header.PAYMENT_SUB_TYPE || first.PAYMENT_SUB_TYPE || null,
//         MERCHANT_ID: first.MERCHANT_ID || null,
//         HOST_NAME: first.HOST_NAME || null,
//         CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
//         CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
//       });
//     }
//     await this._insert(entries);
//     return entries.length;
//   }

//   async applyPostingResult({ consolRefId, postingStatus, errorCode=null,
//                              errorDetail=null, sapRefDocument=null, changedBy }) {
//     if (!consolRefId) return { updated: 0 };
//     const now = DateUtil.nowTimestamp();
//     const statusText = this._mapPostingToAuditStatus(postingStatus);
//     const statusCode = StatusCodeUtil.toCode('POSTING', statusText, '07');
//     const db = await cds.connect.to('db');
//     const existing = await db.run(
//       SELECT.from(EntityNames.AUDIT).columns('AUDIT_ID')
//         .where({ CONSOL_REF_ID: consolRefId }).orderBy({ CREATED_TIMESTAMP: 'desc' })
//     );
//     const payload = {
//       STATUS: statusText, STATUS_CODE: statusCode,
//       ERROR_CODE: statusText === 'POSTED' ? null : (errorCode || '07'),
//       ERROR_DETAIL: statusText === 'POSTED'
//         ? (sapRefDocument ? `Posted SAP ${sapRefDocument}` : 'Posted').substring(0,500)
//         : String(errorDetail || errorCode || '').substring(0,500),
//       PROCESS_END_AT: now,
//       SUCCESS_COUNT: statusText === 'POSTED' ? 1 : 0,
//       ERROR_COUNT:   statusText === 'POSTING_FAILED' ? 1 : 0,
//       CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
//     };
//     if (existing && existing.length) {
//       const ids = existing.map((r) => r.AUDIT_ID).filter(Boolean);
//       for (let i=0;i<ids.length;i+=500) {
//         const chunk = ids.slice(i,i+500);
//         await db.run(UPDATE(EntityNames.AUDIT).set(payload).where({ AUDIT_ID: { in: chunk } }));
//       }
//       return { updated: ids.length, status: statusText };
//     }
//     await this._insert([{
//       AUDIT_ID: require('../utils/IdUtil').uuid(),
//       RUN_ID:   require('../utils/IdUtil').runId('POST'),
//       FILE_NAME:'POSTING_RESULT',
//       STATUS: statusText, STATUS_CODE: statusCode,
//       TOTAL_RECORDS:1, SUCCESS_COUNT: payload.SUCCESS_COUNT, ERROR_COUNT: payload.ERROR_COUNT,
//       ERROR_CODE: payload.ERROR_CODE || '', ERROR_DETAIL: payload.ERROR_DETAIL || '',
//       PROCESS_START_AT: now, PROCESS_END_AT: now,
//       CONSOL_REF_ID: consolRefId,
//       CREATED_BY: changedBy, CREATED_TIMESTAMP: now,
//       CHANGED_BY: changedBy, CHANGED_TIMESTAMP: now
//     }]);
//     return { updated:1, status: statusText, inserted:true };
//   }

//   _mapPostingToAuditStatus(postingStatus) {
//     const s = String(postingStatus || '').trim().toUpperCase();
//     if (['POSTED','SUCCESS','S','03'].includes(s)) return 'POSTED';
//     if (['POSTING_PENDING','PENDING','02'].includes(s)) return 'POSTING_PENDING';
//     return 'POSTING_FAILED';
//   }

//   _txnKey(r) {
//     return [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
//   }
//   async _insert(entries) {
//     if (!entries?.length) return;
//     return this._safe(async () => {
//       const db = await cds.connect.to('db');
//       for (let i=0;i<entries.length;i+=200) {
//         await db.run(INSERT.into(EntityNames.AUDIT).entries(entries.slice(i,i+200)));
//       }
//     });
//   }
//   async _safe(fn) {
//     try { return await fn(); }
//     catch (error) {
//       console.error('[AuditRepository]', error.stack || error.message);
//       if (!this.softFail) throw error;
//       return null;
//     }
//   }
// }

// module.exports = AuditRepository;
