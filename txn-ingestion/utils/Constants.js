/** Transaction-ingestion constants. */
const transactionPattern = process.env.TRANSACTION_FILE_PATTERN || '^Transactions_\\d{8}\\.csv$';
const transactionRetryPattern = process.env.TRANSACTION_RETRY_FILE_PATTERN || '^Transactions_\\d{8}_(ERRORS|Updated)\\.csv$';
const aliases = (...values) => new Set(values.map((value) => String(value).trim().toUpperCase()));

const PAYIN_TYPE_ALIASES = aliases('PAYIN', 'PAYINS');
const PAYOUT_TYPE_ALIASES = aliases('PAYOUT', 'PAYOUTS');
const PAYIN_SUBTYPE_ALIASES = aliases('PAYIN', 'PAYINS'); // required for the supplied sample data
const PAYOUT_SUBTYPE_ALIASES = aliases('NORMAL');
const DS_SUBTYPE_ALIASES = aliases(
  'DOMESTIC SETTLEMENT', 'DOMESTIC_SETTLEMENT', 'DOMESTICSETTLEMENT', 'DS'
);

module.exports = Object.freeze({
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 2000),
  ACTIVE_FLAG: process.env.ACTIVE_FLAG || 'X',
  MAX_REF_ID_LENGTH: 100,
  // Comma-separated override, e.g. ALLOWED_TRANSACTION_CURRENCIES=MYR,IDR,USD
  ALLOWED_TRANSACTION_CURRENCIES: new Set(
    String(process.env.ALLOWED_TRANSACTION_CURRENCIES || 'MYR,IDR')
      .split(',').map((value) => value.trim().toUpperCase()).filter(Boolean)
  ),
  PAYMENT: { PAYIN_TYPE_ALIASES, PAYOUT_TYPE_ALIASES, PAYIN_SUBTYPE_ALIASES, PAYOUT_SUBTYPE_ALIASES, DS_SUBTYPE_ALIASES },
  SFTP: { TRANSACTION: { ROOT_PATH: 'Transaction_Data', FILEIN_PATH: 'Transaction_Data/FILE_IN', PROCESSING_PATH: 'Transaction_Data/PROCESSING', ERROR_PATH: 'Transaction_Data/ERROR', PROCESSED_PATH: 'Transaction_Data/FILE_OUT' } },
  FILES: { TRANSACTION_REGEX: new RegExp(transactionPattern), TRANSACTION_RETRY_REGEX: new RegExp(transactionRetryPattern) },
  FILE_STATUS: { RECEIVED: 'RECEIVED', PROCESSING: 'PROCESSING', PARTIALLY_PROCESSED: 'PARTIALLY_PROCESSED', COMPLETED: 'COMPLETED', FAILED: 'FAILED' },
  ROW_STATUS: { VALID: 'VALID', INVALID: 'INVALID', POSTED: 'POSTED', FAILED: 'FAILED' },
  SYSTEM_USERS: { DEFAULT: 'SYSTEM_SFTP', SFTP: 'SYSTEM_SFTP', CPI: 'SYSTEM_CPI' },
  OUTPUT_NAMING: { FULL_SUCCESS: (date8, hhMMss) => `Transactions_${date8}_${hhMMss}.csv`, PARTIAL_SUCCESS: (date8) => `Transactions_${date8}_SUCCESS.csv` },
  ERROR_NAMING: { FAILED_CSV: (date8) => `Transactions_${date8}_ERRORS.csv`, ERROR_TEXT: (date8) => `Transactions_${date8}_text.file` },
  RETRY: { ORIGINAL_FROM_ERROR_FILE: (fileName) => String(fileName || '').replace(/_(ERRORS|Updated)\.csv$/i, '.csv') },
  TRANSACTION_CSV_COLUMNS: ['mobi_portal_code', 'sap_company_code', 'payment_type', 'payment_sub_type', 'mobi_reference_id', 'merchant_id', 'merchant_type', 'merchant_name', 'txn_created_date', 'txn_paid_date', 'txn_time_created', 'txn_time_paid', 'payment_method', 'host_name', 'transaction_amount', 'host_mdr_amount', 'host_fee_payable', 'mobi_mdr_amount', 'mdr_revenue', 'ar_payin', 'ap_payin', 'ap_payout', 'host_reference_id', 'merchant_reference_id', 'transaction_status', 'original_amount', 'transaction_currency', 'settled_in_currency', 'time_zone', 'conversion_rate']
});



// /**
//  * Constants for Transaction Ingestion Flow (V2 core + V1 batch processing).
//  * Production-hardened: BATCH_SIZE=2000, NULL→'', only CREATED_* fields.
//  */
// const transactionPattern = process.env.TRANSACTION_FILE_PATTERN || '^Transactions_\\d{8}\\.csv$';
// const transactionRetryPattern = process.env.TRANSACTION_RETRY_FILE_PATTERN || '^Transactions_\\d{8}_(ERRORS|Updated)\\.csv$';
// const TRANSACTION_ROOT = 'Transaction_Data';

// module.exports = Object.freeze({
//   BATCH_SIZE: Number(process.env.BATCH_SIZE || 2000),
//   ACTIVE_FLAG: process.env.ACTIVE_FLAG || 'X',
//   MAX_REF_ID_LENGTH: 100,

//   SFTP: {
//     TRANSACTION: {
//       ROOT_PATH: TRANSACTION_ROOT,
//       FILEIN_PATH: `${TRANSACTION_ROOT}/FILE_IN`,
//       PROCESSING_PATH: `${TRANSACTION_ROOT}/PROCESSING`,
//       ERROR_PATH: `${TRANSACTION_ROOT}/ERROR`,
//       PROCESSED_PATH: `${TRANSACTION_ROOT}/FILE_OUT`
//     }
//   },

//   FILES: {
//     TRANSACTION_REGEX: new RegExp(transactionPattern),
//     TRANSACTION_RETRY_REGEX: new RegExp(transactionRetryPattern)
//   },

//   FILE_STATUS: {
//     RECEIVED: 'RECEIVED',
//     PROCESSING: 'PROCESSING',
//     PARTIALLY_PROCESSED: 'PARTIALLY_PROCESSED',
//     COMPLETED: 'COMPLETED',
//     FAILED: 'FAILED'
//   },

//   ROW_STATUS: {
//     VALID: 'VALID',
//     INVALID: 'INVALID',
//     POSTED: 'POSTED',
//     FAILED: 'FAILED'
//   },

//   SYSTEM_USERS: {
//     DEFAULT: 'SYSTEM_SFTP',
//     SFTP: 'SYSTEM_SFTP',
//     CPI: 'SYSTEM_CPI'
//   },

//   OUTPUT_NAMING: {
//     FULL_SUCCESS: (date8, hhMMss) => `Transactions_${date8}_${hhMMss}.csv`,
//     PARTIAL_SUCCESS: (date8) => `Transactions_${date8}_SUCCESS.csv`
//   },

//   ERROR_NAMING: {
//     FAILED_CSV: (date8) => `Transactions_${date8}_ERRORS.csv`,
//     ERROR_TEXT: (date8) => `Transactions_${date8}_text.file`
//   },

//   RETRY: {
//     ORIGINAL_FROM_ERROR_FILE: (fileName) => String(fileName || '').replace(/_(ERRORS|Updated)\\.csv$/i, '.csv')
//   },

//   TRANSACTION_CSV_COLUMNS: [
//     'mobi_portal_code', 'sap_company_code', 'payment_type', 'payment_sub_type', 'mobi_reference_id',
//     'merchant_id', 'merchant_type', 'merchant_name', 'txn_created_date', 'txn_paid_date',
//     'txn_time_created', 'txn_time_paid', 'payment_method', 'host_name', 'transaction_amount',
//     'host_mdr_amount', 'host_fee_payable', 'mobi_mdr_amount', 'mdr_revenue', 'ar_payin',
//     'ap_payin', 'ap_payout', 'host_reference_id', 'merchant_reference_id', 'transaction_status',
//     'original_amount', 'transaction_currency', 'settled_in_currency', 'time_zone', 'conversion_rate'
//   ]
// });
