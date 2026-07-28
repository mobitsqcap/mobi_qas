/**
 * Layman-friendly error messages for master ingestion.
 *
 * Error rows aggregate ALL errors per record (not just the first), so
 * the summary/list text lists every error. Codes are 2-digit (see Constants
 * and StatusCodeUtil); both code and text are shown in the text error file
 * and in MOBI_DB_AUDIT.ERROR_DETAIL.
 */
const StatusCodeUtil = require('./StatusCodeUtil');
const Constants = require('./Constants');

const CODE_FRIENDLY = {
  '08': 'Missing required field(s)',
  '09': 'Data exceeds maximum field length',
  '10': 'Invalid merchant type (allowed: Domestic, International, Host)',
  '11': 'Invalid portal code (allowed: SG, MY, IN, ID, AE)',
  '12': 'Invalid company code (allowed: 1000, 2000, 3000, 4000, 5000)',
  '13': 'Invalid 2-letter ISO country code',
  '07': 'Duplicate file',
  '05': 'Business partner already exists in the system',
  '06': 'Same BP ID exists under a different company code',
  '25': 'CSV header is missing required columns'
};

class ErrorMessageUtil {
  static generateFileErrorSummary(errorRows, totalRows, validCount, errorCount) {
    if (!errorRows || !errorRows.length) return '';

    const byCode = new Map();
    for (const err of errorRows) {
      const codes = String(err.errorCode || '').split(',').map((c) => c.trim()).filter(Boolean);
      for (const code of codes) byCode.set(code, (byCode.get(code) || 0) + 1);
    }

    const parts = [];
    for (const [code, count] of byCode.entries()) {
      const text = CODE_FRIENDLY[code] || StatusCodeUtil.toText('MASTER', code) || 'Validation error';
      parts.push(`${count} record(s) - [${code}] ${text}`);
    }

    const summary = parts.join('; ');
    return (summary.length > 255 ? summary.substring(0, 252) + '...' : summary);
  }

  static getFriendlyMessage(errorCode, technicalDetail = '') {
    if (CODE_FRIENDLY[errorCode]) return CODE_FRIENDLY[errorCode];
    const fromMap = StatusCodeUtil.toText('MASTER', errorCode);
    if (fromMap && fromMap !== errorCode) return fromMap;
    return technicalDetail || 'Validation error';
  }

  /**
   * Aggregate errors for a single record into a single line for the text
   * error file. Example: "[08] Mandatory field COUNTRY_CODE missing; [13] Invalid country code XX"
   */
  static aggregateRecordErrors(errors) {
    if (!errors || !errors.length) return '';
    return errors.map((e) => `[${e.code || 'XX'}] ${e.message}`).join('; ');
  }

  static generateAuditErrorDetail(errorRows) {
    if (!errorRows || !errorRows.length) return '';
    const byCode = new Map();
    for (const err of errorRows) {
      const codes = String(err.errorCode || '').split(',').map((c) => c.trim()).filter(Boolean);
      for (const code of codes) byCode.set(code, (byCode.get(code) || 0) + 1);
    }
    const parts = [];
    for (const [code, count] of byCode.entries()) {
      parts.push(`${count}x [${code}] ${this.getFriendlyMessage(code)}`);
    }
    return parts.join('; ').substring(0, 255);
  }
}

module.exports = ErrorMessageUtil;
