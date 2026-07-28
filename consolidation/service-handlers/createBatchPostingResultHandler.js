/**
 * createBatchPostingResultHandler – handles CPI callbacks for one or many
 * consolidation posting outcomes. Updates HEADER, LINE_ITEM, TRANSACTION
 * and AUDIT in one go, returning the array-of-response shape the original
 * CPI iFlow expects:
 *
 *   [{ consolRefId, status, postingStatus, message }]
 *
 * Accepts text ("POSTED"/"FAILED") OR code ("03"/"07") postingStatus values.
 * When postingStatus = POSTED, sapRefDocument is required (else error).
 */
const cds = require('@sap/cds');
const ScenarioConfig = require('../config/ScenarioConfig');
const ConsolidationRepository = require('../repositories/ConsolidationRepository');
const TransactionRepository = require('../repositories/TransactionRepository');
const AuditRepository = require('../repositories/AuditRepository');
const Constants = require('../constants/ConsolidationConstants');

const POSTED = Constants.POSTING_STATUS.POSTED;         // '03'
const POSTING_FAILED = Constants.POSTING_STATUS.FAILED; // '07'

function normalizePostingStatus(input) {
  const s = String(input || '').trim().toUpperCase();
  if (['POSTED','SUCCESS','S','03'].includes(s)) return POSTED;
  if (['POSTING_FAILED','FAILED','ERROR','E','07'].includes(s)) return POSTING_FAILED;
  if (['POSTING_PENDING','PENDING','02'].includes(s)) return Constants.POSTING_STATUS.POSTING_PENDING;
  return null;
}

module.exports = function createBatchPostingResultHandler(scenarioCode) {
  const scenario = ScenarioConfig[scenarioCode];
  if (!scenario) throw new Error(`Unknown consolidation scenario: ${scenarioCode}`);

  const consolidationRepo = new ConsolidationRepository();
  const transactionRepo  = new TransactionRepository();
  const auditRepo        = new AuditRepository({ softFail: true });

  return async function batchPostingResultHandler(req) {
    const actor = req?.user?.id || req?.user?.attr?.user_name || scenario.systemUser;
    const items = Array.isArray(req.data?.items)
      ? req.data.items
      : Array.isArray(req.data)
        ? req.data
        : [];

    if (!items.length) {
      req.error(400, 'items (array of posting results) is required.');
      return;
    }

    const responses = [];
    for (const raw of items) {
      const item = raw || {};
      const consolRefId    = String(item.consolRefId || item.CONSOL_REF_ID || '').trim();
      const sapRefDocument = item.sapRefDocument || item.SAP_REF_DOCUMENT || null;
      const requestedCode  = normalizePostingStatus(item.postingStatus || item.POSTING_STATUS);
      const httpStatus     = item.httpStatus     ?? item.HTTP_STATUS  ?? null;
      const errorCode      = item.errorCode      || item.ERROR_CODE   || null;
      const errorDetail    = item.errorDetail    || item.ERROR_DETAIL || null;

      if (!consolRefId) {
        responses.push({
          consolRefId: '', status: 'ERROR', postingStatus: '',
          message: 'consolRefId is required.'
        });
        continue;
      }
      const postingStatus = requestedCode;
      if (!postingStatus) {
        responses.push({
          consolRefId, status: 'ERROR', postingStatus: '',
          message: 'Invalid postingStatus. Expected POSTED/SUCCESS/03 or FAILED/ERROR/07.'
        });
        continue;
      }
      if (postingStatus === POSTED && !sapRefDocument) {
        responses.push({
          consolRefId, status: 'ERROR', postingStatus,
          message: 'sapRefDocument is required when postingStatus is POSTED.'
        });
        continue;
      }

      try {
        // 1. Update header + line items
        const result = await consolidationRepo.updatePostingResult(consolRefId, {
          sapRefDocument, postingStatus, httpStatus, errorCode, errorDetail
        }, actor);
        // 2. Update transactions (CONSOL_STATUS = POSTED/POSTING_FAILED)
        await transactionRepo.updatePostingResultStatus(consolRefId, postingStatus, actor);
        // 3. Update AUDIT
        await auditRepo.applyPostingResult({
          consolRefId, postingStatus, errorCode, errorDetail, sapRefDocument, changedBy: actor
        });
        responses.push({
          consolRefId,
          status: result.postingStatus === POSTED ? 'SUCCESS' : 'ERROR',
          postingStatus: result.postingStatus,
          message: result.postingStatus === POSTED
            ? `Posted successfully (SAP ${sapRefDocument})`
            : `Posting failed: ${errorDetail || errorCode || 'Unknown error'}`
        });
      } catch (err) {
        responses.push({
          consolRefId, status: 'ERROR', postingStatus: postingStatus || '',
          message: String(err.message || err).substring(0, 500)
        });
      }
    }

    return responses;
  };
};
