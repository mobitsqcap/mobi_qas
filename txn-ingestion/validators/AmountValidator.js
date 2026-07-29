class AmountValidator {
  validate(record) {
    if (Number.isNaN(record.TXN_AMOUNT) || record.TXN_AMOUNT <= 0) return { valid: false, code: 'INVALID_AMOUNT', message: `Invalid amount ${record.TXN_AMOUNT}` };
    return { valid: true };
  }
}
module.exports = AmountValidator;
