'use strict';

const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * Validates every batch before one atomic database transaction is attempted.
 * Any invalid row therefore rejects the complete file and inserts zero rows.
 */
class BatchProcessingService {
  constructor({ validationService, transactionService, fileBatchRepository }) {
    Object.assign(this, { validationService, transactionService, fileBatchRepository });
    this.batchSize = Constants.BATCH_SIZE;
  }

  async resetAttempt(auditId) {
    await this.fileBatchRepository.clearForAttempt(auditId);
  }

  async process(records, fileName, auditId, onProgress = null) {
    const allRecords = [];
    const validRecords = [];
    const invalidRows = [];
    const validationContext = this.validationService.createContext();

    for (let startIndex = 0, batchNo = 1; startIndex < records.length; startIndex += this.batchSize, batchNo += 1) {
      const batchRows = records.slice(startIndex, startIndex + this.batchSize);
      const endIndex = startIndex + batchRows.length;

      await this.fileBatchRepository.markStarted(
        auditId,
        batchNo,
        fileName,
        startIndex,
        endIndex,
        batchRows.length
      );

      try {
        const validatedRows = await this.validationService.validateBatch(batchRows, validationContext);
        validatedRows.forEach((row, offset) => {
          row._ROW_NUMBER = startIndex + offset + 2;
        });

        const valid = validatedRows.filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.VALID);
        const invalid = validatedRows.filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.INVALID);

        allRecords.push(...validatedRows);
        validRecords.push(...valid);
        invalidRows.push(...invalid);

        await this.fileBatchRepository.markCompleted(
          auditId,
          batchNo,
          valid.length,
          invalid.length,
          invalid.length ? `${invalid.length} row(s) failed validation` : ''
        );

        if (onProgress) {
          await onProgress({
            totalRows: records.length,
            validCount: validRecords.length,
            errorCount: invalidRows.length
          });
        }
      } catch (error) {
        await this.fileBatchRepository.markCompleted(
          auditId,
          batchNo,
          0,
          batchRows.length,
          error.message
        );
        error.totalRows = records.length;
        error.validCount = 0;
        error.errorCount = records.length;
        error.rawRows = records.map((record) => record._RAW_ROW || {});
        throw error;
      }
    }

    if (invalidRows.length) {
      return {
        totalRows: records.length,
        validRecords,
        invalidRows,
        allRecords,
        insertedCount: 0
      };
    }

    try {
      await this._insertAllWithRetry(validRecords);
    } catch (error) {
      error.code = StatusCodeUtil.normalizeCode(error.code, 'TRANSACTION_FAILED');
      error.totalRows = records.length;
      error.validCount = 0;
      error.errorCount = records.length;
      error.rawRows = records.map((record) => record._RAW_ROW || {});
      await this.fileBatchRepository.markAllFailed(auditId, error.message);
      throw error;
    }

    return {
      totalRows: records.length,
      validRecords,
      invalidRows,
      allRecords,
      insertedCount: validRecords.length
    };
  }

  async _insertAllWithRetry(records, attempt = 1) {
    try {
      await this.transactionService.insertAllAtomic(records, this.batchSize);
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return this._insertAllWithRetry(records, attempt + 1);
    }
  }
}

module.exports = BatchProcessingService;
