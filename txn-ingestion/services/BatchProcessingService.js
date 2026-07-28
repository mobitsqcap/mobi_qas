const Constants = require('../utils/Constants');

/**
 * BatchProcessingService - validates every batch BEFORE any DB insert. If any
 * row across the whole file is invalid, the entire file is rejected (atomic
 * file rule). All errors for a single record are aggregated into one ERROR_DETAIL
 * string by ValidationService and written through repositories / audit.
 */
class BatchProcessingService {
  constructor({ validationService, transactionService, fileBatchRepository,
                batchSize, dbChunkSize }) {
    Object.assign(this, { validationService, transactionService, fileBatchRepository });
    this.batchSize = Number(batchSize || process.env.BATCH_SIZE || Constants.BATCH_SIZE || 2000);
    this.dbChunkSize = Number(dbChunkSize || process.env.DB_CHUNK_SIZE || this.batchSize);
  }

  async process(records, fileName, auditId) {
    const allRecords = [];
    const validRecords = [];
    const invalidRows = [];
    const duplicateContext = { mobiReferencesSeen: new Set(), hostReferencesSeen: new Set() };

    for (let startIndex = 0, batchNo = 1; startIndex < records.length; startIndex += this.batchSize, batchNo++) {
      const batchRows = records.slice(startIndex, startIndex + this.batchSize);
      const endIndex = startIndex + batchRows.length;

      await this.fileBatchRepository.markStarted(auditId, batchNo, fileName, startIndex, endIndex, batchRows.length);

      try {
        const validated = await this.validationService.validateBatch(batchRows, duplicateContext);
        validated.forEach((row, offset) => { row._ROW_NUMBER = startIndex + offset + 2; });

        const valid   = validated.filter((r) => r.ROW_STATUS === Constants.ROW_STATUS.VALID);
        const invalid = validated.filter((r) => r.ROW_STATUS === Constants.ROW_STATUS.INVALID);

        allRecords.push(...validated);
        validRecords.push(...valid);
        invalidRows.push(...invalid);

        await this.fileBatchRepository.markCompleted(auditId, batchNo, valid.length, invalid.length);
      } catch (error) {
        await this.fileBatchRepository.markCompleted(auditId, batchNo, 0, batchRows.length, error.message);
        throw error;
      }
    }

    if (invalidRows.length) {
      return { totalRows: records.length, validRecords, invalidRows, allRecords, insertedCount: 0 };
    }

    for (let start = 0; start < validRecords.length; start += this.batchSize) {
      await this._insertWithRetry(validRecords.slice(start, start + this.batchSize));
    }

    return { totalRows: records.length, validRecords, invalidRows, allRecords, insertedCount: validRecords.length };
  }

  async _insertWithRetry(records, attempt = 1) {
    try {
      await this.transactionService.insertBatch(records);
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, attempt * 1000));
      return this._insertWithRetry(records, attempt + 1);
    }
  }
}

module.exports = BatchProcessingService;
