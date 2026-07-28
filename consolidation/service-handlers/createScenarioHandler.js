/**
 * createScenarioHandler – returns a CAP action handler that runs a single
 * consolidation scenario. Wraps the run with a distributed lock (for HA
 * multi-instance safety) and DB retry for transient HANA errors, while
 * keeping the external contract identical to the original handler.
 */
const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');
const infra = require('../../infra');
const ScenarioConfig = require('../config/ScenarioConfig');
const ConsolidationService = require('../services/ConsolidationService');
const ConsolidationRepository = require('../repositories/ConsolidationRepository');
const MasterRepository = require('../repositories/MasterRepository');
const GLAccountRepository = require('../repositories/GLAccountRepository');
const TransactionRepository = require('../repositories/TransactionRepository');
const AuditRepository = require('../repositories/AuditRepository');
const ReferenceNumberService = require('../services/ReferenceNumberService');

const log = new infra.Logger('ConsolScenario');

const serviceCache = new Map();
function getConsolidationService(scenarioCode) {
  if (serviceCache.has(scenarioCode)) return serviceCache.get(scenarioCode);
  const consolidationRepository = new ConsolidationRepository();
  const svc = new ConsolidationService({
    masterRepository:        new MasterRepository(),
    transactionRepository:   new TransactionRepository(),
    consolidationRepository,
    glAccountRepository:     new GLAccountRepository(),
    auditRepository:         new AuditRepository({ softFail: false }),
    referenceNumberService:  new ReferenceNumberService(consolidationRepository)
  });
  serviceCache.set(scenarioCode, svc);
  return svc;
}

module.exports = function createScenarioHandler(scenarioCode) {
  const scenario = ScenarioConfig[scenarioCode];
  if (!scenario) throw new Error(`Unknown consolidation scenario: ${scenarioCode}`);
  const consolidationService = getConsolidationService(scenarioCode);
  const wrapper = new (require('../../infra/sftp/ResilientIngestionWrapper'))({
    scope: `${infra.LOCK_SCOPE.consolidation}:${scenarioCode}`,
    lockService: infra.getLockService(),
    logger: log
  });

  return async function scenarioHandler(req) {
    const actor = req?.user?.id || req?.user?.attr?.user_name || scenario.systemUser;
    const { companyCode = null, postingDate = null, documentDate = null,
            baselineDate = null, dryRun = false } = req.data || {};
    const correlationId = req?.headers?.['x-correlation-id'] || uuid();

    const processor = () => infra.withDbRetry(
      () => consolidationService.run(scenarioCode, {
        companyCode, postingDate, documentDate, baselineDate,
        dryRun: dryRun === true || dryRun === 'true',
        requestedBy: actor
      }),
      { label: `consol:${scenarioCode}`, log }
    );

    try {
      const result = await wrapper.run(processor, { correlationId, actor });
      // Match original response shape exactly
      return {
        scenario:            result.scenario,
        dryRun:              Boolean(result.dryRun),
        inputTransactions:   Number(result.inputTransactions || 0),
        skippedTransactions: Number(result.skippedTransactions || 0),
        glAccountMissing:    Number(result.glAccountMissing || 0),
        bpMasterMissing:     Number(result.bpMasterMissing || 0),
        errorRecordsUpdated: Number(result.errorRecordsUpdated || 0),
        headersCreated:      Number(result.headersCreated || 0),
        lineItemsCreated:    Number(result.lineItemsCreated || 0),
        transactionsUpdated: Number(result.transactionsUpdated || 0),
        consolRefIds:        result.consolRefIds || '',
        message:             result.message || ''
      };
    } catch (err) {
      if (/Could not acquire lock/i.test(err.message)) {
        req.reject(409, `${scenario.displayName || scenarioCode} consolidation is already running on another instance.`);
        return;
      }
      log.error(`${scenarioCode} run failed: ${err.message}`, { correlationId });
      req.error(500, err.message);
    }
  };
};
