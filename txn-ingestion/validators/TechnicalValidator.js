// class TechnicalValidator {
//   validate(record) {
//     if (record.ERROR_CODE === 'INVALID_DATE') return { valid: false, code: record.ERROR_CODE, message: record.ERROR_DETAIL };
//     if (!record.COMPANY_CODE) return { valid: false, code: 'MISSING_COMPANY_CODE', message: 'Company code missing' };
//     if (!record.PAYMENT_TYPE) return { valid: false, code: 'MISSING_PAYMENT_TYPE', message: 'Payment type missing' };
//     if (!record.MERCHANT_ID) return { valid: false, code: 'MISSING_MERCHANT_ID', message: 'Merchant id missing' };
//     return { valid: true };
//   }
// }
// module.exports = TechnicalValidator;



// const Constants = require('../utils/Constants');
// const EXPONENTIAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;
// class TechnicalValidator {
//   validate(record) {
//     if (record.ERROR_CODE === 'INVALID_DATE') return { valid: false, code: record.ERROR_CODE, message: record.ERROR_DETAIL };
//     if (!record.COMPANY_CODE) return { valid: false, code: 'MISSING_COMPANY_CODE', message: 'Company code missing' };
//     if (!record.MOBI_PORTAL_CODE) return { valid: false, code: 'MISSING_PORTAL_CODE', message: 'MOBI portal code missing' };
//     if (!record.PAYMENT_TYPE) return { valid: false, code: 'MISSING_PAYMENT_TYPE', message: 'Payment type missing' };
//     if (!record.PAYMENT_SUB_TYPE) return { valid: false, code: 'MISSING_PAYMENT_SUB_TYPE', message: 'Payment sub type missing' };
//     if (!record.MERCHANT_ID) return { valid: false, code: 'MISSING_MERCHANT_ID', message: 'Merchant id missing' };
//     if (!record.HOST_NAME) return { valid: false, code: 'MISSING_HOST_ID', message: 'Host name missing' };
//     for (const [field, value] of [['MOBI_REFERENCE_ID', record.MOBI_REFERENCE_ID], ['HOST_REFERENCE_ID', record.HOST_REFERENCE_ID]]) {
//       const text = String(value || '').trim();
//       if (text.length > Constants.MAX_REF_ID_LENGTH) return { valid: false, code: 'REFERENCE_ID_TOO_LONG', message: `${field} exceeds ${Constants.MAX_REF_ID_LENGTH} characters` };
//       if (EXPONENTIAL_NUMBER.test(text)) return { valid: false, code: 'EXPONENTIAL_REFERENCE_ID', message: `${field} must not be an exponential value: ${text}` };
//     }
//     return { valid: true };
//   }
// }
// module.exports = TechnicalValidator;



const Constants = require('../utils/Constants');
const EXPONENTIAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;
class TechnicalValidator {
  validate(record) {
    if (record.ERROR_CODE === 'INVALID_DATE') return { valid: false, code: record.ERROR_CODE, message: record.ERROR_DETAIL };
    if (!record.COMPANY_CODE) return { valid: false, code: 'MISSING_COMPANY_CODE', message: 'Company code missing' };
    // Company code is a String(4); accept only letters and digits, never special characters.
    if (!/^[A-Za-z0-9]{1,4}$/.test(String(record.COMPANY_CODE).trim())) return { valid: false, code: 'INVALID_COMPANY_CODE', message: `Company code must be 1-4 alphanumeric characters: ${record.COMPANY_CODE}` };
    if (!record.MOBI_PORTAL_CODE) return { valid: false, code: 'MISSING_PORTAL_CODE', message: 'MOBI portal code missing' };
    if (!record.PAYMENT_TYPE) return { valid: false, code: 'MISSING_PAYMENT_TYPE', message: 'Payment type missing' };
    if (!record.PAYMENT_SUB_TYPE) return { valid: false, code: 'MISSING_PAYMENT_SUB_TYPE', message: 'Payment sub type missing' };
    if (!record.MERCHANT_ID) return { valid: false, code: 'MISSING_MERCHANT_ID', message: 'Merchant id missing' };
    if (!record.HOST_NAME) return { valid: false, code: 'MISSING_HOST_ID', message: 'Host ID/name missing' };
    for (const [field, value] of [['MOBI_REFERENCE_ID', record.MOBI_REFERENCE_ID], ['HOST_REFERENCE_ID', record.HOST_REFERENCE_ID]]) {
      const text = String(value || '').trim();
      if (text.length > Constants.MAX_REF_ID_LENGTH) return { valid: false, code: 'REFERENCE_ID_TOO_LONG', message: `${field} exceeds ${Constants.MAX_REF_ID_LENGTH} characters` };
      if (EXPONENTIAL_NUMBER.test(text)) return { valid: false, code: 'EXPONENTIAL_REFERENCE_ID', message: `${field} must not be an exponential value: ${text}` };
    }
    return { valid: true };
  }
}
module.exports = TechnicalValidator;
