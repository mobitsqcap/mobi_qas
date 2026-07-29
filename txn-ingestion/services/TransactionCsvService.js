const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');
const TransactionRecord = require('../models/TransactionRecord');

class TransactionCsvService {
  parse(buffer, auditId) {
    const { headers, rows } = CsvUtil.parseNormalized(buffer);
    try { this._validateHeaders(headers); }
    catch (error) { error.totalRows = rows.length; error.validCount = 0; error.errorCount = rows.length; throw error; }
    return { auditId, totalRows: rows.length, records: rows.map((row) => TransactionRecord.fromCsvRow(row, auditId)) };
  }
  _validateHeaders(actualHeaders) {
    const expected = Constants.TRANSACTION_CSV_COLUMNS;
    const missing = expected.filter((h) => !actualHeaders.includes(h));
    const extra = actualHeaders.filter((h) => !expected.includes(h));
    if (missing.length) { const e = new Error(`CSV_HEADER_MISMATCH: Missing required transaction columns: [${missing.join(', ')}]${extra.length ? `. Unexpected: [${extra.join(', ')}]` : ''}`); e.code = 'CSV_HEADER_MISMATCH'; throw e; }
  }
}
module.exports = TransactionCsvService;
