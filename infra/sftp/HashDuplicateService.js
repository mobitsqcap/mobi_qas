/**
 * HashDuplicateService – centralised content-duplicate detection.
 * Wraps the file-hash checks previously scattered across file handlers so that
 * ANY SFTP file (master, transaction, consolidation input) is checked in one
 * place. Returns duplicate info (previous AUDIT_ID, timestamp) for error text.
 */
const crypto = require('crypto');
const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const FILELOG = 'mobi.db.MOBI_DB_FILELOG';

class HashDuplicateService {
  constructor() {
    this.inFlightHashes = new Set();
  }

  sha256(bufferOrString) {
    return crypto.createHash('sha256').update(bufferOrString).digest('hex');
  }

  beginProcessing(hash) { this.inFlightHashes.add(hash); }
  endProcessing(hash)   { this.inFlightHashes.delete(hash); }

  async isDuplicate(hash) {
    if (!hash) return { duplicate:false };
    if (this.inFlightHashes.has(hash)) {
      return { duplicate:true, reason:'Same file is already being processed by another instance (in-flight).' };
    }
    const db = await cds.connect.to('db');
    const existing = await db.run(
      SELECT.one.from(FILELOG)
        .columns('AUDIT_ID','FILE_NAME','FILE_PATH','STATUS_CODE','CREATED_TIMESTAMP')
        .where({ FILE_HASH: hash })
    );
    if (existing && ['03','04'].includes(existing.STATUS_CODE)) {   // COMPLETED / PARTIAL
      return {
        duplicate:true,
        reason:`File content already processed (AUDIT_ID=${existing.AUDIT_ID}, file=${existing.FILE_NAME}, processed at ${existing.CREATED_TIMESTAMP}).`,
        previous: existing
      };
    }
    return { duplicate:false };
  }
}

let _instance;
function getHashService() {
  if (!_instance) _instance = new HashDuplicateService();
  return _instance;
}

module.exports = { HashDuplicateService, getHashService };
