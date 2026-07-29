const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const HashUtil = require('../utils/HashUtil');
const CsvUtil = require('../utils/CsvUtil');
class TransactionFileHandler {
  constructor(dependencies) { Object.assign(this, dependencies); }
  async process(file, executionContext = {}) {
    let context = null;
    try {
      // A normal FILE_IN filename is one-time only. Retry is allowed exclusively through _Updated.csv.
      if (file.source === 'filein' && !file.isUpdated && await this.fileLogRepository.hasAnyFileName(file.name)) {
        await this.rejectDuplicateFile(file, executionContext);
        return;
      }
      context = await this.begin(file, executionContext); context = await this.prepare(file, context); context = await this.parseAndValidate(file, context); await this.commitOrWriteOutputs(file, context); }
    catch (error) { await this.handleHardFailure(file, context, error); }
  }
  async begin(file, executionContext = {}) {
    const fileLog = executionContext.forceNewAudit ? await this.fileLogRepository.createNewAttempt(file) : await this.fileLogRepository.ensureTracked(file);
    const paths = file.paths;
    if (!paths) throw new Error(`SFTP paths missing for file ${file.name}`);
    const processingPath = paths.PROCESSING_PATH ? await this.sftpService.resolvePath(`${paths.PROCESSING_PATH}/${file.name}`) : file.path;
    const completedPath = await this.sftpService.resolvePath(`${paths.PROCESSED_PATH}/${file.name}`);
    const errorPath = await this.sftpService.resolvePath(`${paths.ERROR_PATH}/${file.name}`);
    await this.auditRepository.start({ auditId: fileLog.AUDIT_ID, runId: executionContext.runId || file.name, fileName: file.name, createdBy: Constants.SYSTEM_USERS.SFTP });
    return { auditId: fileLog.AUDIT_ID, fileLog, paths, processingPath, completedPath, errorPath, date8: DateUtil.extractDate8(file.name), isRetry: file.source === 'processing' };
  }
  async rejectDuplicateFile(file, executionContext = {}) {
    const context = await this.begin(file, { ...executionContext, forceNewAudit: true });
    const buffer = await this.sftpService.downloadFile(file.path);
    const parsed = CsvUtil.parseNormalized(buffer);
    const rows = parsed.rows.map((raw, index) => ({
      _RAW_ROW: raw,
      _ROW_NUMBER: index + 2,
      AUDIT_ID: context.auditId,
      ROW_STATUS: Constants.ROW_STATUS.INVALID,
      ERROR_CODE: 'DUPLICATE_FILE_NAME',
      ERROR_DETAIL: `Duplicate file name: ${file.name}. Use Transactions_YYYYMMDD_Updated.csv for a corrected replacement.`
    }));
    // Remove the incoming duplicate from FILE_IN so it does not fail again on the next poll.
    try { await this.sftpService.moveFile(file.path, context.errorPath); file.path = context.errorPath; }
    catch (error) { console.warn(`[TransactionFileHandler] Could not move duplicate input to ERROR: ${error.message}`); }
    const detail = `Duplicate file name: ${file.name}. No records were validated or inserted. Use Transactions_YYYYMMDD_Updated.csv for a corrected replacement.`;
    const outputs = await this.errorFileHandler.handle(file, rows, { paths: context.paths, errorPath: context.errorPath, auditId: context.auditId, date8: context.date8, validCount: 0, errorCode: 'DUPLICATE_FILE_NAME', errorDetail: detail });
    const result = { totalRows: rows.length, validCount: 0, errorCount: rows.length };
    await this.fileLogRepository.updateResult(context.auditId, result, HashUtil.sha256(buffer), Constants.SYSTEM_USERS.SFTP, outputs.errorCsvPath, { statusOverride: Constants.FILE_STATUS.FAILED, errorDetail: detail });
    await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP, { statusOverride: Constants.FILE_STATUS.FAILED, errorCode: 'DUPLICATE_FILE_NAME', errorDetail: detail });
  }

  async prepare(file, context) {
    let pathToRead = file.path;
    if (file.source !== 'processing' && context.paths?.PROCESSING_PATH && file.path !== context.processingPath) {
      await this.sftpService.moveFile(file.path, context.processingPath);
      file.path = context.processingPath; file.source = 'processing'; pathToRead = context.processingPath;
    }
    const buffer = await this.sftpService.downloadFile(pathToRead);
    return { ...context, buffer, sizeBytes: buffer.length, fileHash: HashUtil.sha256(buffer) };
  }
  async parseAndValidate(file, context) {
    const parsed = this.csvService.parse(context.buffer, context.auditId);
    parsed.records.forEach((record, index) => { record._ROW_NUMBER = index + 2; record.AUDIT_ID = context.auditId; });
    await this.fileLogRepository.markPicked(context.auditId, { filePath: context.processingPath, fileHash: context.fileHash, sizeBytes: context.sizeBytes, totalRows: parsed.totalRows, validCount: 0, errorCount: 0 });
    await this.auditRepository.updateProgress(context.auditId, { totalRows: parsed.totalRows, validCount: 0, errorCount: 0 });
    if (!this.batchProcessingService) throw new Error('batchProcessingService is not configured in TransactionFileHandler');
    const result = await this.batchProcessingService.process(parsed.records, file.name, context.auditId);
    return { ...context, totalRows: parsed.totalRows, validRecords: result.validRecords || [], invalidRecords: result.invalidRows || [], allRecords: result.allRecords || parsed.records };
  }
  async commitOrWriteOutputs(file, context) {
    const validCount = context.validRecords.length;
    const errorCount = context.invalidRecords.length;
    const result = { totalRows: context.totalRows, validCount, errorCount };
    if (errorCount) {
      const outputs = await this.errorFileHandler.handle(file, context.allRecords, { paths: context.paths, errorPath: context.errorPath, auditId: context.auditId, date8: context.date8, validCount });
      const detail = `${errorCount} record(s) failed validation. Entire file rejected; no records were inserted.`;
      await this.fileLogRepository.updateResult(context.auditId, result, context.fileHash, Constants.SYSTEM_USERS.SFTP, outputs.errorCsvPath, { statusOverride: Constants.FILE_STATUS.FAILED, errorDetail: detail });
      await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP, { statusOverride: Constants.FILE_STATUS.FAILED, errorCode: 'FILE_VALIDATION_FAILED', errorDetail: detail });
      return;
    }
    const outputPath = context.completedPath.replace(/[^/]+$/, Constants.OUTPUT_NAMING.FULL_SUCCESS(context.date8 || 'UNKNOWN', DateUtil.nowHCMSS()));
    await this.successFileHandler.handle(file, { processingPath: context.processingPath, completedPath: outputPath, validRecords: context.validRecords, case: 'FULL' });
    await this.fileLogRepository.updateResult(context.auditId, result, context.fileHash, Constants.SYSTEM_USERS.SFTP, outputPath, { statusOverride: Constants.FILE_STATUS.COMPLETED, errorDetail: '' });
    await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP, { statusOverride: Constants.FILE_STATUS.COMPLETED, errorCode: '', errorDetail: '' });
  }
  async handleHardFailure(file, context, error) {
    if (!context?.auditId) return;
    const totalRows = error?.totalRows ?? context.totalRows ?? 0;
    await this.fileLogRepository.markFailed(context.auditId, error.message, Constants.SYSTEM_USERS.SFTP, { filePath: file?.path || context.processingPath, fileHash: context.fileHash || '', sizeBytes: context.sizeBytes ?? file?.sizeBytes ?? 0, totalRows, validCount: 0, errorCount: error?.errorCount ?? totalRows });
    await this.auditRepository.fail(context.auditId, error, { totalRows, validCount: 0, errorCount: error?.errorCount ?? totalRows }, Constants.SYSTEM_USERS.SFTP);
  }
}
module.exports = TransactionFileHandler;




// const Constants = require('../utils/Constants');
// const DateUtil = require('../utils/DateUtil');
// const HashUtil = require('../utils/HashUtil');
// class TransactionFileHandler {
//   constructor(dependencies) { Object.assign(this, dependencies); }
//   async process(file, executionContext = {}) {
//     let context = null;
//     try { context = await this.begin(file, executionContext); context = await this.prepare(file, context); context = await this.parseAndValidate(file, context); await this.commitOrWriteOutputs(file, context); }
//     catch (error) { await this.handleHardFailure(file, context, error); }
//   }
//   async begin(file, executionContext = {}) {
//     const fileLog = await this.fileLogRepository.ensureTracked(file);
//     const paths = file.paths;
//     if (!paths) throw new Error(`SFTP paths missing for file ${file.name}`);
//     const processingPath = paths.PROCESSING_PATH ? await this.sftpService.resolvePath(`${paths.PROCESSING_PATH}/${file.name}`) : file.path;
//     const completedPath = await this.sftpService.resolvePath(`${paths.PROCESSED_PATH}/${file.name}`);
//     const errorPath = await this.sftpService.resolvePath(`${paths.ERROR_PATH}/${file.name}`);
//     await this.auditRepository.start({ auditId: fileLog.AUDIT_ID, runId: executionContext.runId || file.name, fileName: file.name, createdBy: Constants.SYSTEM_USERS.SFTP });
//     return { auditId: fileLog.AUDIT_ID, fileLog, paths, processingPath, completedPath, errorPath, date8: DateUtil.extractDate8(file.name), isRetry: file.source === 'processing' };
//   }
//   async prepare(file, context) {
//     let pathToRead = file.path;
//     if (file.source !== 'processing' && context.paths?.PROCESSING_PATH && file.path !== context.processingPath) {
//       await this.sftpService.moveFile(file.path, context.processingPath);
//       file.path = context.processingPath; file.source = 'processing'; pathToRead = context.processingPath;
//     }
//     const buffer = await this.sftpService.downloadFile(pathToRead);
//     return { ...context, buffer, sizeBytes: buffer.length, fileHash: HashUtil.sha256(buffer) };
//   }
//   async parseAndValidate(file, context) {
//     const parsed = this.csvService.parse(context.buffer, context.auditId);
//     parsed.records.forEach((record, index) => { record._ROW_NUMBER = index + 2; record.AUDIT_ID = context.auditId; });
//     await this.fileLogRepository.markPicked(context.auditId, { filePath: context.processingPath, fileHash: context.fileHash, sizeBytes: context.sizeBytes, totalRows: parsed.totalRows, validCount: 0, errorCount: 0 });
//     await this.auditRepository.updateProgress(context.auditId, { totalRows: parsed.totalRows, validCount: 0, errorCount: 0 });
//     if (!this.batchProcessingService) throw new Error('batchProcessingService is not configured in TransactionFileHandler');
//     const result = await this.batchProcessingService.process(parsed.records, file.name, context.auditId);
//     return { ...context, totalRows: parsed.totalRows, validRecords: result.validRecords || [], invalidRecords: result.invalidRows || [], allRecords: result.allRecords || parsed.records };
//   }
//   async commitOrWriteOutputs(file, context) {
//     const validCount = context.validRecords.length;
//     const errorCount = context.invalidRecords.length;
//     const result = { totalRows: context.totalRows, validCount, errorCount };
//     if (errorCount) {
//       const outputs = await this.errorFileHandler.handle(file, context.allRecords, { paths: context.paths, errorPath: context.errorPath, auditId: context.auditId, date8: context.date8, validCount });
//       const detail = `${errorCount} record(s) failed validation. Entire file rejected; no records were inserted.`;
//       await this.fileLogRepository.updateResult(context.auditId, result, context.fileHash, Constants.SYSTEM_USERS.SFTP, outputs.errorCsvPath, { statusOverride: Constants.FILE_STATUS.FAILED, errorDetail: detail });
//       await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP, { statusOverride: Constants.FILE_STATUS.FAILED, errorCode: 'FILE_VALIDATION_FAILED', errorDetail: detail });
//       return;
//     }
//     const outputPath = context.completedPath.replace(/[^/]+$/, Constants.OUTPUT_NAMING.FULL_SUCCESS(context.date8 || 'UNKNOWN', DateUtil.nowHCMSS()));
//     await this.successFileHandler.handle(file, { processingPath: context.processingPath, completedPath: outputPath, validRecords: context.validRecords, case: 'FULL' });
//     await this.fileLogRepository.updateResult(context.auditId, result, context.fileHash, Constants.SYSTEM_USERS.SFTP, outputPath, { statusOverride: Constants.FILE_STATUS.COMPLETED, errorDetail: '' });
//     await this.auditRepository.complete(context.auditId, result, Constants.SYSTEM_USERS.SFTP, { statusOverride: Constants.FILE_STATUS.COMPLETED, errorCode: '', errorDetail: '' });
//   }
//   async handleHardFailure(file, context, error) {
//     if (!context?.auditId) return;
//     const totalRows = error?.totalRows ?? context.totalRows ?? 0;
//     await this.fileLogRepository.markFailed(context.auditId, error.message, Constants.SYSTEM_USERS.SFTP, { filePath: file?.path || context.processingPath, fileHash: context.fileHash || '', sizeBytes: context.sizeBytes ?? file?.sizeBytes ?? 0, totalRows, validCount: 0, errorCount: error?.errorCount ?? totalRows });
//     await this.auditRepository.fail(context.auditId, error, { totalRows, validCount: 0, errorCount: error?.errorCount ?? totalRows }, Constants.SYSTEM_USERS.SFTP);
//   }
// }
// module.exports = TransactionFileHandler;




// const Constants = require('../utils/Constants');
// const DateUtil = require('../utils/DateUtil');
// const HashUtil = require('../utils/HashUtil');

// class TransactionFileHandler {
//   constructor({
//     sftpService,
//     csvService,
//     batchProcessingService,
//     fileLogRepository,
//     auditRepository,
//     successFileHandler,
//     errorFileHandler,
//     systemUser
//   }) {
//     Object.assign(this, {
//       sftpService,
//       csvService,
//       batchProcessingService,
//       fileLogRepository,
//       auditRepository,
//       successFileHandler,
//       errorFileHandler,
//       systemUser
//     });
//   }

//   async process(file, executionContext = {}) {
//     let context = null;
//     try {
//       context = await this.begin(file, executionContext);
//       context = await this.prepare(file, context);
//       context = await this.parseAndValidate(file, context);
//       await this.commitOrWriteOutputs(file, context);
//     } catch (error) {
//       await this.handleHardFailure(file, context, error);
//     }
//   }

//   async begin(file, executionContext = {}) {
//     const actor = executionContext.actor || this.systemUser || Constants.SYSTEM_USERS.SFTP;
//     const runId = executionContext.runId || file.name;
//     const fileLog = await this.fileLogRepository.ensureTracked(file);
//     const paths = file.paths;

//     if (!paths) throw new Error(`SFTP paths missing for file ${file.name}`);

//     const processingPath = paths.PROCESSING_PATH
//       ? await this.sftpService.resolvePath(`${paths.PROCESSING_PATH}/${file.name}`)
//       : file.path;
//     const completedPath = await this.sftpService.resolvePath(`${paths.PROCESSED_PATH}/${file.name}`);
//     const errorPath = await this.sftpService.resolvePath(`${paths.ERROR_PATH}/${file.name}`);

//     await this.auditRepository.start({
//       auditId: fileLog.AUDIT_ID,
//       runId,
//       fileName: file.name,
//       createdBy: Constants.SYSTEM_USERS.SFTP
//     });

//     return {
//       auditId: fileLog.AUDIT_ID,
//       fileLog,
//       paths,
//       processingPath,
//       completedPath,
//       errorPath,
//       actor,
//       date8: DateUtil.extractDate8(file.name),
//       isRetry: file.source === 'processing'
//     };
//   }

//   async prepare(file, context) {
//     let pathToRead = file.path;

//     if (file.source !== 'processing' && context.paths?.PROCESSING_PATH && file.path !== context.processingPath) {
//       try {
//         await this.sftpService.moveFile(file.path, context.processingPath);
//         file.path = context.processingPath;
//         file.source = 'processing';
//         pathToRead = context.processingPath;
//       } catch (error) {
//         console.warn(`[TransactionFileHandler] Move skipped for ${file.name}: ${error.message}`);
//       }
//     }

//     const buffer = await this.sftpService.downloadFile(pathToRead);
//     return { ...context, buffer, sizeBytes: buffer.length, fileHash: HashUtil.sha256(buffer) };
//   }

//   async parseAndValidate(file, context) {
//     const parsed = this.csvService.parse(context.buffer, context.auditId);

//     parsed.records.forEach((record, index) => {
//       record._ROW_NUMBER = index + 2;
//       record.AUDIT_ID = context.auditId;
//     });

//     await this.fileLogRepository.markPicked(context.auditId, {
//       filePath: context.processingPath,
//       fileHash: context.fileHash || '',
//       sizeBytes: context.sizeBytes,
//       totalRows: parsed.totalRows,
//       validCount: 0,
//       errorCount: 0
//     });

//     await this.auditRepository.updateProgress(
//       context.auditId,
//       { totalRows: parsed.totalRows, validCount: 0, errorCount: 0 }
//     );

//     if (!this.batchProcessingService) {
//       throw new Error('batchProcessingService is not configured in TransactionFileHandler');
//     }

//     const batchResult = await this.batchProcessingService.process(
//       parsed.records,
//       file.name,
//       context.auditId
//     );

//     return {
//       ...context,
//       totalRows: parsed.totalRows,
//       validRecords: batchResult.validRecords || [],
//       invalidRecords: batchResult.invalidRows || []
//     };
//   }

//   async commitOrWriteOutputs(file, context) {
//     const { validRecords, invalidRecords, totalRows, auditId, date8, completedPath } = context;
//     const validCount = validRecords.length;
//     const errorCount = invalidRecords.length;
//     const result = { totalRows, validCount, errorCount };

//     if (errorCount > 0) {
//       await this.errorFileHandler.handle(file, invalidRecords, {
//         paths: context.paths,
//         errorPath: context.errorPath,
//         auditId,
//         date8,
//         validCount
//       });
//     }

//     let successCase;
//     let outputPath;
//     if (validCount > 0 && errorCount === 0) {
//       successCase = 'FULL';
//       outputPath = completedPath.replace(/[^/]+$/, Constants.OUTPUT_NAMING.FULL_SUCCESS(date8 || 'UNKNOWN', DateUtil.nowHCMSS()));
//     } else if (validCount > 0 && errorCount > 0) {
//       successCase = 'PARTIAL';
//       outputPath = completedPath.replace(/[^/]+$/, Constants.OUTPUT_NAMING.PARTIAL_SUCCESS(date8 || 'UNKNOWN'));
//     }

//     if (successCase) {
//       await this.successFileHandler.handle(file, {
//         processingPath: context.processingPath,
//         completedPath: outputPath,
//         validRecords,
//         case: successCase,
//         date8
//       });
//     }

//     // BatchProcessingService has already inserted valid rows. Do not insert again here.
//     let finalFilePath = context.processingPath;
//     let statusOverride = Constants.FILE_STATUS.FAILED;
//     let detail = `${errorCount} record(s) failed. No valid records were inserted.`;

//     if (validCount > 0 && errorCount === 0) {
//       finalFilePath = outputPath;
//       statusOverride = Constants.FILE_STATUS.COMPLETED;
//       detail = '';
//     } else if (validCount > 0 && errorCount > 0) {
//       statusOverride = Constants.FILE_STATUS.PARTIALLY_PROCESSED;
//       detail = `${errorCount} record(s) failed. ${validCount} valid record(s) were inserted in batches and written to FILE_OUT.`;
//     }

//     await this.fileLogRepository.updateResult(
//       auditId,
//       result,
//       context.fileHash || '',
//       Constants.SYSTEM_USERS.SFTP,
//       finalFilePath,
//       { statusOverride, errorDetail: detail }
//     );

//     await this.auditRepository.complete(
//       auditId,
//       result,
//       Constants.SYSTEM_USERS.SFTP,
//       { statusOverride, errorCode: errorCount > 0 ? 'ROW_VALIDATION_FAILED' : '', errorDetail: detail }
//     );
//   }

//   async handleHardFailure(file, context, error) {
//     const auditId = context?.auditId;
//     if (!auditId) return;

//     const actor = Constants.SYSTEM_USERS.SFTP;
//     const isTransient = this.sftpService.isTransientError(error);

//     if (!isTransient && context?.errorPath) {
//       try {
//         await this.errorFileHandler.handle(file, [{
//           ERROR_CODE: error.code || 'PARSE_ERROR',
//           ERROR_DETAIL: error.message,
//           _ROW_NUMBER: 0
//         }], {
//           paths: context.paths,
//           errorPath: context.errorPath,
//           auditId,
//           date8: context.date8,
//           validCount: 0
//         });
//       } catch (writeError) {
//         console.warn(`[TransactionFileHandler] Could not write error report: ${writeError.message}`);
//       }
//     }

//     const totalRows = error?.totalRows ?? context?.totalRows ?? 0;
//     const errorCount = error?.errorCount ?? totalRows;

//     await this.fileLogRepository.markFailed(auditId, error.message, actor, {
//       filePath: file?.path || context?.processingPath,
//       fileHash: context?.fileHash || '',
//       sizeBytes: context?.sizeBytes ?? file?.sizeBytes ?? 0,
//       totalRows,
//       validCount: 0,
//       errorCount
//     });

//     await this.auditRepository.fail(auditId, error, {
//       totalRows,
//       validCount: 0,
//       errorCount
//     }, actor);
//   }
// }

// module.exports = TransactionFileHandler;
