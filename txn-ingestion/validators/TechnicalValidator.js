const Constants = require('../utils/Constants');
const F = require('../utils/StatusCodeUtil').FRIENDLY;

const EXPONENTIAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;

/**
 * TechnicalValidator - collects ALL technical errors for a record (not just
 * the first). All codes are 2-digit codes aligned with MOBI_DB_STATUS.
 */
class TechnicalValidator {
  validate(record) {
    const errors = [];

    if (record.ERROR_CODE === 'INVALID_DATE' ||
        (record.ERROR_DETAIL && record.ERROR_DETAIL.startsWith('INVALID_DATE'))) {
      errors.push({
        code: Constants.ERROR_CODES.INVALID_DATE,
        message: F.invalidDate(String(record.ERROR_DETAIL).replace(/^INVALID_DATE_FORMAT: /, ''))
      });
    }

    if (!record.COMPANY_CODE) {
      errors.push({ code: Constants.ERROR_CODES.MISSING_COMPANY_CODE, message: F.missingField('COMPANY_CODE') });
    } else if (!/^[A-Za-z0-9]{1,4}$/.test(String(record.COMPANY_CODE).trim())) {
      errors.push({ code: '12', message: `Company code must be 1-4 alphanumeric characters: ${record.COMPANY_CODE}` });
    }

    if (!record.MOBI_PORTAL_CODE) {
      errors.push({ code: Constants.ERROR_CODES.MISSING_PORTAL_CODE, message: F.missingField('MOBI_PORTAL_CODE') });
    }

    if (!record.PAYMENT_TYPE) {
      errors.push({ code: Constants.ERROR_CODES.MISSING_PAYMENT_TYPE, message: F.missingField('PAYMENT_TYPE') });
    }

    if (!record.PAYMENT_SUB_TYPE) {
      errors.push({ code: Constants.ERROR_CODES.MISSING_PAYMENT_SUB_TYPE, message: F.missingField('PAYMENT_SUB_TYPE') });
    }

    if (!record.MERCHANT_ID) {
      errors.push({ code: Constants.ERROR_CODES.MISSING_MERCHANT_ID, message: F.missingField('MERCHANT_ID') });
    }

    if (!record.HOST_NAME) {
      errors.push({ code: Constants.ERROR_CODES.MISSING_HOST_ID, message: F.missingField('HOST_NAME') });
    }

    for (const [field, value] of [
      ['MOBI_REFERENCE_ID', record.MOBI_REFERENCE_ID],
      ['HOST_REFERENCE_ID', record.HOST_REFERENCE_ID]
    ]) {
      const text = String(value || '').trim();
      if (text.length > Constants.MAX_REF_ID_LENGTH) {
        errors.push({
          code: Constants.ERROR_CODES.REF_TOO_LONG,
          message: F.refTooLong(field, Constants.MAX_REF_ID_LENGTH)
        });
      }
      if (EXPONENTIAL.test(text)) {
        errors.push({ code: Constants.ERROR_CODES.EXPONENTIAL_REF, message: F.exponentialRef(field, text) });
      }
    }

    if (errors.length === 0) return { valid: true, errors: [] };
    return { valid: false, errors };
  }
}

module.exports = TechnicalValidator;
