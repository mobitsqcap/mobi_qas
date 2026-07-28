const Constants = require('../utils/Constants');
const F = require('../utils/StatusCodeUtil').FRIENDLY;

const ALLOWED_STATUS = new Set(['SUCCESS', 'FAILED', 'PENDING', 'RETURN', 'FAILURE']);

class BusinessValidator {
  validate(record) {
    const errors = [];
    const status  = String(record.TXN_STATUS_TEXT || record.TXN_STATUS || '').trim().toUpperCase();
    const type    = String(record.PAYMENT_TYPE || '').trim().toUpperCase();
    const subtype = String(record.PAYMENT_SUB_TYPE || '').trim().toUpperCase();

    if (status && !ALLOWED_STATUS.has(status)) {
      errors.push({
        code: Constants.ERROR_CODES.INVALID_TXN_STATUS,
        message: F.invalidTxnStatus(record.TXN_STATUS_TEXT || record.TXN_STATUS, [...ALLOWED_STATUS])
      });
    }

    const p = Constants.PAYMENT;
    let typeOk = false;

    if (p.PAYIN_TYPE_ALIASES.has(type)) {
      typeOk = true;
      if (status === 'SUCCESS' && !p.PAYIN_SUBTYPE_ALIASES.has(subtype)) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_PAYMENT_SUB_TYPE,
          message: F.invalidPaymentSubType(record.PAYMENT_SUB_TYPE, ['PAYIN', 'PAYINS'])
        });
      }
    } else if (p.PAYOUT_TYPE_ALIASES.has(type)) {
      typeOk = true;
      if (status === 'SUCCESS' && !p.PAYOUT_SUBTYPE_ALIASES.has(subtype) && !p.DS_SUBTYPE_ALIASES.has(subtype)) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_PAYMENT_SUB_TYPE,
          message: F.invalidPaymentSubType(record.PAYMENT_SUB_TYPE, ['NORMAL', 'DOMESTIC SETTLEMENT', 'DS'])
        });
      }
    }

    if (!typeOk) {
      errors.push({
        code: Constants.ERROR_CODES.INVALID_PAYMENT_TYPE,
        message: F.invalidPaymentType(record.PAYMENT_TYPE, ['PAYIN', 'PAYINS', 'PAYOUT', 'PAYOUTS'])
      });
    }

    if (errors.length === 0) return { valid: true, errors: [] };
    return { valid: false, errors };
  }
}

module.exports = BusinessValidator;
