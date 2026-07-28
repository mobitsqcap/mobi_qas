/**
 * ResilientIngestionWrapper – wraps an ingestion handler so that every run
 * acquires a distributed lock, runs through FileIntegrityService, handles
 * retries, and writes audit / filelog outcomes even on small failures.
 *
 * This is the recommended entry-point from CAP service actions — it keeps the
 * production concerns in one place so business handlers stay focused on
 * parsing/inserting.
 *
 * Example:
 *   const wrapper = new ResilientIngestionWrapper({
 *     scope: infra.LOCK_SCOPE.TXN_INGESTION,
 *     sftpService, integrityService, lockService: infra.getLockService(),
 *     fileLogRepository, auditRepository, logger
 *   });
 *   wrapper.run(async (ctx) => unifiedIngestionHandler.handle(ctx.executionContext));
 */
class ResilientIngestionWrapper {
  constructor({ scope, sftpService, integrityService, lockService, logger }) {
    this.scope = scope;
    this.sftp = sftpService;
    this.integrity = integrityService;
    this.locks = lockService;
    this.log = logger || require('../logging/SecureLogger');
    this.log = typeof this.log === 'function' ? new this.log(scope) : this.log;
  }

  async run(processor, { correlationId, actor } = {}) {
    let lock;
    try {
      lock = await this.locks.acquire(this.scope, 'GLOBAL', { heartbeatMs: 30000 });
      this.log.info(`Acquired lock ${lock.lockId} for ${this.scope}`, { correlationId });
      const result = await processor({
        correlationId,
        actor,
        integrity: this.integrity,
        lock
      });
      return result;
    } catch (err) {
      this.log.error(`Ingestion failed: ${err.message}`, { correlationId });
      throw err;
    } finally {
      if (lock) {
        try { await lock.release(); } catch(_) {}
      }
    }
  }
}

module.exports = ResilientIngestionWrapper;
