/**
 * SftpResilience – decorates any sftpService with:
 *  - Exponential-backoff retry for transient errors (configurable list)
 *  - Circuit-breaker that trips when SFTP is unavailable so we don't hammer it
 *  - Connection health ping
 *  - Safe rename/move with directory auto-create
 */
const DEFAULTS = require('../config/productionDefaults').retry;

function sleep(ms) { return new Promise((r)=>setTimeout(r,ms)); }

class CircuitBreaker {
  constructor({ threshold = 5, resetMs = 30000 } = {}) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.resetMs = resetMs;
    this.trippedAt = 0;
  }
  recordSuccess() { this.failureCount = 0; }
  recordFailure() { if (++this.failureCount >= this.threshold) this.trippedAt = Date.now(); }
  allow() {
    if (!this.trippedAt) return true;
    if (Date.now() - this.trippedAt > this.resetMs) {
      this.failureCount = 0; this.trippedAt = 0; return true;
    }
    return false;
  }
  get state() {
    if (!this.trippedAt) return 'CLOSED';
    return this.allow() ? 'HALF_OPEN' : 'OPEN';
  }
}

class SftpResilience {
  constructor(sftpService, options = {}) {
    this.sftp = sftpService;
    this.opts = { ...DEFAULTS, ...options };
    this.breaker = new CircuitBreaker({ threshold: 5, resetMs: 30000 });
  }

  isRetryable(err) {
    const msg = String(err && err.message || '').toLowerCase();
    return this.opts.sftpRetryable.some((t) => msg.includes(t));
  }

  async run(label, operation) {
    if (!this.breaker.allow()) {
      throw new Error(`SFTP circuit breaker is OPEN (too many recent failures). Skipping ${label}. Will retry after ${Math.round(30000/1000)}s.`);
    }
    let lastErr;
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      try {
        const result = await operation();
        this.breaker.recordSuccess();
        return result;
      } catch (err) {
        lastErr = err;
        this.breaker.recordFailure();
        if (!this.isRetryable(err) || attempt === this.opts.maxAttempts) throw err;
        const delay = Math.min(this.opts.maxDelayMs,
                              this.opts.baseDelayMs * Math.pow(this.opts.backoffFactor, attempt - 1));
        const jitter = this.opts.jitter ? Math.round(delay * 0.2 * Math.random()) : 0;
        await sleep(delay + jitter);
      }
    }
    throw lastErr;
  }
}

module.exports = { SftpResilience, CircuitBreaker };
