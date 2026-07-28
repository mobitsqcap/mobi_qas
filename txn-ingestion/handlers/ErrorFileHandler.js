const path = require('path');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const CsvUtil = require('../utils/CsvUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * ErrorFileHandler - produces two artefacts when a transaction file is rejected:
 *   1. Transactions_YYYYMMDD_ERRORS.csv - full original rows + row_number,
 *      error_code (2-digit), error_message (aggregated detail).
 *   2. Transactions_YYYYMMDD_text.file  - human readable summary with ALL
 *      errors per record (not one at a time).
 *
 * The handler is defensive: if the SFTP operations partially fail we still
 * return the artifact paths that DID succeed so the audit log can be updated.
 */
class ErrorFileHandler {
  constructor(sftpService) { this.sftpService = sftpService; }

  _resolveErrorDirectory(file, context = {}) {
    return context.paths?.ERROR_PATH || file?.paths?.ERROR_PATH
        || (context.errorPath ? path.posix.dirname(context.errorPath) : null);
  }

  async handle(file, rowsForErrorCsv, context = {}) {
    const errorDirectory = this._resolveErrorDirectory(file, context);
    if (!errorDirectory) {
      throw new Error(`ERROR path missing for file ${file.name}. Please check SFTP folder configuration.`);
    }

    const date8   = context.date8 || DateUtil.extractDate8(file.name) || 'UNKNOWN';
    const auditId = context.auditId || context.fileLog?.AUDIT_ID || '';

    const invalidRows = (rowsForErrorCsv || []).filter(
      (r) => r.ROW_STATUS === Constants.ROW_STATUS.INVALID || r.ERROR_CODE
    );

    const errorCsvPath  = `${errorDirectory}/${Constants.ERROR_NAMING.FAILED_CSV(date8)}`;
    const errorTextPath = `${errorDirectory}/${Constants.ERROR_NAMING.ERROR_TEXT(date8)}`;

    let csvUploaded = false, txtUploaded = false;

    try {
      await this.sftpService.uploadFile(errorCsvPath, this._buildFailedCsv(rowsForErrorCsv || []));
      csvUploaded = true;
    } catch (err) {
      console.error(`[ErrorFileHandler] Failed to upload error CSV: ${err.message}`);
    }

    try {
      await this.sftpService.uploadFile(errorTextPath, this._buildErrorTextFile(
        file.name, invalidRows, auditId, context.validCount || 0, context.errorCode, context.errorDetail
      ));
      txtUploaded = true;
    } catch (err) {
      console.error(`[ErrorFileHandler] Failed to upload error text: ${err.message}`);
    }

    // Try to move the source file into ERROR (best-effort)
    const candidates = [file.path, context.processingPath].filter(Boolean);
    for (const src of candidates) {
      try {
        const target = `${errorDirectory}/${file.name}`;
        if (src !== target) await this.sftpService.moveFile(src, target);
        file.path = target;
        break;
      } catch (err) {
        console.warn(`[ErrorFileHandler] Could not move source ${src} to ERROR: ${err.message}`);
      }
    }

    console.error(`[ErrorFileHandler] ${file.name} rejected: ${invalidRows.length} invalid row(s).`);
    return {
      errorCsvPath:  csvUploaded ? errorCsvPath : null,
      errorTextPath: txtUploaded ? errorTextPath : null
    };
  }

  _toSourceCsvRow(record) {
    const raw = record.RAW_ROW || {};
    const result = {};
    for (const h of Constants.TRANSACTION_CSV_COLUMNS) result[h] = raw[h] ?? '';
    return result;
  }

  _buildFailedCsv(rows) {
    const headers = [...Constants.TRANSACTION_CSV_COLUMNS, 'row_number', 'error_code', 'error_message'];
    const csvRows = rows.map((r) => ({
      ...this._toSourceCsvRow(r),
      row_number:    r._ROW_NUMBER || '',
      error_code:    r.ERROR_CODE   || '',
      error_message: r.ERROR_DETAIL || ''
    }));
    return Buffer.from(CsvUtil.serialize(headers, csvRows), 'utf-8');
  }

  _buildErrorTextFile(fileName, invalidRows, auditId, validCount = 0, errorCode, customDetail) {
    const sanitize = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();
    const detail = customDetail ||
      `${invalidRows.length} record(s) failed validation. Entire file rejected; ${validCount} otherwise-valid record(s) were not inserted.`;

    const lines = [
      `FILE NAME       : ${fileName}`,
      `AUDIT ID        : ${auditId}`,
      `ERROR CODE      : ${errorCode || 'FILE_VALIDATION_FAILED'}`,
      `ERROR DETAIL    : ${sanitize(detail)}`,
      `EXPECTED FORMAT : ${Constants.EXPECTED_FORMAT}`,
      `GENERATED AT    : ${DateUtil.nowTimestamp()}`,
      '',
      'S.NO | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | PAYMENT_TYPE | COMPANY_CODE | MOBI_PORTAL_CODE | ERROR_CODE | ERROR_DETAIL'
    ];

    invalidRows.forEach((row, idx) => lines.push([
      idx + 1,
      auditId,
      row._ROW_NUMBER || '',
      row.MOBI_REFERENCE_ID || '',
      row.PAYMENT_TYPE || '',
      row.COMPANY_CODE || '',
      row.MOBI_PORTAL_CODE || '',
      row.ERROR_CODE || '',
      sanitize(row.ERROR_DETAIL)
    ].join(' | ')));

    return Buffer.from(lines.join('\n'), 'utf-8');
  }
}

module.exports = ErrorFileHandler;
