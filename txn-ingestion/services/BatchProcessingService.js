const Constants = require('../utils/Constants');
/**
 * Validates every batch before a single database insert is attempted.
 * Therefore any rejected row rejects the complete file and leaves DB unchanged.
 */
class BatchProcessingService {
  constructor({ validationService, transactionService, fileBatchRepository }) {
    Object.assign(this, { validationService, transactionService, fileBatchRepository });
    this.batchSize = Constants.BATCH_SIZE;
  }
  async process(records, fileName, auditId) {
    const allRecords = [];
    const validRecords = [];
    const invalidRows = [];
    const duplicateContext = { mobiReferencesSeen: new Set(), hostReferencesSeen: new Set() };

    for (let startIndex = 0, batchNo = 1; startIndex < records.length; startIndex += this.batchSize, batchNo += 1) {
      const batchRows = records.slice(startIndex, startIndex + this.batchSize);
      const endIndex = startIndex + batchRows.length;
      await this.fileBatchRepository.markStarted(auditId, batchNo, fileName, startIndex, endIndex, batchRows.length);
      try {
        const validatedRows = await this.validationService.validateBatch(batchRows, duplicateContext);
        validatedRows.forEach((row, offset) => { row._ROW_NUMBER = startIndex + offset + 2; });
        const validRows = validatedRows.filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.VALID);
        const rejectedRows = validatedRows.filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.INVALID);
        allRecords.push(...validatedRows);
        validRecords.push(...validRows);
        invalidRows.push(...rejectedRows);
        // This records validation results only. No insert occurs in this loop.
        await this.fileBatchRepository.markCompleted(auditId, batchNo, validRows.length, rejectedRows.length);
      } catch (error) {
        await this.fileBatchRepository.markCompleted(auditId, batchNo, 0, batchRows.length, error.message);
        throw error;
      }
    }

    // Atomic file rule: any invalid row prevents all inserts.
    if (invalidRows.length) return { totalRows: records.length, validRecords, invalidRows, allRecords, insertedCount: 0 };

    // All rows are valid, so only now insert in controlled batches.
    for (let start = 0; start < validRecords.length; start += this.batchSize) {
      await this._insertWithRetry(validRecords.slice(start, start + this.batchSize));
    }
    return { totalRows: records.length, validRecords, invalidRows, allRecords, insertedCount: validRecords.length };
  }
  async _insertWithRetry(records, attempt = 1) {
    try { await this.transactionService.insertBatch(records); }
    catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return this._insertWithRetry(records, attempt + 1);
    }
  }
}
module.exports = BatchProcessingService;
