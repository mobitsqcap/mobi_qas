/**
 * ProcessingRecoveryService – runs on service boot / periodically:
 *  - Scans PROCESSING folders for files left over from a crash / pod restart
 *  - Moves files older than the lock TTL + a grace back to FILE_IN (or ERROR if corrupt)
 *    so that the next scheduler cycle picks them up.
 *  - Purges old locks (anyway done by LOCK_TTL, extra safety).
 *  - Runs archive/retention moves (FILE_OUT -> ARCHIVE after N days, ERROR -> delete after M days)
 *
 * Designed to be called once at boot AND periodically from the scheduler.
 */
const cds = require('@sap/cds');
const { SELECT, DELETE, UPDATE } = cds.ql;
const LockEntity = 'mobi.db.MOBI_DB_PROCESSING_LOCK';
const FileLog    = 'mobi.db.MOBI_DB_FILELOG';
const Logger = require('../logging/SecureLogger');
const log = new Logger('Recovery');
const DEFAULTS = require('../config/productionDefaults').archive;
const path = require('path');

function ageHours(ts) {
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts).getTime()) / 3600000;
}

class ProcessingRecoveryService {
  constructor({ sftpService, masterPaths, txnPaths, retention = DEFAULTS } = {}) {
    this.sftp = sftpService;
    // The SFTP server ships with 4 folders only: FILE_IN, PROCESSING, ERROR, FILE_OUT.
    // ARCHIVE is created automatically on first retention run (recursive mkdir).
    this.paths = {
      master: masterPaths || {
        root:'Master Data',
        fileIn: 'Master Data/FILE_IN', processing:'Master Data/PROCESSING', error:'Master Data/ERROR',
        processed:'Master Data/FILE_OUT', archive:'Master Data/ARCHIVE'
      },
      txn: txnPaths || {
        root:'Transaction_Data',
        fileIn:'Transaction_Data/FILE_IN', processing:'Transaction_Data/PROCESSING',
        error:'Transaction_Data/ERROR', processed:'Transaction_Data/FILE_OUT', archive:'Transaction_Data/ARCHIVE'
      }
    };
    this.retention = retention;
  }

  async runStartupRecovery(correlationId) {
    log.info('Running startup recovery for PROCESSING folders', { correlationId });
    await this._purgeExpiredLocks();
    // Recover both master & txn PROCESSING folders
    for (const [area, p] of Object.entries(this.paths)) {
      await this._recoverStuckFiles(area, p, correlationId);
    }
    // Note: archive on boot is fine; it's idempotent.
    if (this.retention.enabled) await this._applyRetention(correlationId);
  }

  async _purgeExpiredLocks() {
    const db = await cds.connect.to('db');
    const now = new Date().toISOString();
    await db.run(DELETE.from(LockEntity).where({ EXPIRES_AT: { '<': now } }));
  }

  async _recoverStuckFiles(area, paths, correlationId) {
    try {
      const files = await this.sftp.listFiles(paths.processing);
      if (!files.length) return;
      const db = await cds.connect.to('db');
      // Files whose FILELOG PROCESSING timestamp is older than 2h are considered stuck.
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      for (const file of files) {
        const logEntry = await db.run(
          SELECT.one.from(FileLog).columns('AUDIT_ID','STATUS_CODE','PROCESS_START_AT')
            .where({ FILE_NAME: file.name }).orderBy({ CREATED_TIMESTAMP: 'desc' })
        );
        // If the last matching log is still PROCESSING and started > 2h ago, move back to FILE_IN.
        if (logEntry && logEntry.STATUS_CODE === '02' && logEntry.PROCESS_START_AT < twoHoursAgo) {
          const target = `${paths.fileIn}/${file.name}`;
          try {
            await this.sftp.moveFile(file.path, target);
            log.warn(`[${area}] recovered stuck file ${file.name} back to FILE_IN`, { correlationId });
          } catch (moveErr) {
            log.error(`[${area}] could not recover ${file.name}: ${moveErr.message}`, { correlationId });
            // Move to error as last resort
            try {
              await this.sftp.moveFile(file.path, `${paths.error}/${file.name}`);
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      log.error(`[${area}] recovery error: ${err.message}`, { correlationId });
    }
  }

  async _applyRetention(correlationId) {
    // Retention is enforced via SFTP moves/deletes. Files older than
    // processedMoveToArchiveAfterDays in FILE_OUT are moved to ARCHIVE;
    // files older than errorDeleteAfterDays in ERROR are deleted.
    if (!this.sftp) return;
    for (const p of [this.paths.master, this.paths.txn]) {
      try {
        // ARCHIVE does not ship on the SFTP server – auto-create it (recursive mkdir)
        // the first time retention runs. Failure is non-fatal (archiving is best-effort).
        if (typeof this.sftp.ensureDir === 'function') {
          try { await this.sftp.ensureDir(p.archive); }
          catch (mkdirErr) { log.warn(`Could not create ${p.archive}: ${mkdirErr.message}`, { correlationId }); }
        }
        // Archive: list FILE_OUT
        const processed = await this.sftp.listFiles(p.processed);
        const archiveCutoff = Date.now() - this.retention.processedMoveToArchiveAfterDays * 86400000;
        for (const f of processed) {
          // mtime not exposed by ssh2-sftp-client `list`? fallback to date in filename YYYYMMDD
          const ts = this._extractDate(f.name);
          if (ts && ts < archiveCutoff) {
            const target = `${p.archive}/${f.name}`;
            try { await this.sftp.moveFile(f.path, target); }
            catch(e){ log.warn(`Archive move failed for ${f.name}: ${e.message}`, { correlationId }); }
          }
        }
        // Error: delete after N days
        const errorCutoff = Date.now() - this.retention.errorDeleteAfterDays * 86400000;
        const errors = await this.sftp.listFiles(p.error);
        for (const f of errors) {
          const ts = this._extractDate(f.name);
          if (ts && ts < errorCutoff) {
            try { await this.sftp.deleteFile(f.path); }
            catch(e){ log.warn(`Error-file delete failed for ${f.name}: ${e.message}`, { correlationId }); }
          }
        }
      } catch (err) {
        log.error(`Retention error in ${p.processed}: ${err.message}`, { correlationId });
      }
    }
  }

  _extractDate(fileName) {
    const match = String(fileName || '').match(/(\d{8})/);
    if (!match) return null;
    const y = +match[1].slice(0,4), m = +match[1].slice(4,6)-1, d = +match[1].slice(6,8);
    const dt = new Date(Date.UTC(y,m,d));
    return isNaN(dt.getTime()) ? null : dt.getTime();
  }
}

let _instance;
/**
 * Return the singleton recovery service. If the singleton was created without
 * an sftpService (e.g. called from a master-only service at boot), re-create
 * it with sftpService once one becomes available.
 */
function getRecoveryService(deps) {
  if (!_instance || (deps?.sftpService && !_instance.sftp)) {
    _instance = new ProcessingRecoveryService(deps || {});
  }
  return _instance;
}

module.exports = { ProcessingRecoveryService, getRecoveryService };
