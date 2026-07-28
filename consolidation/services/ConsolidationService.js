const ScenarioConfig = require('../config/ScenarioConfig');
const BuilderRegistry = require('../builders');
const MasterRepository = require('../repositories/MasterRepository');
const TransactionRepository = require('../repositories/TransactionRepository');
const ConsolidationRepository = require('../repositories/ConsolidationRepository');
const GLAccountRepository = require('../repositories/GLAccountRepository');
const AuditRepository = require('../repositories/AuditRepository');
const ReferenceNumberService = require('./ReferenceNumberService');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const AmountUtil = require('../utils/AmountUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const IdUtil = require('../utils/IdUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * Production consolidation orchestrator.
 * All status / error fields on DB tables are 2-digit codes for speed.
 * The audit table stores both code and human-readable text.
 */
class ConsolidationService {
  constructor({
    masterRepository = new MasterRepository(),
    transactionRepository = new TransactionRepository(),
    consolidationRepository = new ConsolidationRepository(),
    glAccountRepository = new GLAccountRepository(),
    auditRepository = new AuditRepository({ softFail:false }),
    referenceNumberService = null
  } = {}) {
    this.masterRepository = masterRepository;
    this.transactionRepository = transactionRepository;
    this.consolidationRepository = consolidationRepository;
    this.glAccountRepository = glAccountRepository;
    this.auditRepository = auditRepository;
    this.referenceNumberService = referenceNumberService || new ReferenceNumberService(consolidationRepository);
  }

  async run(scenarioCode, params = {}) {
    const scenario = this._getScenario(scenarioCode);
    const BuilderClass = this._getBuilder(scenarioCode);
    const options = this._buildOptions(scenario, params);
    const runId = IdUtil.runId(scenario.code);
    const processStartAt = options.now || DateUtil.nowTimestamp();

    let runAudit = null;
    if (!options.dryRun) {
      runAudit = await this.auditRepository.createRun({
        runId, scenarioCode: scenario.code, status:'STARTED',
        processStartAt,
        companyCode: options.companyCode,
        paymentType: scenario.outputPaymentType || scenario.code,
        paymentSubType: scenario.outputPaymentSubType || null,
        changedBy: options.requestedBy
      });
    }

    try {
      const records = await this.transactionRepository.findCandidates(scenario, options);
      if (!records.length) {
        const emptyResult = this._result({
          scenario, options, records, documents:[], transactionsUpdated:0,
          runId,
          message: options.postingDate
            ? `No pending/retryable valid transactions found (postingDate=${options.postingDate}). Recoverable errors are always included.`
            : 'No pending/retryable valid transactions found for consolidation.'
        });
        if (runAudit) {
          await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
            status:'SUCCESS', totalRecords:0, successCount:0, errorCount:0,
            errorDetail: emptyResult.message, changedBy: options.requestedBy
          });
        }
        return emptyResult;
      }

      const glLookup = await this.glAccountRepository.loadLookup(records);
      const glValidation = this._splitByGlAccountAvailability(scenario, records, glLookup);
      let errorRecordsUpdated = 0;
      if (glValidation.missingRecords.length && !options.dryRun) {
        errorRecordsUpdated += await this.transactionRepository.markRecoverableError(
          glValidation.missingRecords,
          { consolStatus:'04', errorCode: Constants.ERROR_CODES.MISSING_GL_ACCOUNT,
            errorDetailByTransaction: glValidation.errorDetailByTransaction },
          options.requestedBy
        );
        await this.auditRepository.insertTransactionErrors({
          runId, scenarioCode: scenario.code, records: glValidation.missingRecords,
          errorCodeByTransaction: this._constantCodeMap(glValidation.missingRecords, Constants.ERROR_CODES.MISSING_GL_ACCOUNT),
          errorDetailByTransaction: glValidation.errorDetailByTransaction,
          defaultErrorCode: Constants.ERROR_CODES.MISSING_GL_ACCOUNT,
          processStartAt, changedBy: options.requestedBy
        });
      }

      const masterRows = await this.masterRepository.findActiveByLegacyIds(
        this._legacyIdsForBusinessPartnerLookup(scenario, records)
      );
      const masterMap = this.masterRepository.buildBusinessPartnerMap(masterRows);
      const bpValidation = this._splitByBusinessPartnerAvailability(scenario, records, masterMap);

      if (bpValidation.missingRecords.length && !options.dryRun) {
        errorRecordsUpdated += await this._markBpErrorsByCode(
          bpValidation.missingRecords, bpValidation.errorCodeByTransaction,
          bpValidation.errorDetailByTransaction, options.requestedBy
        );
        await this.auditRepository.insertTransactionErrors({
          runId, scenarioCode: scenario.code, records: bpValidation.missingRecords,
          errorCodeByTransaction: bpValidation.errorCodeByTransaction,
          errorDetailByTransaction: bpValidation.errorDetailByTransaction,
          defaultErrorCode: Constants.ERROR_CODES.MISSING_BP_MASTER,
          processStartAt, changedBy: options.requestedBy
        });
      }

      // Continue processing ALL records – errors are written to AUDIT and
      // source transactions marked recoverable; valid records still produce
      // consolidation documents (partial-run semantics).
      const recordsToConsolidate = records;

      const context = {
        referenceNumberService: this.referenceNumberService,
        resolveMerchantBp: (r, s) => this.masterRepository.resolveMerchantBp(r, masterMap, {
          requireBusinessPartner: s.requireMerchantBusinessPartner
        }),
        resolveHostCustomerBp: (r, s) => this.masterRepository.resolveHostCustomerBp(r, masterMap, {
          requireBusinessPartner: s.requireHostCustomerNumber
        }),
        resolveGlAccount: (r, flagField) => {
          const gl = glLookup.resolve(r, flagField, scenario);
          if (!gl) throw new Error(glLookup.buildMissingDetail(r, flagField, scenario));
          return gl;
        }
      };

      const builder = new BuilderClass(scenario);
      let documents;
      try {
        documents = await builder.buildDocuments(recordsToConsolidate, options, context);
      } catch (error) {
        if (!options.dryRun) {
          const detailByTransaction = new Map(
            recordsToConsolidate.map((r) => [
              this._transactionKey(r),
              String(error.message || 'Consolidation build failed').substring(0,255)
            ])
          );
          errorRecordsUpdated += await this.transactionRepository.markRecoverableError(
            recordsToConsolidate,
            { consolStatus:'06', errorCode: Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED,
              errorDetailByTransaction: detailByTransaction },
            options.requestedBy
          );
          await this.auditRepository.insertTransactionErrors({
            runId, scenarioCode: scenario.code, records: recordsToConsolidate,
            errorCodeByTransaction: this._constantCodeMap(recordsToConsolidate, Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED),
            errorDetailByTransaction: detailByTransaction,
            defaultErrorCode: Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED,
            processStartAt, changedBy: options.requestedBy
          });
          if (runAudit) {
            await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
              status:'ERROR', totalRecords: records.length, successCount:0,
              errorCount: recordsToConsolidate.length + glValidation.missingRecords.length + bpValidation.missingRecords.length,
              errorCode: Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED,
              errorDetail: String(error.message || 'Consolidation build failed').substring(0,255),
              changedBy: options.requestedBy
            });
          }
        }
        throw error;
      }

      if (options.dryRun) {
        return this._result({
          scenario, options, records, documents, transactionsUpdated:0,
          skippedTransactions: glValidation.missingRecords.length + bpValidation.missingRecords.length,
          glAccountMissing: glValidation.missingRecords.length,
          bpMasterMissing: bpValidation.missingRecords.length,
          errorRecordsUpdated: 0, runId,
          message: 'Dry run completed. No database changes were written.'
        });
      }

      await this.consolidationRepository.insertDocuments(documents);
      let transactionsUpdated = 0;
      for (const doc of documents) {
        transactionsUpdated += await this.transactionRepository.markPostingPending(
          doc.sourceTransactions, doc.header.CONSOL_REF_ID, options.requestedBy
        );
      }
      await this.auditRepository.insertDocumentSuccesses({
        runId, scenarioCode: scenario.code, documents, processStartAt, changedBy: options.requestedBy
      });

      const skipped = glValidation.missingRecords.length + bpValidation.missingRecords.length;
      const successTxnCount = documents.reduce((t, d) => t + (d.sourceTransactions?.length||0), 0);
      const runStatus = skipped > 0 ? 'PARTIAL' : 'SUCCESS';

      if (runAudit) {
        await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
          status: runStatus,
          totalRecords: records.length, successCount: successTxnCount, errorCount: skipped,
          errorCode: skipped ? this._primaryBlockedCode(glValidation, bpValidation) : null,
          errorDetail: skipped
            ? `Partial run: ${successTxnCount} consolidated, ${skipped} recoverable errors`
            : 'Consolidation completed successfully',
          changedBy: options.requestedBy
        });
      }

      return this._result({
        scenario, options, records, documents, transactionsUpdated,
        skippedTransactions: skipped,
        glAccountMissing: glValidation.missingRecords.length,
        bpMasterMissing: bpValidation.missingRecords.length,
        errorRecordsUpdated, runId,
        message: skipped
          ? 'Consolidation completed for eligible records. Recoverable errors were written to AUDIT and marked for retry on TRANSACTION.'
          : 'Consolidation completed successfully'
      });
    } catch (error) {
      if (runAudit && !options.dryRun) {
        try {
          await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
            status:'ERROR', totalRecords:0, successCount:0, errorCount:1,
            errorCode: Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED,
            errorDetail: String(error.message || error).substring(0,255),
            changedBy: options.requestedBy
          });
        } catch (auditErr) {
          console.error('[ConsolidationService] failed to complete run audit', auditErr);
        }
      }
      throw error;
    }
  }

  async updatePostingResult(scenarioCode, params = {}) {
    const scenario = this._getScenario(scenarioCode);
    const requestedBy = scenario.systemUser || Constants.SYSTEM_USERS.DEFAULT;
    const consolRefId = NormalizeUtil.text(params.consolRefId || params.CONSOL_REF_ID);
    const sapRefDocument = NormalizeUtil.text(params.sapRefDocument || params.SAP_REF_DOCUMENT);
    const requestedPostingStatus = NormalizeUtil.text(params.postingStatus || params.POSTING_STATUS);
    const errorCode = NormalizeUtil.text(params.errorCode || params.ERROR_CODE);
    const errorDetail = NormalizeUtil.text(params.errorDetail || params.ERROR_DETAIL);

    if (['POSTED','SUCCESS','S','03'].includes(requestedPostingStatus.toUpperCase()) && !sapRefDocument) {
      throw new Error('SAP reference document is required when posting status is POSTED/SUCCESS');
    }

    const result = await this.consolidationRepository.updatePostingResult(consolRefId, {
      sapRefDocument, postingStatus: requestedPostingStatus,
      httpStatus: params.httpStatus ?? params.HTTP_STATUS,
      errorCode, errorDetail
    }, requestedBy);

    await this.transactionRepository.updatePostingResultStatus(consolRefId, result.postingStatus, requestedBy);
    await this.auditRepository.applyPostingResult({
      consolRefId, postingStatus: result.postingStatus, errorCode, errorDetail,
      sapRefDocument, changedBy: requestedBy
    });

    return {
      consolRefId, postingStatus: result.postingStatus, sapRefDocument,
      message: 'Posting result updated successfully (header, line items, transaction, audit)'
    };
  }

  _constantCodeMap(records, code) {
    const m = new Map();
    for (const r of records||[]) m.set(this.transactionKey(r), code);
    return m;
  }
  _primaryBlockedCode(glValidation, bpValidation) {
    if (bpValidation.missingRecords?.length) {
      const firstKey = this.transactionKey(bpValidation.missingRecords[0]);
      return bpValidation.errorCodeByTransaction?.get(firstKey) || Constants.ERROR_CODES.MISSING_BP_MASTER;
    }
    if (glValidation.missingRecords?.length) return Constants.ERROR_CODES.MISSING_GL_ACCOUNT;
    return null;
  }
  async _markBpErrorsByCode(missingRecords, errorCodeByTransaction, errorDetailByTransaction, requestedBy) {
    const byCode = new Map();
    for (const r of missingRecords) {
      const k = this.transactionKey(r);
      const code = errorCodeByTransaction.get(k) || Constants.ERROR_CODES.MISSING_BP_MASTER;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(r);
    }
    let count = 0;
    for (const [code, recs] of byCode.entries()) {
      const detailMap = new Map();
      for (const r of recs) detailMap.set(this._transactionKey(r), errorDetailByTransaction.get(this.transactionKey(r)));
      count += await this.transactionRepository.markRecoverableError(recs,
        { consolStatus:'05', errorCode: code, errorDetailByTransaction: detailMap }, requestedBy);
    }
    return count;
  }
  _getScenario(scenarioCode) {
    const s = ScenarioConfig[scenarioCode];
    if (!s) throw new Error(`Unsupported consolidation scenario ${scenarioCode}`);
    return s;
  }
  _getBuilder(scenarioCode) {
    const B = BuilderRegistry[scenarioCode];
    if (!B) throw new Error(`No builder registered for consolidation scenario ${scenarioCode}`);
    return B;
  }
  _buildOptions(scenario, params) {
    return {
      companyCode: params.companyCode || null,
      postingDate: DateUtil.dbDate(params.postingDate),
      documentDate: DateUtil.dbDate(params.documentDate),
      baselineDate: DateUtil.dbDate(params.baselineDate),
      dryRun: params.dryRun === true || params.dryRun === 'true',
      requestedBy: scenario.systemUser || Constants.SYSTEM_USERS.DEFAULT,
      now: DateUtil.nowTimestamp()
    };
  }
  _legacyIdsForBusinessPartnerLookup(scenario, records) {
    const ids = [];
    for (const r of records||[]) {
      if (scenario.requireMerchantBusinessPartner) ids.push(r.MERCHANT_ID);
      if (scenario.requireHostCustomerNumber) ids.push(r.HOST_NAME, NormalizeUtil.host(r.HOST_NAME));
    }
    return ids;
  }
  _splitByGlAccountAvailability(scenario, records, glLookup) {
    const requirements = scenario.requiredGlAccountFields || [];
    if (!requirements.length) return { validRecords:records, missingRecords:[], errorDetailByTransaction: new Map() };
    const valid = [], missing = [];
    const errorDetailByTransaction = new Map();
    for (const r of records) {
      const details = [];
      for (const req of requirements) {
        const amountAvailable = AmountUtil.isNonZero(r[req.amountField])
          || (req.fallbackAmountField && AmountUtil.isNonZero(r[req.fallbackAmountField]));
        if (!amountAvailable) continue;
        const gl = glLookup.resolve(r, req.glFlagField, scenario);
        if (!gl) details.push(glLookup.buildMissingDetail(r, req.glFlagField, scenario));
      }
      if (details.length) {
        missing.push(r);
        errorDetailByTransaction.set(this.transactionKey(r), details.join(' || '));
      } else valid.push(r);
    }
    return { validRecords:valid, missingRecords:missing, errorDetailByTransaction };
  }
  _splitByBusinessPartnerAvailability(scenario, records, masterMap) {
    const valid = [], missing = [];
    const errorDetailByTransaction = new Map();
    const errorCodeByTransaction = new Map();
    for (const r of records||[]) {
      const details = []; let primaryCode = null;
      if (scenario.requireMerchantBusinessPartner) {
        const mr = this.masterRepository.tryResolveMerchantBp(r, masterMap, { requireBusinessPartner:true });
        if (!mr.valid) { details.push(mr.message); primaryCode = primaryCode || mr.code; }
      }
      if (scenario.requireHostCustomerNumber) {
        const hr = this.masterRepository.tryResolveHostCustomerBp(r, masterMap, { requireBusinessPartner:true });
        if (!hr.valid) { details.push(hr.message); primaryCode = primaryCode || hr.code; }
      }
      if (details.length) {
        missing.push(r);
        const k = this.transactionKey(r);
        errorDetailByTransaction.set(k, details.join(' || '));
        errorCodeByTransaction.set(k, primaryCode || Constants.ERROR_CODES.MISSING_BP_MASTER);
      } else valid.push(r);
    }
    return { validRecords:valid, missingRecords:missing, errorDetailByTransaction, errorCodeByTransaction };
  }
  transactionKey(r) {
    return this.transactionRepository.transactionKey
      ? this.transactionRepository.transactionKey(r)
      : [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
  }
  _transactionKey = (r) => this.transactionKey(r);
  _result({ scenario, options, records, documents, transactionsUpdated,
            skippedTransactions=0, glAccountMissing=0, bpMasterMissing=0,
            errorRecordsUpdated=0, runId=null, message }) {
    const lineItemsCreated = documents.reduce((t,d) => t + d.lineItems.length, 0);
    return {
      scenario: scenario.code,
      dryRun: Boolean(options.dryRun),
      postingDate: options.postingDate || null,
      runId,
      inputTransactions: records.length,
      skippedTransactions,
      glAccountMissing,
      bpMasterMissing,
      errorRecordsUpdated,
      headersCreated: documents.length,
      lineItemsCreated,
      transactionsUpdated,
      consolRefIds: documents.map((d) => d.header.CONSOL_REF_ID).join(','),
      message
    };
  }
}
module.exports = ConsolidationService;
