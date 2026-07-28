const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');
const ValidationError = require('../models/ValidationError');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

/**
 * Transaction SFTP ingestion driver.
 *
 *   - Invalid file names are immediately moved to ERROR with a helpful
 *     message describing the expected format.
 *   - An audit record (and FILELOG entry) is always created, even for small
 *     errors like invalid file name, failed move, etc.
 *   - _Updated.csv is a full-file replacement for a file stuck in PROCESSING.
 *   - _ERRORS.csv retries are merged by row_number.
 */
class UnifiedIngestionHandler {
  constructor({ sftpService, fileLogRepository, auditRepository, transactionFileHandler, errorFileHandler }) {
    Object.assign(this, { sftpService, fileLogRepository, auditRepository, transactionFileHandler, errorFileHandler });
  }

  async handle(executionContext = {}) {
    const logs = [];
    const fileinFiles     = await this._listFiles(Constants.SFTP.TRANSACTION.FILEIN_PATH, 'filein', logs, { includeRetryFiles: true });
    const processingFiles = await this._listFiles(Constants.SFTP.TRANSACTION.PROCESSING_PATH, 'processing', logs);
    const processingByName = new Map(processingFiles.map((f) => [f.name, f]));

    const retryTargets = new Map();
    const newFiles     = [];

    for (const file of fileinFiles) {
      if (Constants.FILES.TRANSACTION_RETRY_REGEX.test(file.name)) {
        const originalName = Constants.RETRY.ORIGINAL_FROM_ERROR_FILE(file.name);
        const processingFile = processingByName.get(originalName);
        if (!processingFile) {
          logs.push(`Updated/retry file ${file.name} ignored: PROCESSING/${originalName} not found.`);
          await this._handleOrphanRetryFile(file, executionContext, logs);
          continue;
        }
        logs.push(`Updated/retry file ${file.name} matched to PROCESSING/${originalName}.`);
        retryTargets.set(originalName, file);
        continue;
      }

      if (processingByName.has(file.name)) {
        logs.push(`Duplicate normal filename detected: ${file.name}. It will be rejected; use Updated.csv for retries.`);
      }
      newFiles.push(file);
    }

    const ordered = [
      ...Array.from(retryTargets.keys()).map((name) => ({
        ...processingByName.get(name),
        source: 'processing',
        retryFile: retryTargets.get(name),
        isUpdated: /Updated\.csv$/i.test(retryTargets.get(name).name)
      })),
      ...newFiles
    ];

    logs.push(`Transaction files to process: ${ordered.length}`);

    for (const file of ordered) {
      logs.push(`Processing TRANSACTION file: ${file.name} (source=${file.source})`);
      if (file.source === 'processing' && file.retryFile) {
        const merged = await this._mergeRetryPayload(file, file.retryFile, logs);
        if (!merged) continue; // never process stale payload when replacement invalid
      }
      try {
        await this.transactionFileHandler.process(file, executionContext);
      } catch (err) {
        logs.push(`Error processing ${file.name}: ${err.message}`);
      }
    }

    return { filesProcessed: ordered.length, logs };
  }

  async _handleOrphanRetryFile(file, executionContext, logs) {
    const actor = executionContext.actor || Constants.SYSTEM_USERS.DEFAULT;
    const runId = executionContext.runId  || 'MANUAL_RUN';

    const fileLog = await this.fileLogRepository.ensureTracked(file, actor);
    await this.auditRepository.start({ auditId: fileLog.AUDIT_ID, runId, fileName: file.name });

    const message = `Retry file ${file.name} does not correspond to any file in PROCESSING. Expected an existing Transactions_YYYYMMDD.csv in PROCESSING to apply against.`;
    const error = new ValidationError('06', message);
    error.errorRows = [];

    const errorPath = `${Constants.SFTP.TRANSACTION.ERROR_PATH}/${file.name}`;
    try {
      const resolved = await this.sftpService.resolvePath(errorPath);
      await this.sftpService.moveFile(file.path, resolved);
      file.path = resolved;
    } catch (err) {
      logs.push(`Could not move orphan retry file to ERROR: ${err.message}`);
    }

    await this.fileLogRepository.markFailed(fileLog.AUDIT_ID, message, actor, {
      filePath: file.path, totalRows: 0, validCount: 0, errorCount: 0
    });
    await this.auditRepository.fail(fileLog.AUDIT_ID, error, { totalRows: 0, validCount: 0, errorCount: 0 }, actor);
  }

  async _mergeRetryPayload(processingFile, fileinFile, logs) {
    try {
      const fileBuffer = await this.sftpService.downloadFile(fileinFile.path);
      const { headers, rows: updateRows } = CsvUtil.parseNormalized(fileBuffer);
      if (!updateRows.length) throw new Error('Updated/retry file is empty');

      if (/Updated\.csv$/i.test(fileinFile.name)) {
        const missing = Constants.TRANSACTION_CSV_COLUMNS.filter((h) => !headers.includes(h));
        if (missing.length) {
          throw new Error(`Updated file is not a complete replacement; missing columns: ${missing.join(', ')}`);
        }
        const normalizedRows = updateRows.map((row) =>
          Object.fromEntries(Constants.TRANSACTION_CSV_COLUMNS.map((h) => [h, row[h] ?? '']))
        );
        await this.sftpService.uploadFile(processingFile.path,
          Buffer.from(CsvUtil.serialize(Constants.TRANSACTION_CSV_COLUMNS, normalizedRows), 'utf-8'));
        await this.sftpService.deleteFile(fileinFile.path);
        logs.push(`Replaced PROCESSING/${processingFile.name} with ${normalizedRows.length} corrected row(s) from ${fileinFile.name}.`);
        return true;
      }

      const processBuffer = await this.sftpService.downloadFile(processingFile.path);
      const { rows: processingRows } = CsvUtil.parseNormalized(processBuffer);
      const merged = [...processingRows];

      if (!updateRows.every((r) => String(r.row_number || '').trim())) {
        throw new Error('Retry error CSV must provide row_number for every row');
      }

      for (const retryRow of updateRows) {
        const targetIndex = Number(String(retryRow.row_number).trim()) - 2;
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= merged.length) {
          throw new Error(`Invalid row_number ${retryRow.row_number}`);
        }
        const cleaned = { ...retryRow };
        delete cleaned.row_number;
        delete cleaned.error_code;
        delete cleaned.error_message;
        for (const [field, value] of Object.entries(cleaned)) {
          if (String(value ?? '').trim()) merged[targetIndex][field] = value;
        }
      }

      const normalized = merged.map((row) =>
        Object.fromEntries(Constants.TRANSACTION_CSV_COLUMNS.map((h) => [h, row[h] ?? ''])));

      await this.sftpService.uploadFile(processingFile.path,
        Buffer.from(CsvUtil.serialize(Constants.TRANSACTION_CSV_COLUMNS, normalized), 'utf-8'));
      await this.sftpService.deleteFile(fileinFile.path);
      logs.push(`Merged ${updateRows.length} retry row(s) by row_number from ${fileinFile.name}.`);
      return true;
    } catch (error) {
      logs.push(`Merge failed for ${processingFile.name}: ${error.message}. Processing was not changed.`);
      return false;
    }
  }

  async _listFiles(directory, source, logs, options = {}) {
    logs.push(`Scanning: ${directory}`);
    let files = [];
    try {
      files = await this.sftpService.listFiles(directory);
    } catch (error) {
      logs.push(`Could not list ${directory}: ${error.message}`);
      return [];
    }

    const txFiles = files.filter((f) =>
      Constants.FILES.TRANSACTION_REGEX.test(f.name) ||
      (source === 'filein' && options.includeRetryFiles && Constants.FILES.TRANSACTION_RETRY_REGEX.test(f.name))
    );

    return txFiles.map((f) => ({ ...f, source, paths: Constants.SFTP.TRANSACTION }));
  }
}

module.exports = UnifiedIngestionHandler;
