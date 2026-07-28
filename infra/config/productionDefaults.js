/**
 * Production configuration defaults.
 *
 * All values can be overridden via environment variables / CAP service bindings.
 * Nothing business-logic-specific lives here — only operational knobs.
 */
module.exports = Object.freeze({

  // ---- File ingest guards ------------------------------------------------
  file: {
    // Allowed extensions (lowercase, no dot)
    allowedExtensions: ['csv'],
    // Max file size in bytes (default 100 MB). Tune based on HDI container sizing.
    maxSizeBytes: Number(process.env.MAX_FILE_BYTES || 100 * 1024 * 1024),
    // Filename regex: alphanumerics, underscores, hyphens, dot, single extension.
    // Blocks control characters, path separators, shell metacharacters.
    safeNameRegex: /^[A-Za-z0-9][A-Za-z0-9_\-]{0,98}\.[A-Za-z0-9]{1,8}$/,
    // Treat these as "still uploading" and skip until they disappear
    partialSuffixes: ['.part', '.tmp', '.inprogress', '.uploading', '.filepart'],
    // A file must have the same size for N consecutive polls before we read it
    // (defends against partial uploads where rename convention isn't used).
    sizeStableChecks: Number(process.env.SIZE_STABLE_CHECKS || 2),
    sizeStableIntervalMs: Number(process.env.SIZE_STABLE_INTERVAL_MS || 5000),
    // Reject empty files and files that only contain a header row
    rejectEmptyFiles: true,
    rejectHeaderOnlyFiles: true
  },

  // ---- Locking / concurrency --------------------------------------------
  lock: {
    // Distributed lock TTL (seconds). Lock auto-expires if a pod crashes mid-run.
    ttlSeconds: Number(process.env.LOCK_TTL_SECONDS || 3600),
    // How long to wait to acquire a lock before giving up
    acquireTimeoutMs: Number(process.env.LOCK_ACQUIRE_TIMEOUT_MS || 30000),
    // Heartbeat renewal interval
    heartbeatMs: Number(process.env.LOCK_HEARTBEAT_MS || 60000),
    // Lock scope prefixes
    scope: {
      masterIngestion: 'MASTER_INGESTION',
      txnIngestion:    'TXN_INGESTION',
      consolidation:   'CONSOLIDATION'
    }
  },

  // ---- Retry / resilience ----------------------------------------------
  retry: {
    maxAttempts: Number(process.env.RETRY_MAX_ATTEMPTS || 5),
    baseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS || 1000),
    maxDelayMs:  Number(process.env.RETRY_MAX_DELAY_MS || 60000),
    backoffFactor: Number(process.env.RETRY_BACKOFF_FACTOR || 2),
    jitter: true,
    // Retryable SFTP error substrings
    sftpRetryable: [
      'no response from server','timed out','timeout','econnreset',
      'connection lost','end event','connect','failure','socket closed',
      'before handshake','etimedout','enotconn','econnrefused','broken pipe'
    ],
    // Retryable HANA/DB error codes
    dbRetryable: [
      'lock timeout','deadlock','connection timed out','connection lost',
      'session timeout','transaction rolled back','131','133','146','-813','-5822'
    ]
  },

  // ---- Batch / performance ----------------------------------------------
  // BATCH_SIZE_DEFAULT = 2000 (user-confirmed; 35k – 1L files/day).
  // DB_CHUNK_SIZE is the size used for batched INSERT/UPSERT against HANA Cloud.
  // UPDATE/DELETE heavy operations still use a smaller 500-row chunk to stay
  // within HANA parameter-list limits; set DB_SMALL_CHUNK_BYTES to override.
  batch: {
    batchSize:      Number(process.env.BATCH_SIZE     || 2000),
    dbChunkSize:    Number(process.env.DB_CHUNK_SIZE  || 2000),
    dbSmallChunk:   Number(process.env.DB_SMALL_CHUNK || 500),
    csvParseHighWaterMark: Number(process.env.CSV_HIGH_WATER_MARK || 1024 * 1024), // 1 MB
    maxMemoryMB:    Number(process.env.MAX_MEMORY_MB || 0) // 0 = no cap; if set, stream to disk
  },

  // ---- Archive / retention ----------------------------------------------
  archive: {
    enabled: process.env.ARCHIVE_ENABLED !== 'false',
    processedMoveToArchiveAfterDays: Number(process.env.ARCHIVE_AFTER_DAYS || 30),
    errorDeleteAfterDays: Number(process.env.ERROR_DELETE_DAYS || 90),
    archiveFolder: (root) => `${root}/ARCHIVE`
  },

  // ---- Logging / audit --------------------------------------------------
  logging: {
    correlationIdHeader: 'x-correlation-id',
    maskFields: ['password','passwd','authorization','sftppassword','private_key'],
    logLevel: process.env.LOG_LEVEL || 'info'
  },

  // ---- Encoding detection -----------------------------------------------
  encoding: {
    fallback: 'latin1',   // Used when UTF-8 decode fails
    stripBom: true
  }
});
