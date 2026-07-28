const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const DateUtil = require('../utils/DateUtil');

class FileBatchRepository {
  async markStarted(auditId, batchNo, fileName, startIndex, endIndex, totalRecords) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const existing = await db.run(
      SELECT.one.from('mobi.db.MOBI_DB_FILEBATCH').where({ AUDIT_ID: auditId, BATCH_NO: batchNo })
    );

    const payload = {
      STATUS: 'PROCESSING',
      START_INDEX: startIndex,
      END_INDEX: endIndex,
      TOTAL_RECORDS: totalRecords,
      START_TIME: now,
      END_TIME: now,
      ERROR_DETAIL: ''
    };

    if (existing) {
      await db.run(UPDATE('mobi.db.MOBI_DB_FILEBATCH').set(payload)
        .where({ AUDIT_ID: auditId, BATCH_NO: batchNo }));
      return;
    }

    await db.run(INSERT.into('mobi.db.MOBI_DB_FILEBATCH').entries({
      AUDIT_ID: auditId, BATCH_NO: batchNo, FILE_NAME: fileName,
      SUCCESS_COUNT: 0, ERROR_COUNT: 0, ...payload
    }));
  }

  async markCompleted(auditId, batchNo, successCount, errorCount, errorDetail = '') {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const status = errorCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    await db.run(UPDATE('mobi.db.MOBI_DB_FILEBATCH').set({
      STATUS: status,
      SUCCESS_COUNT: successCount,
      ERROR_COUNT: errorCount,
      END_TIME: now,
      ERROR_DETAIL: String(errorDetail || '').substring(0, 255)
    }).where({ AUDIT_ID: auditId, BATCH_NO: batchNo }));
  }
}

module.exports = FileBatchRepository;
