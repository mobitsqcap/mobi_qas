const ISO_CURRENCY_REGEX = /^[A-Z]{3}$/;
class CurrencyValidator {
  validate(record) {
    if (!ISO_CURRENCY_REGEX.test(record.TXN_CURRENCY || '')) return { valid: false, code: 'INVALID_CURRENCY', message: `Invalid currency ${record.TXN_CURRENCY}` };
    return { valid: true };
  }
}
module.exports = CurrencyValidator;

// const Constants = require('../utils/Constants');
// class CurrencyValidator {
//   validate(record) {
//     const currency = String(record.TXN_CURRENCY || '').trim().toUpperCase();
//     if (!Constants.ALLOWED_TRANSACTION_CURRENCIES.has(currency)) return { valid: false, code: 'INVALID_CURRENCY', message: `Unsupported transaction currency ${record.TXN_CURRENCY}` };
//     return { valid: true };
//   }
// }
// module.exports = CurrencyValidator;
