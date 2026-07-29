const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const DateUtil = require('../utils/DateUtil');

class FileBatchRepository {
  async markStarted(auditId, batchNo, fileName, startIndex, endIndex, totalRecords) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const existing = await db.run(SELECT.one.from('mobi.db.MOBI_DB_FILEBATCH').where({ AUDIT_ID: auditId, BATCH_NO: batchNo }));

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
      await db.run(UPDATE('mobi.db.MOBI_DB_FILEBATCH').set(payload).where({ AUDIT_ID: auditId, BATCH_NO: batchNo }));
      return;
    }

    await db.run(INSERT.into('mobi.db.MOBI_DB_FILEBATCH').entries({
      AUDIT_ID: auditId,
      BATCH_NO: batchNo,
      FILE_NAME: fileName,
      SUCCESS_COUNT: 0,
      ERROR_COUNT: 0,
      ...payload
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

  async getCompletedBatchNos(auditId) {
    const db = await cds.connect.to('db');
    const rows = await db.run(SELECT.from('mobi.db.MOBI_DB_FILEBATCH').columns('BATCH_NO').where({ AUDIT_ID: auditId, STATUS: 'SUCCESS' }));
    return new Set((rows || []).map((row) => row.BATCH_NO));
  }

  async getSummary(auditId) {
    const db = await cds.connect.to('db');
    const rows = await db.run(SELECT.from('mobi.db.MOBI_DB_FILEBATCH').columns('SUCCESS_COUNT', 'ERROR_COUNT').where({ AUDIT_ID: auditId }));
    return (rows || []).reduce((summary, row) => {
      summary.validCount += Number(row.SUCCESS_COUNT || 0);
      summary.errorCount += Number(row.ERROR_COUNT || 0);
      return summary;
    }, { validCount: 0, errorCount: 0 });
  }
}

module.exports = FileBatchRepository;
