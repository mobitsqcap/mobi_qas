/** Transaction-ingestion constants.
 *
 *  Codes are 2-digit codes aligned with db/MOBI_DB_STATUS. Friendly text
 *  is produced through StatusCodeUtil for audit logs and error files.
 */
const StatusCodeUtil = require('./StatusCodeUtil');

const transactionPattern = process.env.TRANSACTION_FILE_PATTERN       || /^Transactions_\d{8}\.csv$/;
const retryPattern       = process.env.TRANSACTION_RETRY_FILE_PATTERN || /^Transactions_\d{8}_(ERRORS|Updated)\.csv$/;

const aliases = (...values) => new Set(
  values.flat().map((value) => String(value).trim().toUpperCase())
);

const PAYIN_TYPE_ALIASES     = aliases('PAYIN', 'PAYINS');
const PAYOUT_TYPE_ALIASES    = aliases('PAYOUT', 'PAYOUTS');
const PAYIN_SUBTYPE_ALIASES  = aliases('PAYIN', 'PAYINS');
const PAYOUT_SUBTYPE_ALIASES = aliases('NORMAL');
const DS_SUBTYPE_ALIASES     = aliases('DOMESTIC SETTLEMENT', 'DOMESTIC_SETTLEMENT', 'DOMESTICSETTLEMENT', 'DS');

const EXPECTED_FORMAT = 'Transactions_YYYYMMDD.csv (e.g. Transactions_20260725.csv); ' +
                        'for retries use Transactions_YYYYMMDD_ERRORS.csv or Transactions_YYYYMMDD_Updated.csv';

module.exports = Object.freeze({
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 2000),
  ACTIVE_FLAG: process.env.ACTIVE_FLAG || 'X',
  MAX_REF_ID_LENGTH: 100,

  ALLOWED_TRANSACTION_CURRENCIES: new Set(
    String(process.env.ALLOWED_TRANSACTION_CURRENCIES || 'MYR,IDR,INR')
      .split(',').map((v) => v.trim().toUpperCase()).filter(Boolean)
  ),

  EXPECTED_FORMAT,

  // Status/error codes (2-digit)
  FILE_STATUS: {
    RECEIVED:            '01',
    PROCESSING:          '02',
    COMPLETED:           '03',
    PARTIALLY_PROCESSED: '04',
    FAILED:              '05'
  },

  ROW_STATUS: {
    VALID:   '01',
    INVALID: '02',
    POSTED:  '03'
  },

  TXN_STATUS: {
    SUCCESS: '01',
    FAILED:  '02',
    PENDING: '03',
    RETURN:  '04',
    FAILURE: '05'
  },

  AUDIT_STATUS: {
    PROCESSING: '01',
    COMPLETED:  '02',
    PARTIAL:    '03',
    FAILED:     '04'
  },

  ERROR_CODES: {
    INVALID_FILE_NAME:        '06',
    DUPLICATE_FILE:           '07',
    DUPLICATE_FILE_NAME:      '08',
    MISSING_COMPANY_CODE:     '05',
    MISSING_PORTAL_CODE:      '06',
    MISSING_PAYMENT_TYPE:     '07',
    MISSING_PAYMENT_SUB_TYPE: '08',
    MISSING_MERCHANT_ID:      '09',
    MISSING_HOST_ID:          '10',
    INVALID_AMOUNT:           '11',
    INVALID_CURRENCY:         '12',
    INVALID_PAYMENT_TYPE:     '13',
    INVALID_PAYMENT_SUB_TYPE: '14',
    INVALID_TXN_STATUS:       '15',
    INVALID_DATE:             '16',
    DUPLICATE_MOBI_REF:       '17',
    DUPLICATE_HOST_REF:       '18',
    REF_TOO_LONG:             '19',
    EXPONENTIAL_REF:          '20',
    INVALID_PORTAL_MASTER:    '21',
    INVALID_COMPANY_PORTAL:   '22',
    INVALID_MERCHANT:         '23',
    INVALID_HOST:             '24',
    CSV_HEADER_MISMATCH:      '25'
  },

  PAYMENT: {
    PAYIN_TYPE_ALIASES,
    PAYOUT_TYPE_ALIASES,
    PAYIN_SUBTYPE_ALIASES,
    PAYOUT_SUBTYPE_ALIASES,
    DS_SUBTYPE_ALIASES
  },

  SFTP: {
    TRANSACTION: {
      ROOT_PATH:       'Transaction_Data',
      FILEIN_PATH:     'Transaction_Data/FILE_IN',
      PROCESSING_PATH: 'Transaction_Data/PROCESSING',
      ERROR_PATH:      'Transaction_Data/ERROR',
      PROCESSED_PATH:  'Transaction_Data/FILE_OUT'
    }
  },

  FILES: {
    TRANSACTION_REGEX:       (transactionPattern instanceof RegExp) ? transactionPattern : new RegExp(transactionPattern),
    TRANSACTION_RETRY_REGEX: (retryPattern instanceof RegExp)       ? retryPattern       : new RegExp(retryPattern)
  },

  SYSTEM_USERS: { DEFAULT: 'SYSTEM_SFTP', SFTP: 'SYSTEM_SFTP', CPI: 'SYSTEM_CPI' },

  OUTPUT_NAMING: {
    FULL_SUCCESS:    (date8, hhMMss) => `Transactions_${date8}_${hhMMss}.csv`,
    PARTIAL_SUCCESS: (date8)         => `Transactions_${date8}_SUCCESS.csv`
  },

  ERROR_NAMING: {
    FAILED_CSV: (date8) => `Transactions_${date8}_ERRORS.csv`,
    ERROR_TEXT: (date8) => `Transactions_${date8}_text.file`
  },

  RETRY: {
    ORIGINAL_FROM_ERROR_FILE: (fileName) =>
      String(fileName || '').replace(/_(ERRORS|Updated)\.csv$/i, '.csv')
  },

  TRANSACTION_CSV_COLUMNS: [
    'mobi_portal_code', 'sap_company_code', 'payment_type', 'payment_sub_type', 'mobi_reference_id',
    'merchant_id', 'merchant_type', 'merchant_name', 'txn_created_date', 'txn_paid_date', 'txn_time_created',
    'txn_time_paid', 'payment_method', 'host_name', 'transaction_amount', 'host_mdr_amount', 'host_fee_payable',
    'mobi_mdr_amount', 'mdr_revenue', 'ar_payin', 'ap_payin', 'ap_payout', 'host_reference_id',
    'merchant_reference_id', 'transaction_status', 'original_amount', 'transaction_currency',
    'settled_in_currency', 'time_zone', 'conversion_rate'
  ]
});
