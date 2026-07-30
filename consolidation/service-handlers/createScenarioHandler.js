'use strict';

/**
 * Scenario-run handler.
 * Wraps the ConsolidationService.run() call with a distributed lock and DB
 * retry for transient errors.
 */

const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');

const ScenarioConfig = require('../config/ScenarioConfig');
const ConsolidationService = require('../services/ConsolidationService');
const ConsolidationRepository = require('../repositories/ConsolidationRepository');
const MasterRepository = require('../repositories/MasterRepository');
const GLAccountRepository = require('../repositories/GLAccountRepository');
const TransactionRepository = require('../repositories/TransactionRepository');
const AuditRepository = require('../repositories/AuditRepository');
const ReferenceNumberService = require('../services/ReferenceNumberService');

// Minimal infra shim — replace with your project's real infra if present.
let infra;
try { infra = require('../../infra'); } catch (_) { infra = null; }

const log = infra?.Logger ? new infra.Logger('ConsolScenario') : console;

const LOCK_SCOPE_CONSOLIDATION = 'consolidation';
const serviceCache = new Map();

function getConsolidationService(scenarioCode) {
  if (serviceCache.has(scenarioCode)) return serviceCache.get(scenarioCode);

  const consolidationRepository = new ConsolidationRepository();
  const svc = new ConsolidationService({
    masterRepository: new MasterRepository(),
    transactionRepository: new TransactionRepository(),
    consolidationRepository,
    glAccountRepository: new GLAccountRepository(),
    auditRepository: new AuditRepository({ softFail: false }),
    referenceNumberService: new ReferenceNumberService(consolidationRepository)
  });
  serviceCache.set(scenarioCode, svc);
  return svc;
}

class MemLock {
  constructor() { this.locks = new Map(); }
  async acquire(key) {
    if (this.locks.has(key)) return null;
    this.locks.set(key, true);
    return { release: async () => this.locks.delete(key) };
  }
}

const memLock = new MemLock();

async function withLock(scope, fn, { logger }) {
  const lockSvc = infra?.getLockService ? infra.getLockService() : memLock;
  const lock = await lockSvc.acquire(scope);
  if (!lock) {
    const err = new Error('Could not acquire lock');
    err.code = 'LOCK_BUSY';
    throw err;
  }
  try { return await fn(); }
  finally { try { await lock.release(); } catch (e) { logger?.warn?.('lock release failed', e?.message); } }
}

async function withDbRetry(fn, { label, log: logger } = {}) {
  if (infra?.withDbRetry) return infra.withDbRetry(fn, { label, log: logger });
  return fn();
}

module.exports = function createScenarioHandler(scenarioCode) {
  const scenario = ScenarioConfig[scenarioCode];
  if (!scenario) throw new Error(`Unknown consolidation scenario: ${scenarioCode}`);

  const consolidationService = getConsolidationService(scenarioCode);

  return async function scenarioHandler(req) {
    const actor = req?.user?.id || req?.user?.attr?.user_name || scenario.systemUser;
    const { companyCode = null, postingDate = null, documentDate = null,
            baselineDate = null, dryRun = false } = req.data || {};

    const correlationId = req?.headers?.['x-correlation-id'] || uuid();

    const processor = () => withDbRetry(
      () => consolidationService.run(scenarioCode, {
        companyCode, postingDate, documentDate, baselineDate,
        dryRun: dryRun === true || dryRun === 'true',
        requestedBy: actor
      }),
      { label: `consol:${scenarioCode}`, log }
    );

    try {
      const result = await withLock(
        `${LOCK_SCOPE_CONSOLIDATION}:${scenarioCode}`,
        processor,
        { logger: log }
      );

      return {
        scenario: result.scenario,
        dryRun: Boolean(result.dryRun),
        inputTransactions: Number(result.inputTransactions || 0),
        skippedTransactions: Number(result.skippedTransactions || 0),
        glAccountMissing: Number(result.glAccountMissing || 0),
        bpMasterMissing: Number(result.bpMasterMissing || 0),
        errorRecordsUpdated: Number(result.errorRecordsUpdated || 0),
        headersCreated: Number(result.headersCreated || 0),
        lineItemsCreated: Number(result.lineItemsCreated || 0),
        transactionsUpdated: Number(result.transactionsUpdated || 0),
        consolRefIds: result.consolRefIds || '',
        consolidationErrorFile: result.consolidationErrorFile || '',
        message: result.message || ''
      };
    } catch (err) {
      if (/Could not acquire lock|LOCK_BUSY/i.test(err.message)) {
        req.reject(409, `${scenario.displayName || scenarioCode} consolidation is already running on another instance.`);
        return;
      }
      if (log.error) log.error(`${scenarioCode} run failed: ${err.message}`, { correlationId });
      else console.error(`[${scenarioCode}] run failed: ${err.message}`);
      req.error(500, err.message);
    }
  };
};
