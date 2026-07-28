const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const Constants = require('../utils/Constants');

function toNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
}

function collectDateErrors(created, paid) {
  const codes = [];
  const msgs  = [];
  if (created.error) { codes.push(Constants.ERROR_CODES.INVALID_DATE); msgs.push(`txn_created_date: ${created.error}`); }
  if (paid.error)    { codes.push(Constants.ERROR_CODES.INVALID_DATE); msgs.push(`txn_paid_date: ${paid.error}`); }
  return { codes: [...new Set(codes)].join(','), message: msgs.join(' || ') };
}

class TransactionRecord {
  static fromCsvRow(row, auditId) {
    const createdDate = DateUtil.parseCsvDate(row.txn_created_date, { required: true });
    const paidDate    = DateUtil.parseCsvDate(row.txn_paid_date,    { required: false });
    const dateErrors  = collectDateErrors(createdDate, paidDate);

    return {
      RAW_ROW: { ...row },

      COMPANY_CODE:      row.sap_company_code,
      MOBI_REFERENCE_ID: row.mobi_reference_id,
      PAYMENT_TYPE:      row.payment_type,
      AUDIT_ID:          auditId,
      MOBI_PORTAL_CODE:  row.mobi_portal_code,
      MERCHANT_ID:       row.merchant_id,
      MERCHANT_TYPE:     row.merchant_type,
      MERCHANT_NAME:     row.merchant_name,
      TXN_CREATED_DATE:  createdDate.iso,
      TXN_PAID_DATE:     paidDate.iso || undefined,
      TXN_CREATED_TIME:  DateUtil.parseCsvTime(row.txn_time_created) || undefined,
      TXN_PAID_TIME:     DateUtil.parseCsvTime(row.txn_time_paid)    || undefined,
      TIME_ZONE:         row.time_zone,
      PAYMENT_SUB_TYPE:  row.payment_sub_type,
      PAYMENT_METHOD:    row.payment_method,
      HOST_NAME:         row.host_name,
      TXN_CURRENCY:      (row.transaction_currency || '').toUpperCase(),
      TXN_AMOUNT:        toNumber(row.transaction_amount),
      HOST_MDR_AMOUNT:   toNumber(row.host_mdr_amount),
      HOST_FEE_PAYABLE:  toNumber(row.host_fee_payable),
      MOBI_MDR_AMOUNT:   toNumber(row.mobi_mdr_amount),
      MDR_REVENUE:       toNumber(row.mdr_revenue),
      AR_PAYIN:          toNumber(row.ar_payin),
      AP_PAYIN:          toNumber(row.ap_payin),
      AP_PAYOUT:         toNumber(row.ap_payout),
      HOST_REFERENCE_ID: row.host_reference_id,
      MERCHANT_REFERENCE_ID: row.merchant_reference_id,
      TXN_STATUS_TEXT:   (row.transaction_status || '').toUpperCase(),
      TXN_STATUS:        '',   // filled by validator (2-digit code)
      ORIGINAL_AMOUNT:   toNumber(row.original_amount),
      SETTLED_IN_CURRENCY: row.settled_in_currency,
      CONVERSION_RATE:   toNumber(row.conversion_rate),
      COUNTRY_CODE:      '',
      CONSOL_STATUS:     '01',   // PENDING
      CONSOL_REF_ID:     '',
      ROW_STATUS:        '',     // filled by validator
      ERROR_CODE:        dateErrors.codes,
      ERROR_DETAIL:      dateErrors.message
    };
  }
}

module.exports = TransactionRecord;
