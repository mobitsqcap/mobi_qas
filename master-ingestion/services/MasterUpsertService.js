const DateUtil = require('../utils/DateUtil');

class MasterUpsertService {
  constructor(masterRepository) { this.masterRepository = masterRepository; }

  async upsertBatch(records, fileId, fileName, auditId) {
    if (!records.length) return;
    const now = DateUtil.nowTimestamp();
    const enriched = records.map((record, index) => ({
      ...record,
      AUDIT_ID:          auditId,
      FILE_ID:           fileId,
      FILE_NAME:         fileName,
      RECORD_NUMBER:     index + 1,
      POSTING_STATUS:    '01',    // ACTIVE
      STATUS_CODE:       '01',
      BP_CREATION_DATE:  now,
      CREATED_BY:        'System_SFTP',
      CREATED_TIMESTAMP: now,
      CHANGED_BY:        '',
      CHANGED_TIMESTAMP: ''
    }));
    await this.masterRepository.upsertBatch(enriched);
  }
}

module.exports = MasterUpsertService;
