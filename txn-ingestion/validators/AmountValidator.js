const Constants = require('../utils/Constants');
const F = require('../utils/StatusCodeUtil').FRIENDLY;

class AmountValidator {
  validate(record) {
    const errors = [];

    if (Number.isNaN(record.TXN_AMOUNT) || record.TXN_AMOUNT <= 0) {
      errors.push({ code: Constants.ERROR_CODES.INVALID_AMOUNT, message: F.invalidAmount(record.TXN_AMOUNT) });
    }

    if (errors.length === 0) return { valid: true, errors: [] };
    return { valid: false, errors };
  }
}

module.exports = AmountValidator;
