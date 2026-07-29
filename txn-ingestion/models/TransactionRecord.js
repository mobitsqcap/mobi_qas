const DateUtil = require('../utils/DateUtil');

function toNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : Number.NaN;
}

class TransactionRecord {
  static fromCsvRow(row, auditId) {
    const createdDate = DateUtil.parseCsvDate(row.txn_created_date, { required: true });
    const paidDate = DateUtil.parseCsvDate(row.txn_paid_date, { required: false });

    return {
      _RAW_ROW: { ...row },
      COMPANY_CODE: row.sap_company_code,
      MOBI_REFERENCE_ID: row.mobi_reference_id,
      PAYMENT_TYPE: row.payment_type,
      AUDIT_ID: auditId,
      MOBI_PORTAL_CODE: row.mobi_portal_code,
      MERCHANT_ID: row.merchant_id,
      MERCHANT_TYPE: row.merchant_type,
      MERCHANT_NAME: row.merchant_name,
      TXN_CREATED_DATE: createdDate.iso,
      TXN_PAID_DATE: paidDate.iso || undefined,
      TXN_CREATED_TIME: DateUtil.parseCsvTime(row.txn_time_created) || undefined,
      TXN_PAID_TIME: DateUtil.parseCsvTime(row.txn_time_paid) || undefined,
      TIME_ZONE: row.time_zone,
      PAYMENT_SUB_TYPE: row.payment_sub_type,
      PAYMENT_METHOD: row.payment_method,
      HOST_NAME: row.host_name,
      TXN_CURRENCY: row.transaction_currency,
      TXN_AMOUNT: toNumber(row.transaction_amount),
      HOST_MDR_AMOUNT: toNumber(row.host_mdr_amount),
      HOST_FEE_PAYABLE: toNumber(row.host_fee_payable),
      MOBI_MDR_AMOUNT: toNumber(row.mobi_mdr_amount),
      MDR_REVENUE: toNumber(row.mdr_revenue),
      AR_PAYIN: toNumber(row.ar_payin),
      AP_PAYIN: toNumber(row.ap_payin),
      AP_PAYOUT: toNumber(row.ap_payout),
      HOST_REFERENCE_ID: row.host_reference_id,
      MERCHANT_REFERENCE_ID: row.merchant_reference_id,
      TXN_STATUS: row.transaction_status,
      ORIGINAL_AMOUNT: toNumber(row.original_amount),
      SETTLED_IN_CURRENCY: row.settled_in_currency,
      CONVERSION_RATE: toNumber(row.conversion_rate),
      COUNTRY_CODE: '',
      CONSOL_STATUS: 'PENDING',
      CONSOL_REF_ID: '',
      ROW_STATUS: '',
      ERROR_CODE: createdDate.error || paidDate.error ? 'INVALID_DATE' : '',
      ERROR_DETAIL: createdDate.error || paidDate.error || ''
    };
  }
}

module.exports = TransactionRecord;
