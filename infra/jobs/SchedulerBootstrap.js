/**
 * SchedulerBootstrap – wires everything up on CAP service boot.
 *
 *  - Ensures MOBI_DB_STATUS is populated (idempotent)
 *  - Registers graceful shutdown hooks (release all locks, disconnect SFTP) ONCE
 *  - Runs startup recovery (stuck files, expired locks, retention) ONCE
 *  - Optionally schedules background ingestion + archive jobs using node-cron
 *    IF no external BTP Job Scheduler is configured (env-flag gated).
 *
 * BTP Job Scheduler is the production default (as shown in screenshot).
 * Set ENABLE_*_SCHEDULE=true only for local dev.
 *
 * The boot() function is idempotent – safe to call from each CAP service
 * implementation file; shutdown listeners and recovery run exactly once.
 */
const cds = require('@sap/cds');
const Logger = require('../logging/SecureLogger');
const StatusCodeUtil = require('../../db/StatusCodeUtil');
const { getRecoveryService } = require('./ProcessingRecoveryService');
const log = new Logger('Bootstrap');

let _booted = false;
const _sftpServices = new Set();

function tryRequire(name) {
  try { return require(name); } catch (_) { return null; }
}

function scheduleIfEnabled(cronExpr, label, fn) {
  if (process.env[`ENABLE_${label}_SCHEDULE`] !== 'true') return;
  try {
    const cron = tryRequire('node-cron');
    if (cron && cron.validate(cronExpr)) {
      cron.schedule(cronExpr, async () => {
        try { await fn(); } catch (e) { log.error(`${label} scheduled job failed: ${e.message}`); }
      });
      log.info(`Scheduled ${label} with cron: ${cronExpr}`);
    } else {
      log.warn(`Could not schedule ${label}: install node-cron or rely on BTP Job Scheduler.`);
    }
  } catch (e) {
    log.warn(`Scheduling ${label} skipped: ${e.message}`);
  }
}

function registerShutdown(masterIngestion, txnIngestion) {
  if (registerShutdown._installed) return;
  registerShutdown._installed = true;
  const shutdown = async (signal) => {
    log.info(`Received ${signal}; releasing locks and disconnecting SFTP.`);
    try {
      const { getLockService } = require('../lock/DistributedLockService');
      await getLockService().releaseAll();
    } catch (_) { /* best effort */ }
    for (const svc of _sftpServices) {
      try { if (svc && typeof svc.disconnect === 'function') await svc.disconnect(); }
      catch (_) { /* best effort */ }
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

async function boot(services = {}) {
  const { masterIngestion, txnIngestion, sftpService } = services;
  if (sftpService) _sftpServices.add(sftpService);

  if (_booted) return;
  _booted = true;

  try {
    await StatusCodeUtil.ensureStatusTable();
    log.info('MOBI_DB_STATUS seeded.');

    // Recovery – requires an sftp service to talk to SFTP.
    // Pick any registered service (both master and txn sftp services resolve
    // paths against the same BTP Destination, so one is sufficient).
    const recoverySftp = sftpService || _sftpServices.values().next().value || null;
    if (recoverySftp && typeof recoverySftp.listFiles === 'function') {
      const recovery = getRecoveryService({ sftpService: recoverySftp });
      try { await recovery.runStartupRecovery('boot'); }
      catch (recErr) { log.warn(`Startup recovery error (non-fatal): ${recErr.message}`); }
    } else {
      // Even without an SFTP handle, purge expired DB locks.
      try {
        const { getLockService } = require('../lock/DistributedLockService');
        await getLockService().releaseAll();
      } catch (_) { /* best effort */ }
    }

    // Optional local-dev cron scheduling (production uses BTP Job Scheduler).
    scheduleIfEnabled(process.env.MASTER_CRON  || '0 */30 * * * *', 'MASTER',  () => masterIngestion?.());
    scheduleIfEnabled(process.env.TXN_CRON     || '*/5 * * * *',    'TXN',     () => txnIngestion?.());
    scheduleIfEnabled(process.env.ARCHIVE_CRON || '0 2 * * *',     'ARCHIVE', async () => {
      const s = recoverySftp || _sftpServices.values().next().value;
      if (s) {
        const r = getRecoveryService({ sftpService: s });
        await r.runStartupRecovery('scheduled-archive');
      }
    });

    registerShutdown(masterIngestion, txnIngestion);
  } catch (err) {
    log.error(`Bootstrap error (non-fatal): ${err.message}`);
    // Don't throw – CAP should still come up; the next scheduler trigger will retry.
  }
}

module.exports = { boot };
