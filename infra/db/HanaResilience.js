/**
 * HANA/HDI resilience helpers:
 *  - Retry wrapper for transient DB errors (deadlocks, connection timeouts,
 *    session timeouts, lock-wait timeouts, rolled-back transactions).
 *  - Health check (connectivity + select 1 from dummy) used by the scheduler.
 */
const cds = require('@sap/cds');
const DEFAULTS = require('../config/productionDefaults').retry;

const TRANSIENT_MARKERS = DEFAULTS.dbRetryable.map((s) => s.toLowerCase());

function isTransientDbError(error) {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  const code = String(error.code || error.errno || '').toLowerCase();
  return TRANSIENT_MARKERS.some((m) => msg.includes(m) || code.includes(m));
}

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withDbRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts || DEFAULTS.maxAttempts;
  const baseMs = options.baseDelayMs || DEFAULTS.baseDelayMs;
  const maxMs = options.maxDelayMs || DEFAULTS.maxDelayMs;
  const factor = options.backoffFactor || DEFAULTS.backoffFactor;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(attempt); }
    catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === maxAttempts) throw error;
      const delay = Math.min(maxMs, baseMs * Math.pow(factor, attempt - 1));
      const jitter = DEFAULTS.jitter ? Math.round(delay * 0.2 * Math.random()) : 0;
      await wait(delay + jitter);
    }
  }
  throw lastError;
}

async function healthCheck() {
  try {
    const db = await cds.connect.to('db');
    await db.run('SELECT 1 FROM DUMMY');
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

module.exports = { isTransientDbError, withDbRetry, healthCheck };
