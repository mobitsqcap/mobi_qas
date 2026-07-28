/**
 * DistributedLockService – DB-backed locking using MOBI_DB_AUDIT-like
 * lightweight lock records.
 *
 * Why DB lock?
 *  - Works whether you run 1 or N CAP replicas.
 *  - No extra service (Redis) required on BTP.
 *  - TTL-based: if a pod crashes, the lock auto-expires.
 *  - Heartbeat renewals prevent long-running jobs from losing the lock.
 *
 * Lock records are written to MOBI_DB_STATUS category 'LOCK'? Instead, we
 * use a separate lightweight table via a CDS-managed entity defined in
 * infra/db/lock-schema.cds.
 */
const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
let uuidv4;
try { uuidv4 = require('uuid').v4; }
catch (_) { uuidv4 = () => require('crypto').randomUUID(); }
const DEFAULTS = require('../config/productionDefaults').lock;
const LockEntity = 'mobi.db.MOBI_DB_PROCESSING_LOCK';

async function now() { return new Date().toISOString(); }

class DistributedLockService {
  constructor() {
    this.ownerId = process.env.POD_NAME || process.env.CF_INSTANCE_GUID || uuidv4().substring(0,8);
    this.activeHeartbeats = new Map(); // lockKey -> interval
  }

  /**
   * Acquire a named lock.
   * @param {string} scope e.g. 'MASTER_INGESTION'
   * @param {string} resource resource identifier (file path or 'GLOBAL')
   * @returns {Promise<{lockId:string, renew:()=>Promise<void>, release:()=>Promise<void>}>}
   */
  async acquire(scope, resource = 'GLOBAL', options = {}) {
    const ttl = options.ttlSeconds || DEFAULTS.ttlSeconds;
    const timeout = options.timeoutMs || DEFAULTS.acquireTimeoutMs;
    const db = await cds.connect.to('db');
    const lockKey = `${scope}:${resource}`;
    const deadline = Date.now() + timeout;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt++;
      try {
        const ts = await now();
        const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
        const lockId = uuidv4();
        // Try to insert. If there is a live lock (not expired), insert will fail
        // (unique key), and we fall into the catch and retry.
        await db.run(INSERT.into(LockEntity).entries({
          LOCK_KEY: lockKey,
          LOCK_SCOPE: scope,
          RESOURCE: resource,
          OWNER_ID: this.ownerId,
          LOCK_ID: lockId,
          ACQUIRED_AT: ts,
          EXPIRES_AT: expiresAt,
          HEARTBEAT_AT: ts,
          STATUS: 'HELD'
        }));
        // Start heartbeat
        const interval = setInterval(() => this._renew(lockKey, lockId, ttl).catch(()=>{}),
                                       options.heartbeatMs || DEFAULTS.heartbeatMs);
        this.activeHeartbeats.set(lockKey, interval);
        return {
          lockId,
          lockKey,
          owner: this.ownerId,
          renew: () => this._renew(lockKey, lockId, ttl),
          release: () => this._release(lockKey, lockId, interval)
        };
      } catch (err) {
        // Try to scavenge expired locks then wait.
        try { await this._purgeExpired(db); } catch (_) {}
        const retryCfg = require('../config/productionDefaults').retry;
        const wait = Math.min(retryCfg.baseDelayMs * Math.pow(retryCfg.backoffFactor, attempt - 1), retryCfg.maxDelayMs);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw new Error(`Could not acquire lock ${lockKey} within ${timeout}ms (held by another instance)`);
  }

  async _renew(lockKey, lockId, ttlSeconds) {
    const db = await cds.connect.to('db');
    const ts = await now();
    const newExpiry = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await db.run(UPDATE(LockEntity).set({
      HEARTBEAT_AT: ts, EXPIRES_AT: newExpiry
    }).where({ LOCK_KEY: lockKey, LOCK_ID: lockId, OWNER_ID: this.ownerId }));
  }

  async _release(lockKey, lockId, interval) {
    if (interval) clearInterval(interval);
    this.activeHeartbeats.delete(lockKey);
    const db = await cds.connect.to('db');
    try {
      await db.run(DELETE.from(LockEntity).where({ LOCK_KEY: lockKey, LOCK_ID: lockId, OWNER_ID: this.ownerId }));
    } catch (_) { /* best effort */ }
  }

  async _purgeExpired(db) {
    const ts = await now();
    await db.run(DELETE.from(LockEntity).where({ EXPIRES_AT: { '<': ts } }));
  }

  /**
   * Release all locks held by this owner (call on shutdown).
   */
  async releaseAll() {
    for (const [key, interval] of this.activeHeartbeats.entries()) clearInterval(interval);
    this.activeHeartbeats.clear();
    const db = await cds.connect.to('db');
    await db.run(DELETE.from(LockEntity).where({ OWNER_ID: this.ownerId }));
  }
}

// Singleton
let _instance;
function getLockService() {
  if (!_instance) _instance = new DistributedLockService();
  return _instance;
}

module.exports = { DistributedLockService, getLockService };
