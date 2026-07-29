const cds = require('@sap/cds');
const { UPSERT, UPDATE } = cds.ql;
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');

class AuditRepository {
  async start({ auditId, runId, fileName }) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    await db.run(UPSERT.into('mobi.db.MOBI_DB_AUDIT').entries({
      AUDIT_ID: auditId,
      RUN_ID: runId || '',
      FILE_NAME: fileName || '',
      STATUS: 'PROCESSING',
      TOTAL_RECORDS: 0,
      SUCCESS_COUNT: 0,
      ERROR_COUNT: 0,
      ERROR_CODE: '',
      ERROR_DETAIL: '',
      PROCESS_START_AT: now,
      PROCESS_END_AT: now,
      CREATED_BY: 'SYSTEM_SFTP',
      CREATED_TIMESTAMP: now,
      CHANGED_BY: '',
      CHANGED_TIMESTAMP: ''
    }));
  }

  async updateProgress(auditId, stats = {}) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    await db.run(UPDATE('mobi.db.MOBI_DB_AUDIT').set({
      TOTAL_RECORDS: stats.totalRows ?? 0,
      SUCCESS_COUNT: stats.validCount ?? 0,
      ERROR_COUNT: stats.errorCount ?? 0,
      CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId }));
  }

  async complete(auditId, result, changedBy, options = {}) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const status = options.statusOverride || (result.validCount > 0 && result.errorCount > 0 ? 'PARTIALLY_PROCESSED' : result.validCount > 0 ? 'COMPLETED' : 'FAILED');

    await db.run(UPDATE('mobi.db.MOBI_DB_AUDIT').set({
      STATUS: status,
      TOTAL_RECORDS: result.totalRows ?? 0,
      SUCCESS_COUNT: result.validCount ?? 0,
      ERROR_COUNT: result.errorCount ?? 0,
      ERROR_CODE: options.errorCode !== undefined ? options.errorCode : result.errorCount > 0 ? 'ROW_VALIDATION_FAILED' : '',
      ERROR_DETAIL: String(options.errorDetail || '').substring(0, 255),
      PROCESS_END_AT: now,
      CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId }));
  }

  async fail(auditId, error, counts = {}) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    await db.run(UPDATE('mobi.db.MOBI_DB_AUDIT').set({
      STATUS: 'FAILED',
      TOTAL_RECORDS: counts.totalRows ?? 0,
      SUCCESS_COUNT: counts.validCount ?? 0,
      ERROR_COUNT: counts.errorCount ?? 0,
      ERROR_CODE: error?.code || 'FILE_PROCESSING_ERROR',
      ERROR_DETAIL: String(error?.message || '').substring(0, 255),
      PROCESS_END_AT: now,
      CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId }));
  }
}

module.exports = AuditRepository;
