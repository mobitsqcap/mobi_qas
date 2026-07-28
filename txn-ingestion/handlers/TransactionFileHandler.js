const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const HashUtil = require('../utils/HashUtil');
const CsvUtil = require('../utils/CsvUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

/**
 * TransactionFileHandler - lifecycle for a single transaction CSV file.
 *
 * CHANGED vs the original: every exit path now also writes one AUDIT row per
 * record via this._auditRecords(...), so MOBI_DB_AUDIT mirrors the
 * Transactions_YYYYMMDD_text.file content.
 *
 *   rejectDuplicateFile  -> N FAILED rows
 *   commitOrWriteOutputs (errors)  -> FAILED per bad row, NOT_INSERTED per good row
 *   commitOrWriteOutputs (clean)   -> SUCCESS per inserted row
 *   handleHardFailure    -> audits whatever was validated before the crash
 *
 * Record rows are written AFTER the error/success artefacts so the error text
 * file path can be stamped on every FAILED row.
 */
class TransactionFileHandler {
  constructor(deps) { Object.assign(this, deps); }

  async process(file, executionContext = {}) {
    let context = null;
    try {
      // Duplicate normal file name rejection (use _Updated.csv for retries)
      if (file.source === 'filein' && !file.isUpdated && await this.fileLogRepository.hasAnyFileName(file.name)) {
        await this.rejectDuplicateFile(file, executionContext);
        return;
      }
      context = await this.begin(file, executionContext);
      context = await this.prepare(file, context);
      context = await this.parseAndValidate(file, context);
      await this.commitOrWriteOutputs(file, context);
    } catch (error) {
      await this.handleHardFailure(file, context, error);
    }
  }

  async begin(file, executionContext = {}) {
    const fileLog = executionContext.forceNewAudit
      ? await this.fileLogRepository.createNewAttempt(file)
      : await this.fileLogRepository.ensureTracked(file);

    const paths = file.paths;
    if (!paths) throw new Error(`SFTP paths missing for file ${file.name}. Please check SFTP folder configuration.`);

    const processingPath = paths.PROCESSING_PATH
      ? await this.sftpService.resolvePath(`${paths.PROCESSING_PATH}/${file.name}`)
      : file.path;
    const completedPath = await this.sftpService.resolvePath(`${paths.PROCESSED_PATH}/${file.name}`);
    const errorPath     = await this.sftpService.resolvePath(`${paths.ERROR_PATH}/${file.name}`);

    const runId = executionContext.runId || file.name;

    await this.auditRepository.start({
      auditId: fileLog.AUDIT_ID, runId, fileName: file.name
    });

    return {
      auditId: fileLog.AUDIT_ID, fileLog, paths, processingPath, completedPath, errorPath,
      runId,                                    // ADDED - needed for record rows
      processStartAt: DateUtil.nowTimestamp(),  // ADDED - consistent start stamp
      date8: DateUtil.extractDate8(file.name), isRetry: file.source === 'processing'
    };
  }

  async rejectDuplicateFile(file, executionContext = {}) {
    const context = await this.begin(file, { ...executionContext, forceNewAudit: true });
    const buffer = await this.sftpService.downloadFile(file.path);
    const parsed = CsvUtil.parseNormalized(buffer);

    const rows = parsed.rows.map((raw, i) => ({
      RAW_ROW: raw,
      _ROW_NUMBER: i + 2,
      AUDIT_ID: context.auditId,
      ROW_STATUS: Constants.ROW_STATUS.INVALID,
      ERROR_CODE: Constants.ERROR_CODES.DUPLICATE_FILE_NAME,
      ERROR_DETAIL: `Duplicate file name: ${file.name}. Use Transactions_YYYYMMDD_Updated.csv for a corrected replacement. Expected format: ${Constants.EXPECTED_FORMAT}.`,
      // pulled up from RAW_ROW so the audit row carries the business keys
      MOBI_REFERENCE_ID: raw.mobi_reference_id || '',
      COMPANY_CODE:      raw.sap_company_code  || '',
      MOBI_PORTAL_CODE:  raw.mobi_portal_code  || '',
      PAYMENT_TYPE:      raw.payment_type      || '',
      PAYMENT_SUB_TYPE:  raw.payment_sub_type  || '',
      MERCHANT_ID:       raw.merchant_id       || '',
      HOST_NAME:         raw.host_name         || ''
    }));

    try {
      await this.sftpService.moveFile(file.path, context.errorPath);
      file.path = context.errorPath;
    } catch (err) {
      console.warn(`[TransactionFileHandler] Could not move duplicate ${file.name} to ERROR: ${err.message}`);
    }

    const detail = `Duplicate file name: ${file.name}. No records validated or inserted. Use Transactions_YYYYMMDD_Updated.csv for corrected replacements. Expected format: ${Constants.EXPECTED_FORMAT}.`;

    const outputs = await this.errorFileHandler.handle(file, rows, {
      paths: context.paths, errorPath: context.errorPath, auditId: context.auditId,
      date8: context.date8, validCount: 0,
      errorCode: Constants.ERROR_CODES.DUPLICATE_FILE_NAME, errorDetail: detail
    });

    const result = { totalRows: rows.length, validCount: 0, errorCount: rows.length };

    await this.fileLogRepository.updateResult(context.auditId, result, HashUtil.sha256(buffer),
      Constants.SYSTEM_USERS.SFTP, outputs.errorCsvPath,
      { statusOverride: 'FAILED', errorDetail: detail });

    await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP,
      { statusOverride: 'FAILED', errorCode: Constants.ERROR_CODES.DUPLICATE_FILE_NAME,
        errorDetail: detail, errorFilePath: outputs.errorTextPath });

    // ADDED: one audit row per record
    await this._auditRecords(context, file, rows, false, outputs.errorTextPath);
  }

  async prepare(file, context) {
    let pathToRead = file.path;
    if (file.source !== 'processing' && context.paths?.PROCESSING_PATH && file.path !== context.processingPath) {
      try {
        await this.sftpService.moveFile(file.path, context.processingPath);
        file.path = context.processingPath;
        file.source = 'processing';
        pathToRead = context.processingPath;
      } catch (err) {
        console.warn(`[TransactionFileHandler] Move to PROCESSING failed: ${err.message}. Audit updated.`);
      }
    }
    const buffer = await this.sftpService.downloadFile(pathToRead);
    return { ...context, buffer, sizeBytes: buffer.length, fileHash: HashUtil.sha256(buffer) };
  }

  async parseAndValidate(file, context) {
    const parsed = this.csvService.parse(context.buffer, context.auditId);
    parsed.records.forEach((r, i) => { r._ROW_NUMBER = i + 2; r.AUDIT_ID = context.auditId; });

    await this.fileLogRepository.markPicked(context.auditId, {
      filePath: context.processingPath, fileHash: context.fileHash, sizeBytes: context.sizeBytes,
      totalRows: parsed.totalRows, validCount: 0, errorCount: 0
    });
    await this.auditRepository.updateProgress(context.auditId, {
      totalRows: parsed.totalRows, validCount: 0, errorCount: 0
    });

    if (!this.batchProcessingService) {
      throw new Error('batchProcessingService is not configured in TransactionFileHandler');
    }

    const result = await this.batchProcessingService.process(parsed.records, file.name, context.auditId);

    return {
      ...context,
      totalRows: parsed.totalRows,
      validRecords: result.validRecords || [],
      invalidRecords: result.invalidRows || [],
      allRecords: result.allRecords || parsed.records
    };
  }

  async commitOrWriteOutputs(file, context) {
    const validCount = context.validRecords.length;
    const errorCount = context.invalidRecords.length;
    const result = { totalRows: context.totalRows, validCount, errorCount };

    if (errorCount) {
      const outputs = await this.errorFileHandler.handle(file, context.allRecords, {
        paths: context.paths, errorPath: context.errorPath, auditId: context.auditId,
        date8: context.date8, validCount
      });

      const detail = `${errorCount} record(s) failed validation. Entire file rejected; no records inserted. See error text file for row-by-row details. Expected file format: ${Constants.EXPECTED_FORMAT}.`;

      await this.fileLogRepository.updateResult(context.auditId, result, context.fileHash,
        Constants.SYSTEM_USERS.SFTP, outputs.errorCsvPath,
        { statusOverride: 'FAILED', errorDetail: detail });

      await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP, {
        statusOverride: 'FAILED', errorCode: '04', errorDetail: detail, errorFilePath: outputs.errorTextPath
      });

      // ADDED: FAILED row per bad record, NOT_INSERTED per good record
      await this._auditRecords(context, file, context.allRecords, false, outputs.errorTextPath);
      return;
    }

    const outputPath = context.completedPath.replace(/[^/]+$/,
      Constants.OUTPUT_NAMING.FULL_SUCCESS(context.date8 || 'UNKNOWN', DateUtil.nowHCMSS()));

    await this.successFileHandler.handle(file, {
      processingPath: context.processingPath, completedPath: outputPath,
      validRecords: context.validRecords, case: 'FULL'
    });

    await this.fileLogRepository.updateResult(context.auditId, result, context.fileHash,
      Constants.SYSTEM_USERS.SFTP, outputPath, { statusOverride: 'COMPLETED', errorDetail: '' });

    await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP, {
      statusOverride: 'COMPLETED', errorCode: '', errorDetail: '', errorFilePath: null
    });

    // ADDED: SUCCESS row per inserted record
    await this._auditRecords(context, file, context.allRecords, true, null);
  }

  async handleHardFailure(file, context, error) {
    if (!context?.auditId) return;
    const totalRows = error?.totalRows ?? context.totalRows ?? 0;

    let errorRows = error?.errorRows || [];
    if (!errorRows.length && error?.code === '25') {
      // header mismatch - no per-row errors exist
      const outputs = await this.errorFileHandler.handle(file, [], {
        paths: context.paths, errorPath: context.errorPath, auditId: context.auditId,
        date8: context.date8, validCount: 0,
        errorCode: '25', errorDetail: error.message
      });

      await this.fileLogRepository.markFailed(context.auditId, error.message, Constants.SYSTEM_USERS.SFTP, {
        filePath: outputs?.errorCsvPath || file.path, fileHash: context.fileHash || '',
        sizeBytes: context.sizeBytes ?? file.sizeBytes,
        totalRows: 0, validCount: 0, errorCount: 0
      });

      await this.auditRepository.fail(context.auditId, error, { totalRows: 0, validCount: 0, errorCount: 0 },
        Constants.SYSTEM_USERS.SFTP, { errorFilePath: outputs?.errorTextPath });
      return;
    }

    await this.fileLogRepository.markFailed(context.auditId, error.message, Constants.SYSTEM_USERS.SFTP, {
      filePath: file?.path || context.processingPath, fileHash: context.fileHash || '',
      sizeBytes: context.sizeBytes ?? file.sizeBytes, totalRows, validCount: 0,
      errorCount: error?.errorCount ?? totalRows
    });

    await this.auditRepository.fail(context.auditId, error,
      { totalRows, validCount: 0, errorCount: error?.errorCount ?? totalRows },
      Constants.SYSTEM_USERS.SFTP);

    // ADDED: if records were validated before the crash, audit them
    if (context.allRecords?.length) {
      await this._auditRecords(context, file, context.allRecords, false, null);
    }
  }

  /**
   * ADDED helper - writes one audit row per record.
   * Wrapped in try/catch so audit problems can never break ingestion.
   * Set AUDIT_RECORD_LEVEL=false to switch this off without a redeploy.
   */
  async _auditRecords(context, file, records, inserted, errorFilePath) {
    if (process.env.AUDIT_RECORD_LEVEL === 'false') return;
    if (!this.auditRepository.insertRecordRows) return;
    try {
      const written = await this.auditRepository.insertRecordRows({
        runId: context.runId,
        fileName: file.name,
        records,
        inserted,
        errorFilePath,
        processStartAt: context.processStartAt,
        changedBy: Constants.SYSTEM_USERS.SFTP
      });
      console.log(`[TransactionFileHandler] ${file.name}: ${written} record audit row(s) written`);
    } catch (err) {
      console.error(`[TransactionFileHandler] record audit failed for ${file.name}: ${err.message}`);
    }
  }
}

module.exports = TransactionFileHandler;
