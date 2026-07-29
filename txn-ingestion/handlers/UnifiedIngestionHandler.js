const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');

class UnifiedIngestionHandler {
  constructor({ sftpService, fileLogRepository, auditRepository, transactionFileHandler }) {
    Object.assign(this, { sftpService, fileLogRepository, auditRepository, transactionFileHandler });
  }

  async handle(executionContext = {}) {
    const logs = [];
    const fileinFiles = await this._listFiles(Constants.SFTP.TRANSACTION.FILEIN_PATH, 'filein', logs, { includeRetryFiles: true });
    const processingFiles = await this._listFiles(Constants.SFTP.TRANSACTION.PROCESSING_PATH, 'processing', logs);
    const processingByName = new Map(processingFiles.map((file) => [file.name, file]));
    const retryTargets = new Map();
    const newFiles = [];

    for (const file of fileinFiles) {
      if (Constants.FILES.TRANSACTION_RETRY_REGEX.test(file.name)) {
        const originalName = Constants.RETRY.ORIGINAL_FROM_ERROR_FILE(file.name);
        const processingFile = processingByName.get(originalName);
        if (!processingFile) {
          logs.push(`Updated/retry file ${file.name} ignored: PROCESSING/${originalName} was not found.`);
          continue;
        }
        logs.push(`Updated/retry file ${file.name} matched to PROCESSING/${originalName}.`);
        retryTargets.set(originalName, file);
        continue;
      }

      // Never merge a normal duplicate filename into PROCESSING. TransactionFileHandler
      // identifies the old FILELOG entry and writes it as DUPLICATE_FILE_NAME in ERROR.
      if (processingByName.has(file.name)) logs.push(`Duplicate normal filename detected: ${file.name}. It will be rejected; use _Updated.csv for retry.`);
      newFiles.push(file);
    }

    const ordered = [
      ...Array.from(retryTargets.keys()).map((name) => ({ ...processingByName.get(name), source: 'processing', retryFile: retryTargets.get(name), isUpdated: /_Updated\.csv$/i.test(retryTargets.get(name).name) })),
      ...newFiles
    ];
    logs.push(`Transaction files to process: ${ordered.length}`);

    for (const file of ordered) {
      logs.push(`Processing TRANSACTION file: ${file.name} (source=${file.source})`);
      if (file.source === 'processing' && file.retryFile) {
        const merged = await this._mergeRetryPayload(file, file.retryFile, logs);
        if (!merged) continue; // Never process the old payload when an Updated replacement is invalid.
      }
      await this.transactionFileHandler.process(file, executionContext);
    }
    return { filesProcessed: ordered.length, logs };
  }

  async _mergeRetryPayload(processingFile, fileinFile, logs) {
    try {
      const fileBuffer = await this.sftpService.downloadFile(fileinFile.path);
      const { headers, rows: updateRows } = CsvUtil.parseNormalized(fileBuffer);
      if (!updateRows.length) throw new Error('Updated/retry file is empty');

      if (/_Updated\.csv$/i.test(fileinFile.name)) {
        const missing = Constants.TRANSACTION_CSV_COLUMNS.filter((header) => !headers.includes(header));
        if (missing.length) throw new Error(`Updated file is not a complete replacement; missing columns: ${missing.join(', ')}`);
        const normalizedRows = updateRows.map((row) => Object.fromEntries(Constants.TRANSACTION_CSV_COLUMNS.map((header) => [header, row[header] ?? ''])));
        await this.sftpService.uploadFile(processingFile.path, Buffer.from(CsvUtil.serialize(Constants.TRANSACTION_CSV_COLUMNS, normalizedRows), 'utf-8'));
        await this.sftpService.deleteFile(fileinFile.path);
        logs.push(`Replaced PROCESSING/${processingFile.name} with ${normalizedRows.length} corrected row(s) from ${fileinFile.name}.`);
        return true;
      }

      // Retain the old row_number-based merge only for Transactions_YYYYMMDD_ERRORS.csv retry payloads.
      const processBuffer = await this.sftpService.downloadFile(processingFile.path);
      const { rows: processingRows } = CsvUtil.parseNormalized(processBuffer);
      const merged = [...processingRows];
      if (!updateRows.every((row) => String(row.row_number || '').trim())) throw new Error('Retry error CSV must provide row_number for every row');
      for (const retryRow of updateRows) {
        const targetIndex = Number(String(retryRow.row_number).trim()) - 2;
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= merged.length) throw new Error(`Invalid row_number ${retryRow.row_number}`);
        const cleaned = { ...retryRow }; delete cleaned.row_number; delete cleaned.error_code; delete cleaned.error_message;
        for (const [field, value] of Object.entries(cleaned)) if (String(value ?? '').trim()) merged[targetIndex][field] = value;
      }
      const normalizedRows = merged.map((row) => Object.fromEntries(Constants.TRANSACTION_CSV_COLUMNS.map((header) => [header, row[header] ?? ''])));
      await this.sftpService.uploadFile(processingFile.path, Buffer.from(CsvUtil.serialize(Constants.TRANSACTION_CSV_COLUMNS, normalizedRows), 'utf-8'));
      await this.sftpService.deleteFile(fileinFile.path);
      logs.push(`Merged ${updateRows.length} retry row(s) by row_number from ${fileinFile.name}.`);
      return true;
    } catch (error) { logs.push(`Merge failed for ${processingFile.name}: ${error.message}. Processing was not changed.`); return false; }
  }

  async _listFiles(directory, source, logs, options = {}) {
    logs.push(`Scanning: ${directory}`);
    let files = [];
    try { files = await this.sftpService.listFiles(directory); }
    catch (error) { logs.push(`Could not list ${directory}: ${error.message}`); return []; }
    const txFiles = files.filter((file) => Constants.FILES.TRANSACTION_REGEX.test(file.name) || (source === 'filein' && options.includeRetryFiles && Constants.FILES.TRANSACTION_RETRY_REGEX.test(file.name)));
    return txFiles.map((file) => ({ ...file, source, paths: Constants.SFTP.TRANSACTION }));
  }
}
module.exports = UnifiedIngestionHandler;



// const Constants = require('../utils/Constants');

// class UnifiedIngestionHandler {
//   constructor({ sftpService, fileLogRepository, auditRepository, transactionFileHandler }) {
//     Object.assign(this, { sftpService, fileLogRepository, auditRepository, transactionFileHandler });
//   }

//   async handle(executionContext = {}) {
//     const logs = [];
//     const fileinFiles = await this._listFiles(Constants.SFTP.TRANSACTION.FILEIN_PATH, 'filein', logs, { includeRetryFiles: true });
//     const processingFiles = await this._listFiles(Constants.SFTP.TRANSACTION.PROCESSING_PATH, 'processing', logs);
//     const processingByName = new Map(processingFiles.map((f) => [f.name, f]));
//     const retryTargets = new Map();
//     const newFiles = [];

//     for (const file of fileinFiles) {
//       if (Constants.FILES.TRANSACTION_RETRY_REGEX.test(file.name)) {
//         const originalName = Constants.RETRY.ORIGINAL_FROM_ERROR_FILE(file.name);
//         const pFile = processingByName.get(originalName);
//         if (pFile) { logs.push(`Retry detected for ${file.name}. Merging into PROCESSING/${originalName}.`); retryTargets.set(originalName, file); }
//         else logs.push(`Retry file ${file.name} ignored (PROCESSING/${originalName} not found).`);
//         continue;
//       }
//       if (processingByName.has(file.name)) { logs.push(`Retry detected for ${file.name}. Merging.`); retryTargets.set(file.name, file); }
//       else newFiles.push(file);
//     }

//     const ordered = [...Array.from(retryTargets.keys()).map((name) => ({ ...processingByName.get(name), source: 'processing', retryFile: retryTargets.get(name) })), ...newFiles];
//     logs.push(`Transaction files to process: ${ordered.length}`);

//     for (const file of ordered) {
//       logs.push(`Processing TRANSACTION file: ${file.name} (source=${file.source})`);
//       if (file.source === 'processing' && file.retryFile) await this._mergeRetryPayload(file, file.retryFile, logs);
//       await this.transactionFileHandler.process(file, executionContext);
//     }
//     return { filesProcessed: ordered.length, logs };
//   }

//   async _mergeRetryPayload(processingFile, fileinFile, logs) {
//     try {
//       const pBuf = await this.sftpService.downloadFile(processingFile.path);
//       const fBuf = await this.sftpService.downloadFile(fileinFile.path);
//       const CsvUtil = require('../utils/CsvUtil');
//       const { rows: pRows } = CsvUtil.parseNormalized(pBuf);
//       const { rows: fRows } = CsvUtil.parseNormalized(fBuf);
//       if (!fRows.length) { logs.push(`Retry file ${fileinFile.name} is empty. Skipping.`); await this.sftpService.deleteFile(fileinFile.path); return; }

//       const merged = [...pRows];
//       const allHaveRowNumber = fRows.every((row) => String(row.row_number || '').trim() !== '');
//       if (allHaveRowNumber) {
//         for (const retryRow of fRows) {
//           const lineNumber = Number(String(retryRow.row_number).trim());
//           const targetIndex = lineNumber - 2;
//           if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= merged.length) throw new Error(`Invalid row_number ${retryRow.row_number}`);
//           const cleaned = { ...retryRow }; delete cleaned.row_number; delete cleaned.error_code; delete cleaned.error_message;
//           const mergedRow = { ...(merged[targetIndex] || {}) };
//           for (const [key, value] of Object.entries(cleaned)) { if (String(value || '').trim() !== '') mergedRow[key] = value; }
//           merged[targetIndex] = mergedRow;
//         }
//         logs.push(`Merged ${fRows.length} retry row(s) by row_number from ${fileinFile.name}`);
//       } else {
//         if (fRows.length > merged.length) throw new Error(`Retry row count (${fRows.length}) exceeds PROCESSING (${merged.length})`);
//         for (let i = 0; i < fRows.length; i++) {
//           const cleaned = { ...fRows[i] }; delete cleaned.row_number; delete cleaned.error_code; delete cleaned.error_message;
//           const mergedRow = { ...(merged[i] || {}) };
//           for (const [key, value] of Object.entries(cleaned)) { if (String(value || '').trim() !== '') mergedRow[key] = value; }
//           merged[i] = mergedRow;
//         }
//         logs.push(`Merged ${fRows.length} retry row(s) by positional logic`);
//       }
//       const normalizedRows = merged.map((row) => { const n = {}; for (const h of Constants.TRANSACTION_CSV_COLUMNS) n[h] = row[h] ?? ''; return n; });
//       const mergedCsv = CsvUtil.serialize(Constants.TRANSACTION_CSV_COLUMNS, normalizedRows);
//       await this.sftpService.uploadFile(processingFile.path, Buffer.from(mergedCsv, 'utf-8'));
//       await this.sftpService.deleteFile(fileinFile.path);
//     } catch (error) { logs.push(`Merge failed for ${processingFile.name}: ${error.message}. Processing as-is.`); }
//   }

//   async _listFiles(directory, source, logs, options = {}) {
//     logs.push(`Scanning: ${directory}`);
//     let files = [];
//     try { files = await this.sftpService.listFiles(directory); }
//     catch (error) { logs.push(`Could not list ${directory}: ${error.message}`); return []; }
//     logs.push(`Files in ${directory}: ${files.length}`);
//     const txFiles = files.filter((f) => { if (Constants.FILES.TRANSACTION_REGEX.test(f.name)) return true; return source === 'filein' && options.includeRetryFiles && Constants.FILES.TRANSACTION_RETRY_REGEX.test(f.name); });
//     return txFiles.map((f) => ({ ...f, source, paths: Constants.SFTP.TRANSACTION }));
//   }
// }
// module.exports = UnifiedIngestionHandler;
