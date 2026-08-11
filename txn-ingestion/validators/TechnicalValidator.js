'use strict';

const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const EXPONENTIAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;

class TechnicalValidator {
  validate(record) {
    const errors = [];

    if (record._DATE_ERRORS?.length) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_DATE'),
        message: record._DATE_ERRORS.join(' || ')
      });
    }

    const missingCode = StatusCodeUtil.toCode('MISSING_REQUIRED_FIELD');
    const required = [
      ['SAP_COMPANY_CODE', record.COMPANY_CODE],
      ['MOBI_PORTAL_CODE', record.MOBI_PORTAL_CODE],
      ['PAYMENT_TYPE', record.PAYMENT_TYPE],
      ['PAYMENT_SUB_TYPE', record.PAYMENT_SUB_TYPE],
      ['MOBI_REFERENCE_ID', record.MOBI_REFERENCE_ID],
      ['MERCHANT_ID', record.MERCHANT_ID],
      ['HOST_NAME', record.HOST_NAME]
    ];
    for (const [field, value] of required) {
      if (!String(value || '').trim()) {
        errors.push({ code: missingCode, message: StatusCodeUtil.FRIENDLY.missingField(field) });
      }
    }

    const companyCode = String(record.COMPANY_CODE || '').trim();
    if (companyCode && !Constants.ALLOWED_COMPANY_CODES.has(companyCode)) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_COMPANY'),
        message: StatusCodeUtil.FRIENDLY.invalidCompany(companyCode, [...Constants.ALLOWED_COMPANY_CODES])
      });
    }

    const portalCode = String(record.MOBI_PORTAL_CODE || '').trim().toUpperCase();
    if (portalCode && !Constants.VALID_PORTAL_CODES.has(portalCode)) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_PORTAL'),
        message: StatusCodeUtil.FRIENDLY.invalidPortal(record.MOBI_PORTAL_CODE, [...Constants.VALID_PORTAL_CODES])
      });
    }

    for (const [field, value] of [
      ['MOBI_REFERENCE_ID', record.MOBI_REFERENCE_ID],
      ['HOST_REFERENCE_ID', record.HOST_REFERENCE_ID]
    ]) {
      const text = String(value || '').trim();
      if (text.length > Constants.MAX_REF_ID_LENGTH) {
        errors.push({
          code: StatusCodeUtil.toCode('REFERENCE_TOO_LONG'),
          message: StatusCodeUtil.FRIENDLY.refTooLong(field, Constants.MAX_REF_ID_LENGTH)
        });
      }
      if (EXPONENTIAL_NUMBER.test(text)) {
        errors.push({
          code: StatusCodeUtil.toCode('EXPONENTIAL_REFERENCE'),
          message: StatusCodeUtil.FRIENDLY.exponentialRef(field, text)
        });
      }
    }

    return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
  }
}

module.exports = TechnicalValidator;
