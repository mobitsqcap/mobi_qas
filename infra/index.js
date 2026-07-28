/**
 * Public entry point for the production-resilience layer.
 *
 * Usage from CAP service implementations:
 *
 *   const infra = require('../infra');
 *   infra.boot({ sftpService }).then(() => ...);
 *
 *   const lock = await infra.lockService.acquire(infra.LOCK_SCOPE.TXN_INGESTION, file.name);
 *   try { ... process ... } finally { await lock.release(); }
 */
const { DistributedLockService, getLockService } = require('./lock/DistributedLockService');
const FileGuard = require('./sftp/FileGuard');
const FileIntegrityService = require('./sftp/FileIntegrityService');
const { SftpResilience, CircuitBreaker } = require('./sftp/SftpResilience');
const { HashDuplicateService, getHashService } = require('./sftp/HashDuplicateService');
const { withDbRetry, healthCheck: dbHealth } = require('./db/HanaResilience');
const Logger = require('./logging/SecureLogger');
const { ProcessingRecoveryService, getRecoveryService } = require('./jobs/ProcessingRecoveryService');
const { boot } = require('./jobs/SchedulerBootstrap');
const DEFAULTS = require('./config/productionDefaults');

const LOCK_SCOPE = DEFAULTS.lock.scope;

module.exports = {
  // Boot
  boot,

  // Locking
  DistributedLockService, getLockService, LOCK_SCOPE,

  // SFTP guards
  FileGuard, FileIntegrityService, SftpResilience, CircuitBreaker,
  HashDuplicateService, getHashService,

  // DB resilience
  withDbRetry, dbHealth,

  // Logging
  Logger,

  // Recovery / jobs
  ProcessingRecoveryService, getRecoveryService,

  // Config
  DEFAULTS
};
