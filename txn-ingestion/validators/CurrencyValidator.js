const Constants = require('../utils/Constants');
const F = require('../utils/StatusCodeUtil').FRIENDLY;

const ISO = /^[A-Z]{3}$/;

class CurrencyValidator {
  validate(record) {
    const errors = [];

    if (!ISO.test(record.TXN_CURRENCY || '')) {
      errors.push({ code: Constants.ERROR_CODES.INVALID_CURRENCY, message: F.invalidCurrency(record.TXN_CURRENCY) });
    } else if (!Constants.ALLOWED_TRANSACTION_CURRENCIES.has(record.TXN_CURRENCY)) {
      errors.push({
        code: Constants.ERROR_CODES.INVALID_CURRENCY,
        message: `Currency "${record.TXN_CURRENCY}" is not configured for this environment. ` +
                 `Allowed: ${[...Constants.ALLOWED_TRANSACTION_CURRENCIES].join(', ')}.`
      });
    }

    if (errors.length === 0) return { valid: true, errors: [] };
    return { valid: false, errors };
  }
}

module.exports = CurrencyValidator;
