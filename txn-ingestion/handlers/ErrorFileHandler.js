const path = require('path');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const CsvUtil = require('../utils/CsvUtil');
class ErrorFileHandler {
  constructor(sftpService) { this.sftpService = sftpService; }
  _resolveErrorDirectory(file, context = {}) { return context.paths?.ERROR_PATH || file?.paths?.ERROR_PATH || (context.errorPath ? path.posix.dirname(context.errorPath) : null); }
  async handle(file, rowsForErrorCsv, context = {}) {
    const errorDirectory = this._resolveErrorDirectory(file, context);
    if (!errorDirectory) throw new Error(`ERROR path missing for file ${file.name}`);
    const date8 = context.date8 || DateUtil.extractDate8(file.name) || 'UNKNOWN';
    const auditId = context.auditId || context.fileLog?.AUDIT_ID || '';
    const invalidRows = (rowsForErrorCsv || []).filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.INVALID || row.ERROR_CODE);
    // rowsForErrorCsv is deliberately the COMPLETE input file, not just rejected rows.
    const errorCsvPath = `${errorDirectory}/${Constants.ERROR_NAMING.FAILED_CSV(date8)}`;
    const errorTextPath = `${errorDirectory}/${Constants.ERROR_NAMING.ERROR_TEXT(date8)}`;
    await this.sftpService.uploadFile(errorCsvPath, this._buildFailedCsv(rowsForErrorCsv || []));
    await this.sftpService.uploadFile(errorTextPath, this._buildErrorTextFile(file.name, invalidRows, auditId, context.validCount || 0, context.errorCode, context.errorDetail));
    console.error(`[ErrorFileHandler] ${file.name} -> file rejected; ${invalidRows.length} invalid row(s), ${rowsForErrorCsv.length} row(s) written to ${errorDirectory}`);
    return { errorCsvPath, errorTextPath };
  }
  _toSourceCsvRow(record) {
    const raw = record._RAW_ROW || {};
    const result = {};
    for (const header of Constants.TRANSACTION_CSV_COLUMNS) result[header] = raw[header] ?? '';
    return result;
  }
  _buildFailedCsv(rows) {
    const headers = [...Constants.TRANSACTION_CSV_COLUMNS, 'row_number', 'error_code', 'error_message'];
    const csvRows = rows.map((row) => ({ ...this._toSourceCsvRow(row), row_number: row._ROW_NUMBER || '', error_code: row.ERROR_CODE || '', error_message: row.ERROR_DETAIL || '' }));
    return Buffer.from(CsvUtil.serialize(headers, csvRows), 'utf-8');
  }
  _buildErrorTextFile(fileName, invalidRows, auditId, validCount = 0, errorCode = 'FILE_VALIDATION_FAILED', customDetail = '') {
    const sanitize = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const detail = customDetail || `${invalidRows.length} record(s) failed validation. Entire file rejected; ${validCount} otherwise-valid record(s) were not inserted.`;
    const lines = [`FILE NAME       : ${fileName}`, `AUDIT ID        : ${auditId}`, `ERROR CODE      : ${errorCode}`, `ERROR DETAIL    : ${detail}`, `GENERATED AT    : ${DateUtil.nowTimestamp()}`, '', '[S.NO] | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | PAYMENT_TYPE | COMPANY_CODE | MOBI_PORTAL_CODE | ERROR_CODE | ERROR_DETAIL'];
    invalidRows.forEach((row, index) => lines.push([index + 1, auditId, row._ROW_NUMBER || '', row.MOBI_REFERENCE_ID || '', row.PAYMENT_TYPE || '', row.COMPANY_CODE || '', row.MOBI_PORTAL_CODE || '', row.ERROR_CODE || '', sanitize(row.ERROR_DETAIL)].join(' | ')));
    return Buffer.from(lines.join('\n'), 'utf-8');
  }
}
module.exports = ErrorFileHandler;






// const path = require('path');
// const Constants = require('../utils/Constants');
// const DateUtil = require('../utils/DateUtil');
// const CsvUtil = require('../utils/CsvUtil');
// class ErrorFileHandler {
//   constructor(sftpService) { this.sftpService = sftpService; }
//   _resolveErrorDirectory(file, context = {}) { return context.paths?.ERROR_PATH || file?.paths?.ERROR_PATH || (context.errorPath ? path.posix.dirname(context.errorPath) : null); }
//   async handle(file, rowsForErrorCsv, context = {}) {
//     const errorDirectory = this._resolveErrorDirectory(file, context);
//     if (!errorDirectory) throw new Error(`ERROR path missing for file ${file.name}`);
//     const date8 = context.date8 || DateUtil.extractDate8(file.name) || 'UNKNOWN';
//     const auditId = context.auditId || context.fileLog?.AUDIT_ID || '';
//     const invalidRows = (rowsForErrorCsv || []).filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.INVALID || row.ERROR_CODE);
//     // rowsForErrorCsv is deliberately the COMPLETE input file, not just rejected rows.
//     const errorCsvPath = `${errorDirectory}/${Constants.ERROR_NAMING.FAILED_CSV(date8)}`;
//     const errorTextPath = `${errorDirectory}/${Constants.ERROR_NAMING.ERROR_TEXT(date8)}`;
//     await this.sftpService.uploadFile(errorCsvPath, this._buildFailedCsv(rowsForErrorCsv || []));
//     await this.sftpService.uploadFile(errorTextPath, this._buildErrorTextFile(file.name, invalidRows, auditId, context.validCount || 0));
//     console.error(`[ErrorFileHandler] ${file.name} -> file rejected; ${invalidRows.length} invalid row(s), ${rowsForErrorCsv.length} row(s) written to ${errorDirectory}`);
//     return { errorCsvPath, errorTextPath };
//   }
//   _toSourceCsvRow(record) {
//     const raw = record._RAW_ROW || {};
//     const result = {};
//     for (const header of Constants.TRANSACTION_CSV_COLUMNS) result[header] = raw[header] ?? '';
//     return result;
//   }
//   _buildFailedCsv(rows) {
//     const headers = [...Constants.TRANSACTION_CSV_COLUMNS, 'row_number', 'error_code', 'error_message'];
//     const csvRows = rows.map((row) => ({ ...this._toSourceCsvRow(row), row_number: row._ROW_NUMBER || '', error_code: row.ERROR_CODE || '', error_message: row.ERROR_DETAIL || '' }));
//     return Buffer.from(CsvUtil.serialize(headers, csvRows), 'utf-8');
//   }
//   _buildErrorTextFile(fileName, invalidRows, auditId, validCount = 0) {
//     const sanitize = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
//     const detail = `${invalidRows.length} record(s) failed validation. Entire file rejected; ${validCount} otherwise-valid record(s) were not inserted.`;
//     const lines = [`FILE NAME       : ${fileName}`, `AUDIT ID        : ${auditId}`, 'ERROR CODE      : FILE_VALIDATION_FAILED', `ERROR DETAIL    : ${detail}`, `GENERATED AT    : ${DateUtil.nowTimestamp()}`, '', '[S.NO] | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | PAYMENT_TYPE | COMPANY_CODE | MOBI_PORTAL_CODE | ERROR_CODE | ERROR_DETAIL'];
//     invalidRows.forEach((row, index) => lines.push([index + 1, auditId, row._ROW_NUMBER || '', row.MOBI_REFERENCE_ID || '', row.PAYMENT_TYPE || '', row.COMPANY_CODE || '', row.MOBI_PORTAL_CODE || '', row.ERROR_CODE || '', sanitize(row.ERROR_DETAIL)].join(' | ')));
//     return Buffer.from(lines.join('\n'), 'utf-8');
//   }
// }
// module.exports = ErrorFileHandler;




// const path = require('path');
// const Constants = require('../utils/Constants');
// const DateUtil = require('../utils/DateUtil');
// const CsvUtil = require('../utils/CsvUtil');

// class ErrorFileHandler {
//   constructor(sftpService) { this.sftpService = sftpService; }

//   _resolveErrorDirectory(file, context = {}) { return context?.paths?.ERROR_PATH || file?.paths?.ERROR_PATH || (context?.errorPath ? path.posix.dirname(context.errorPath) : null); }

//   async handle(file, invalidRows, context = {}) {
//     const errorDirectory = this._resolveErrorDirectory(file, context);
//     if (!errorDirectory) throw new Error(`ERROR path missing for file ${file.name}`);
//     const date8 = context.date8 || DateUtil.extractDate8(file.name) || 'UNKNOWN';
//     const auditId = context.auditId || context.fileLog?.AUDIT_ID || '';
//     const validCount = Number(context.validCount || 0);

//     if (invalidRows?.length) {
//       const failedCsv = this._buildFailedCsv(invalidRows);
//       await this.sftpService.uploadFile(`${errorDirectory}/${Constants.ERROR_NAMING.FAILED_CSV(date8)}`, failedCsv);
//     }
//     const textBuf = this._buildErrorTextFile(file.name, invalidRows, auditId, validCount);
//     await this.sftpService.uploadFile(`${errorDirectory}/${Constants.ERROR_NAMING.ERROR_TEXT(date8)}`, textBuf);
//     console.error(`[ErrorFileHandler] ${file.name} -> ${invalidRows.length} error(s) written to ${errorDirectory}`);
//   }

//   _toSourceCsvRow(record) {
//     const raw = record._RAW_ROW || {};
//     return { mobi_portal_code: raw.mobi_portal_code ?? record.MOBI_PORTAL_CODE ?? '', sap_company_code: raw.sap_company_code ?? record.COMPANY_CODE ?? '', payment_type: raw.payment_type ?? record.PAYMENT_TYPE ?? '', payment_sub_type: raw.payment_sub_type ?? record.PAYMENT_SUB_TYPE ?? '', mobi_reference_id: raw.mobi_reference_id ?? record.MOBI_REFERENCE_ID ?? '', merchant_id: raw.merchant_id ?? record.MERCHANT_ID ?? '', merchant_type: raw.merchant_type ?? record.MERCHANT_TYPE ?? '', merchant_name: raw.merchant_name ?? record.MERCHANT_NAME ?? '', txn_created_date: raw.txn_created_date ?? record.TXN_CREATED_DATE ?? '', txn_paid_date: raw.txn_paid_date ?? record.TXN_PAID_DATE ?? '', txn_time_created: raw.txn_time_created ?? record.TXN_CREATED_TIME ?? '', txn_time_paid: raw.txn_time_paid ?? record.TXN_PAID_TIME ?? '', payment_method: raw.payment_method ?? record.PAYMENT_METHOD ?? '', host_name: raw.host_name ?? record.HOST_NAME ?? '', transaction_amount: raw.transaction_amount ?? record.TXN_AMOUNT ?? '', host_mdr_amount: raw.host_mdr_amount ?? record.HOST_MDR_AMOUNT ?? '', host_fee_payable: raw.host_fee_payable ?? record.HOST_FEE_PAYABLE ?? '', mobi_mdr_amount: raw.mobi_mdr_amount ?? record.MOBI_MDR_AMOUNT ?? '', mdr_revenue: raw.mdr_revenue ?? record.MDR_REVENUE ?? '', ar_payin: raw.ar_payin ?? record.AR_PAYIN ?? '', ap_payin: raw.ap_payin ?? record.AP_PAYIN ?? '', ap_payout: raw.ap_payout ?? record.AP_PAYOUT ?? '', host_reference_id: raw.host_reference_id ?? record.HOST_REFERENCE_ID ?? '', merchant_reference_id: raw.merchant_reference_id ?? record.MERCHANT_REFERENCE_ID ?? '', transaction_status: raw.transaction_status ?? record.TXN_STATUS ?? '', original_amount: raw.original_amount ?? record.ORIGINAL_AMOUNT ?? '', transaction_currency: raw.transaction_currency ?? record.TXN_CURRENCY ?? '', settled_in_currency: raw.settled_in_currency ?? record.SETTLED_IN_CURRENCY ?? '', time_zone: raw.time_zone ?? record.TIME_ZONE ?? '', conversion_rate: raw.conversion_rate ?? record.CONVERSION_RATE ?? '' };
//   }

//   _buildFailedCsv(invalidRows) {
//     const headers = [...Constants.TRANSACTION_CSV_COLUMNS, 'row_number', 'error_code', 'error_message'];
//     const rows = invalidRows.map((r) => ({ ...this._toSourceCsvRow(r), row_number: r._ROW_NUMBER || '', error_code: r.ERROR_CODE || '', error_message: r.ERROR_DETAIL || '' }));
//     return Buffer.from(CsvUtil.serialize(headers, rows), 'utf-8');
//   }

//   _buildErrorTextFile(fileName, invalidRows, auditId, validCount = 0) {
//     const sanitize = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();
//     const detail = validCount > 0 ? `${invalidRows.length} record(s) failed. ${validCount} valid. HANA insert deferred.` : `${invalidRows.length} record(s) failed. No HANA insert.`;
//     const lines = [`FILE NAME       : ${fileName}`, `AUDIT ID        : ${auditId}`, `ERROR CODE      : ROW_VALIDATION_FAILED`, `ERROR DETAIL    : ${detail}`, `GENERATED AT    : ${DateUtil.nowTimestamp()}`, '', '', 'S.NO | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | PAYMENT_TYPE | COMPANY_CODE | MOBI_PORTAL_CODE | ERROR_CODE | ERROR_DETAIL'];
//     invalidRows.forEach((row, i) => { lines.push([i + 1, auditId, row._ROW_NUMBER || '', row.MOBI_REFERENCE_ID || '', row.PAYMENT_TYPE || '', row.COMPANY_CODE || '', row.MOBI_PORTAL_CODE || '', row.ERROR_CODE || '', sanitize(row.ERROR_DETAIL || '')].join(' | ')); });
//     return Buffer.from(lines.join('\n'), 'utf-8');
//   }
// }
// module.exports = ErrorFileHandler;
