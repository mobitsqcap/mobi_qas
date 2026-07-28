const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');
const MasterRecord = require('../models/MasterRecord');
const MasterValidator = require('./MasterValidator');
const ValidationError = require('../models/ValidationError');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

class MasterCsvService {
  constructor() {
    this.validator = new MasterValidator();
  }

  parse(buffer, existingIdKeys = new Set()) {
    const { headers, rows } = CsvUtil.parseNormalized(buffer);

    try {
      this._validateHeaders(headers);
    } catch (error) {
      error.totalRows = rows.length;
      error.validCount = 0;
      error.errorCount = rows.length;
      throw error;
    }

    const records = rows.map((r, index) => MasterRecord.fromCsvRow(r, index + 2));
    const { validRecords, errorRows } = this.validator.validateRecords(records, { existingIdKeys });

    return {
      totalRows: rows.length,
      records: validRecords,
      errorRows,
      validCount: validRecords.length,
      errorCount: errorRows.length
    };
  }

  _validateHeaders(actualHeaders) {
    const missing = [];
    for (const logicalHeader of Constants.MASTER_REQUIRED_HEADERS) {
      const aliases = Constants.MASTER_HEADERS[logicalHeader] || [logicalHeader];
      if (!aliases.some((alias) => actualHeaders.includes(alias))) {
        missing.push(`${logicalHeader} (${aliases.join(' / ')})`);
      }
    }
    if (missing.length) {
      const error = new ValidationError('25', F.missingColumn(missing));
      error.code = '25';
      throw error;
    }
  }
}

module.exports = MasterCsvService;
