const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const { v4: uuid } = require('uuid');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const HashUtil = require('../utils/HashUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

class FileLogRepository {
  async createInitial(file, auditId, fileHash, sizeBytes, createdBy = Constants.SYSTEM_USERS.SFTP) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const record = {
      AUDIT_ID: auditId,
      FILE_ID: HashUtil.sha256(`${file.name}|${now}`),
      FILE_NAME: file.name,
      FILE_PATH: file.path,
      FILE_SIZE_BYTES: sizeBytes ?? 0,
      FILE_HASH: fileHash || '',
      ROW_COUNT_TOTAL: 0, ROW_COUNT_VALID: 0, ROW_COUNT_ERROR: 0,
      STATUS: 'RECEIVED', STATUS_CODE: '01', ERROR_DETAIL: '',
      RECEIVED_AT: now, PROCESS_START_AT: now, PROCESS_END_AT: now,
      CREATED_BY: createdBy, CREATED_TIMESTAMP: now,
      CHANGED_BY: createdBy, CHANGED_TIMESTAMP: now
    };
    await db.run(INSERT.into('mobi.db.MOBI_DB_FILELOG').entries(record));
    return record;
  }

  async createNewAttempt(file) {
    return this.createInitial(file, uuid(), '', file.sizeBytes ?? 0);
  }

  async ensureTracked(file) {
    return (await this.findLatestRetryableByFile(file)) || this.createNewAttempt(file);
  }

  async hasAnyFileName(fileName) {
    const db = await cds.connect.to('db');
    return !!(await db.run(
      SELECT.one.from('mobi.db.MOBI_DB_FILELOG').columns('AUDIT_ID').where({ FILE_NAME: fileName })
    ));
  }

  async findLatestRetryableByFile(file) {
    const db = await cds.connect.to('db');
    const rows = await db.run(SELECT.from('mobi.db.MOBI_DB_FILELOG').where({
      FILE_NAME: file.name,
      STATUS_CODE: { in: ['01', '02', '05', '04'] }
    }));
    return (rows || [])
      .filter((row) => {
        const p = String(row.FILE_PATH || '').toLowerCase();
        return p === file.path || (!p.includes('/fileout/') && !p.includes('/file_out/'));
      })
      .sort((a, b) => new Date(b.CREATED_TIMESTAMP || 0) - new Date(a.CREATED_TIMESTAMP || 0))[0] || null;
  }

  async findByHash(hash) {
    const db = await cds.connect.to('db');
    return db.run(SELECT.one.from('mobi.db.MOBI_DB_FILELOG').where({ FILE_HASH: hash }));
  }

  async markPicked(auditId, details) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set({
      FILE_PATH: details.filePath,
      FILE_HASH: details.fileHash || '',
      FILE_SIZE_BYTES: details.sizeBytes ?? 0,
      ROW_COUNT_TOTAL: details.totalRows ?? 0,
      ROW_COUNT_VALID: details.validCount ?? 0,
      ROW_COUNT_ERROR: details.errorCount ?? 0,
      STATUS: 'PROCESSING', STATUS_CODE: '02', PROCESS_START_AT: now,
      CHANGED_BY: Constants.SYSTEM_USERS.SFTP, CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId }));
  }

  async updateResult(auditId, result, fileHash, changedBy, filePath, options = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const status = options.statusOverride || this._resolveFinalStatus(result.validCount, result.errorCount);
    const statusCode = StatusCodeUtil.toCode('FILE', status, '05');
    const payload = {
      FILE_HASH: fileHash || '',
      ROW_COUNT_TOTAL: result.totalRows ?? 0,
      ROW_COUNT_VALID: result.validCount ?? 0,
      ROW_COUNT_ERROR: result.errorCount ?? 0,
      STATUS: status, STATUS_CODE: statusCode,
      ERROR_DETAIL: String(options.errorDetail || '').substring(0, 500),
      PROCESS_END_AT: now,
      CHANGED_BY: changedBy || Constants.SYSTEM_USERS.SFTP, CHANGED_TIMESTAMP: now
    };
    if (filePath !== undefined) payload.FILE_PATH = filePath;
    await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId }));
  }

  _resolveFinalStatus(validCount = 0, errorCount = 0) {
    if (validCount > 0 && errorCount > 0) return 'PARTIALLY_PROCESSED';
    if (validCount > 0) return 'COMPLETED';
    return 'FAILED';
  }

  async markFailed(auditId, errorDetail, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const payload = {
      STATUS: 'FAILED', STATUS_CODE: '05',
      ERROR_DETAIL: String(errorDetail || '').substring(0, 500),
      PROCESS_END_AT: DateUtil.nowTimestamp(),
      CHANGED_BY: '', CHANGED_TIMESTAMP: ''
    };
    for (const k of ['FILE_PATH', 'FILE_HASH', 'FILE_SIZE_BYTES', 'ROW_COUNT_TOTAL', 'ROW_COUNT_VALID', 'ROW_COUNT_ERROR']) {
      if (details[k] !== undefined) payload[k] = details[k];
    }
    await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId }));
  }
}

module.exports = FileLogRepository;
