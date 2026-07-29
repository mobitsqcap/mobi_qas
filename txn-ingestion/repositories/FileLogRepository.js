// const cds = require('@sap/cds');
// const { SELECT, INSERT, UPDATE } = cds.ql;
// const { v4: uuid } = require('uuid');
// const Constants = require('../utils/Constants');
// const DateUtil = require('../utils/DateUtil');
// const HashUtil = require('../utils/HashUtil');

// class FileLogRepository {
//   async createInitial(file, auditId, fileHash, sizeBytes) {
//     const db = await cds.connect.to('db');
//     const now = DateUtil.nowTimestamp();
//     const record = {
//       AUDIT_ID: auditId,
//       FILE_ID: HashUtil.sha256(`${file.name}|${now}`),
//       FILE_NAME: file.name,
//       FILE_PATH: file.path,
//       FILE_SIZE_BYTES: sizeBytes ?? 0,
//       FILE_HASH: fileHash || '',
//       ROW_COUNT_TOTAL: 0,
//       ROW_COUNT_VALID: 0,
//       ROW_COUNT_ERROR: 0,
//       STATUS: Constants.FILE_STATUS.RECEIVED,
//       ERROR_DETAIL: '',
//       RECEIVED_AT: now,
//       PROCESS_START_AT: now,
//       PROCESS_END_AT: now,
//       CREATED_BY: Constants.SYSTEM_USERS.SFTP,
//       CREATED_TIMESTAMP: now,
//       CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
//       CHANGED_TIMESTAMP: now
//     };
//     await db.run(INSERT.into('mobi.db.MOBI_DB_FILELOG').entries(record));
//     return record;
//   }

//   async ensureTracked(file) {
//     const existing = await this.findLatestRetryableByFile(file);
//     return existing || this.createInitial(file, uuid(), '', file.sizeBytes ?? 0);
//   }

//   async findLatestRetryableByFile(file) {
//     const db = await cds.connect.to('db');
//     const rows = await db.run(SELECT.from('mobi.db.MOBI_DB_FILELOG').where({
//       FILE_NAME: file.name,
//       STATUS: { in: [
//         Constants.FILE_STATUS.RECEIVED,
//         Constants.FILE_STATUS.PROCESSING,
//         Constants.FILE_STATUS.FAILED,
//         Constants.FILE_STATUS.PARTIALLY_PROCESSED
//       ] }
//     }));

//     return (rows || [])
//       .filter((row) => {
//         const storedPath = String(row.FILE_PATH || '').toLowerCase();
//         return storedPath === file.path || (!storedPath.includes('/fileout/') && !storedPath.includes('/file_out/'));
//       })
//       .sort((a, b) => new Date(b.CREATED_TIMESTAMP || 0) - new Date(a.CREATED_TIMESTAMP || 0))[0] || null;
//   }

//   async findByHash(hash) {
//     const db = await cds.connect.to('db');
//     return db.run(SELECT.one.from('mobi.db.MOBI_DB_FILELOG').where({ FILE_HASH: hash }));
//   }

//   async markPicked(auditId, details) {
//     const db = await cds.connect.to('db');
//     const now = DateUtil.nowTimestamp();
//     await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set({
//       FILE_PATH: details.filePath,
//       FILE_HASH: details.fileHash || '',
//       FILE_SIZE_BYTES: details.sizeBytes ?? 0,
//       ROW_COUNT_TOTAL: details.totalRows ?? 0,
//       ROW_COUNT_VALID: details.validCount ?? 0,
//       ROW_COUNT_ERROR: details.errorCount ?? 0,
//       STATUS: Constants.FILE_STATUS.PROCESSING,
//       PROCESS_START_AT: now,
//       CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
//       CHANGED_TIMESTAMP: now
//     }).where({ AUDIT_ID: auditId }));
//   }

//   async updateResult(auditId, result, fileHash, changedBy, filePath, options = {}) {
//     const db = await cds.connect.to('db');
//     const now = DateUtil.nowTimestamp();
//     const status = options.statusOverride || this._resolveFinalStatus(result.validCount, result.errorCount);
//     const payload = {
//       FILE_HASH: fileHash || '',
//       ROW_COUNT_TOTAL: result.totalRows ?? 0,
//       ROW_COUNT_VALID: result.validCount ?? 0,
//       ROW_COUNT_ERROR: result.errorCount ?? 0,
//       STATUS: status,
//       ERROR_DETAIL: String(options.errorDetail || '').substring(0, 255),
//       PROCESS_END_AT: now,
//       CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
//       CHANGED_TIMESTAMP: now
//     };
//     if (filePath !== undefined) payload.FILE_PATH = filePath;
//     await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId }));
//   }

//   _resolveFinalStatus(validCount = 0, errorCount = 0) {
//     if (validCount > 0 && errorCount > 0) return Constants.FILE_STATUS.PARTIALLY_PROCESSED;
//     if (validCount > 0) return Constants.FILE_STATUS.COMPLETED;
//     return Constants.FILE_STATUS.FAILED;
//   }

//   async markFailed(auditId, errorDetail, changedBy, details = {}) {
//     const db = await cds.connect.to('db');
//     const now = DateUtil.nowTimestamp();
//     const payload = {
//       STATUS: Constants.FILE_STATUS.FAILED,
//       ERROR_DETAIL: String(errorDetail || '').substring(0, 255),
//       PROCESS_START_AT: now,
//       PROCESS_END_AT: now,
//       CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
//       CHANGED_TIMESTAMP: now
//     };
//     if (details.filePath !== undefined) payload.FILE_PATH = details.filePath;
//     if (details.fileHash !== undefined) payload.FILE_HASH = details.fileHash;
//     if (details.sizeBytes !== undefined) payload.FILE_SIZE_BYTES = details.sizeBytes;
//     if (details.totalRows !== undefined) payload.ROW_COUNT_TOTAL = details.totalRows;
//     if (details.validCount !== undefined) payload.ROW_COUNT_VALID = details.validCount;
//     if (details.errorCount !== undefined) payload.ROW_COUNT_ERROR = details.errorCount;
//     await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId }));
//   }
// }

// module.exports = FileLogRepository;


const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const { v4: uuid } = require('uuid');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const HashUtil = require('../utils/HashUtil');

class FileLogRepository {
  async createInitial(file, auditId, fileHash, sizeBytes) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const record = { AUDIT_ID: auditId, FILE_ID: HashUtil.sha256(`${file.name}|${now}`), FILE_NAME: file.name, FILE_PATH: file.path, FILE_SIZE_BYTES: sizeBytes ?? 0, FILE_HASH: fileHash || '', ROW_COUNT_TOTAL: 0, ROW_COUNT_VALID: 0, ROW_COUNT_ERROR: 0, STATUS: Constants.FILE_STATUS.RECEIVED, ERROR_DETAIL: '', RECEIVED_AT: now, PROCESS_START_AT: now, PROCESS_END_AT: now, CREATED_BY: Constants.SYSTEM_USERS.SFTP, CREATED_TIMESTAMP: now, CHANGED_BY: Constants.SYSTEM_USERS.SFTP, CHANGED_TIMESTAMP: now };
    await db.run(INSERT.into('mobi.db.MOBI_DB_FILELOG').entries(record));
    return record;
  }
  async createNewAttempt(file) { return this.createInitial(file, uuid(), '', file.sizeBytes ?? 0); }
  async ensureTracked(file) { return (await this.findLatestRetryableByFile(file)) || this.createNewAttempt(file); }
  async hasAnyFileName(fileName) {
    const db = await cds.connect.to('db');
    return !!(await db.run(SELECT.one.from('mobi.db.MOBI_DB_FILELOG').columns('AUDIT_ID').where({ FILE_NAME: fileName })));
  }
  async findLatestRetryableByFile(file) {
    const db = await cds.connect.to('db');
    const rows = await db.run(SELECT.from('mobi.db.MOBI_DB_FILELOG').where({ FILE_NAME: file.name, STATUS: { in: [Constants.FILE_STATUS.RECEIVED, Constants.FILE_STATUS.PROCESSING, Constants.FILE_STATUS.FAILED, Constants.FILE_STATUS.PARTIALLY_PROCESSED] } }));
    return (rows || []).filter((row) => { const storedPath = String(row.FILE_PATH || '').toLowerCase(); return storedPath === file.path || (!storedPath.includes('/fileout/') && !storedPath.includes('/file_out/')); }).sort((a, b) => new Date(b.CREATED_TIMESTAMP || 0) - new Date(a.CREATED_TIMESTAMP || 0))[0] || null;
  }
  async findByHash(hash) { const db = await cds.connect.to('db'); return db.run(SELECT.one.from('mobi.db.MOBI_DB_FILELOG').where({ FILE_HASH: hash })); }
  async markPicked(auditId, details) { const db = await cds.connect.to('db'); const now = DateUtil.nowTimestamp(); await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set({ FILE_PATH: details.filePath, FILE_HASH: details.fileHash || '', FILE_SIZE_BYTES: details.sizeBytes ?? 0, ROW_COUNT_TOTAL: details.totalRows ?? 0, ROW_COUNT_VALID: details.validCount ?? 0, ROW_COUNT_ERROR: details.errorCount ?? 0, STATUS: Constants.FILE_STATUS.PROCESSING, PROCESS_START_AT: now, CHANGED_BY: Constants.SYSTEM_USERS.SFTP, CHANGED_TIMESTAMP: now }).where({ AUDIT_ID: auditId })); }
  async updateResult(auditId, result, fileHash, changedBy, filePath, options = {}) { const db = await cds.connect.to('db'); const now = DateUtil.nowTimestamp(); const status = options.statusOverride || this._resolveFinalStatus(result.validCount, result.errorCount); const payload = { FILE_HASH: fileHash || '', ROW_COUNT_TOTAL: result.totalRows ?? 0, ROW_COUNT_VALID: result.validCount ?? 0, ROW_COUNT_ERROR: result.errorCount ?? 0, STATUS: status, ERROR_DETAIL: String(options.errorDetail || '').substring(0, 255), PROCESS_END_AT: now, CHANGED_BY: changedBy || Constants.SYSTEM_USERS.SFTP, CHANGED_TIMESTAMP: now }; if (filePath !== undefined) payload.FILE_PATH = filePath; await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId })); }
  _resolveFinalStatus(validCount = 0, errorCount = 0) { if (validCount > 0 && errorCount > 0) return Constants.FILE_STATUS.PARTIALLY_PROCESSED; if (validCount > 0) return Constants.FILE_STATUS.COMPLETED; return Constants.FILE_STATUS.FAILED; }
  async markFailed(auditId, errorDetail, changedBy, details = {}) { const db = await cds.connect.to('db'); const now = DateUtil.nowTimestamp(); const payload = { STATUS: Constants.FILE_STATUS.FAILED, ERROR_DETAIL: String(errorDetail || '').substring(0, 255), PROCESS_START_AT: now, PROCESS_END_AT: now, CHANGED_BY: changedBy || Constants.SYSTEM_USERS.SFTP, CHANGED_TIMESTAMP: now, ...Object.fromEntries(Object.entries({ FILE_PATH: details.filePath, FILE_HASH: details.fileHash, FILE_SIZE_BYTES: details.sizeBytes, ROW_COUNT_TOTAL: details.totalRows, ROW_COUNT_VALID: details.validCount, ROW_COUNT_ERROR: details.errorCount }).filter(([, value]) => value !== undefined)) }; await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId })); }
}
module.exports = FileLogRepository;
