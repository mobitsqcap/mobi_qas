const Constants = require('../utils/Constants');
const ALLOWED_STATUS = new Set(['SUCCESS', 'FAILED', 'PENDING', 'RETURN', 'FAILURE']);

class BusinessValidator {
  validate(record) {
    const status = String(record.TXN_STATUS || '').trim().toUpperCase();
    const type = String(record.PAYMENT_TYPE || '').trim().toUpperCase();
    const subtype = String(record.PAYMENT_SUB_TYPE || '').trim().toUpperCase();
    if (!ALLOWED_STATUS.has(status)) return { valid: false, code: 'INVALID_TXN_STATUS', message: `Unsupported status ${record.TXN_STATUS}` };

    const p = Constants.PAYMENT;
    if (p.PAYIN_TYPE_ALIASES.has(type)) {
      if (!p.PAYIN_SUBTYPE_ALIASES.has(subtype)) return { valid: false, code: 'INVALID_PAYMENT_SUB_TYPE', message: `Unsupported PAYIN subtype ${record.PAYMENT_SUB_TYPE}` };
      return { valid: true };
    }
    if (p.PAYOUT_TYPE_ALIASES.has(type)) {
      if (!p.PAYOUT_SUBTYPE_ALIASES.has(subtype) && !p.DS_SUBTYPE_ALIASES.has(subtype)) return { valid: false, code: 'INVALID_PAYMENT_SUB_TYPE', message: `Unsupported PAYOUT subtype ${record.PAYMENT_SUB_TYPE}` };
      return { valid: true };
    }
    return { valid: false, code: 'INVALID_PAYMENT_TYPE', message: `Unsupported payment type ${record.PAYMENT_TYPE}` };
  }
}
module.exports = BusinessValidator;


// const ALLOWED_STATUS = ['SUCCESS', 'FAILED', 'PENDING', 'RETURN', 'FAILURE'];
// const ALLOWED_TYPES = ['PAYIN', 'PAYINS', 'PAYOUT', 'PAYOUTS', 'WITHDRAWAL', 'DEPOSIT'];
// class BusinessValidator {
//   validate(record) {
//     const status = String(record.TXN_STATUS || '').toUpperCase();
//     const paymentType = String(record.PAYMENT_TYPE || '').toUpperCase();
//     if (!ALLOWED_STATUS.includes(status)) return { valid: false, code: 'INVALID_TXN_STATUS', message: `Unsupported status ${record.TXN_STATUS}` };
//     if (!ALLOWED_TYPES.includes(paymentType)) return { valid: false, code: 'INVALID_PAYMENT_TYPE', message: `Unsupported payment type ${record.PAYMENT_TYPE}` };
//     return { valid: true };
//   }
// }
// module.exports = BusinessValidator;
