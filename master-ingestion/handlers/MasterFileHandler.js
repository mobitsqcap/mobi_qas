const BaseFileHandler = require('./BaseFileHandler');

/**
 * MasterFileHandler
 *
 * CHANGED vs the original: both complete() calls now also pass validRecords +
 * inserted, so BaseFileHandler can write SUCCESS rows and not just FAILED ones.
 *
 * Flow, ordering and upsert behaviour are unchanged. Note the partial case:
 * when some rows fail, master STILL upserts the valid ones (existing
 * behaviour), so inserted:true is correct there.
 */
class MasterFileHandler extends BaseFileHandler {
  constructor(deps) { super(deps); }

  async process(file, executionContext = {}, handlerOpts = {}) {
    let context;
    try {
      context = await this.begin(file, executionContext);
      context = await this.prepare(file, context);

      const existingIdKeys = handlerOpts?.existingIdKeys || new Set();
      const parsed = this.csvService.parse(context.buffer, existingIdKeys);

      await this.markPicked(context, parsed.totalRows, parsed.validCount, parsed.errorCount);

      if (parsed.errorRows && parsed.errorRows.length > 0) {
        const validationError = new Error(`Row validation failed for ${parsed.errorCount} record(s).`);
        validationError.code = '04';
        validationError.errorRows  = parsed.errorRows;
        validationError.totalRows  = parsed.totalRows;
        validationError.validCount = parsed.validCount;
        validationError.errorCount = parsed.errorCount;

        let inserted = false;
        if (parsed.records && parsed.records.length > 0) {
          await this.masterUpsertService.upsertBatch(
            parsed.records, context.fileLog.FILE_ID, file.name, context.auditId
          );
          inserted = true;
        }

        await this.complete(file, context, {
          totalRows:  parsed.totalRows,
          validCount: validationError.validCount,
          errorCount: validationError.errorCount,
          invalidRows: validationError.errorRows,
          validRecords: parsed.records || [],   // ADDED
          inserted                               // ADDED
        });
        return;
      }

      let inserted = false;
      if (parsed.records && parsed.records.length > 0) {
        await this.masterUpsertService.upsertBatch(
          parsed.records, context.fileLog.FILE_ID, file.name, context.auditId
        );
        inserted = true;
      }

      await this.complete(file, context, {
        totalRows:  parsed.totalRows,
        validCount: parsed.validCount,
        errorCount: parsed.errorCount,
        invalidRows: [],
        validRecords: parsed.records || [],     // ADDED
        inserted                                 // ADDED
      });
    } catch (error) {
      await this.fail(file, context, error);
    }
  }
}

module.exports = MasterFileHandler;
