/**
 * Consolidation constants – aligned with MOBI_DB_STATUS codes.
 *
 * Codes are 2-digit strings (fast DB compare). Text equivalents live in
 * MOBI_DB_STATUS and are produced via StatusCodeUtil for audit / error files.
 */
const StatusCodeUtil = require('../utils/StatusCodeUtil');

module.exports = Object.freeze({
  SYSTEM_USER:  'SYSTEM_CONSOLIDATION',
  SYSTEM_USERS: {
    PAYIN:               'SYSTEM_PAYIN',
    PAYOUT:              'SYSTEM_PAYOUT',
    DOMESTIC_SETTLEMENT: 'SYSTEM_DS',
    DEFAULT:             'SYSTEM_CONSOLIDATION'
  },

  // ROW_STATUS on transaction table
  ROW_STATUS: {
    VALID:  '01',
    INVALID:'02',
    POSTED: '03',
    FAILED: '05'
  },

  // CONSOL_STATUS on transaction table
  CONSOL_STATUS: {
    PENDING:             '01',
    POSTING_PENDING:     '02',
    POSTED:              '03',
    GL_ACCOUNT_MISSING:  '04',
    BP_MASTER_MISSING:   '05',
    CONSOLIDATION_FAILED:'06',
    POSTING_FAILED:      '07'
  },

  // POSTING_STATUS on consolidation header / line items
  POSTING_STATUS: {
    POSTING_PENDING: '02',
    POSTED:          '03',
    POSTING_FAILED:  '07',
    FAILED:          '07'
  },

  ERROR_CODES: {
    MISSING_GL_ACCOUNT:           '04',
    MISSING_BP_MASTER:            '05',
    MISSING_MERCHANT_BP:          '09',
    MISSING_HOST_CUSTOMER_BP:     '10',
    CONSOLIDATION_BUILD_FAILED:   '06',
    POSTING_FAILED:               '07'
  },

  AUDIT_STATUS: {
    STARTED:  '05',
    SUCCESS:  '02',
    PARTIAL:  '03',
    ERROR:    '04',
    POSTING_PENDING: '02',
    POSTED:   '03',
    POSTING_FAILED: '07'
  },

  AUDIT_SCOPE: {
    RUN:         'RUN',
    TRANSACTION: 'TRANSACTION',
    DOCUMENT:    'DOCUMENT'
  },

  PAYMENT_CODES: {
    UNKNOWN:            0,
    PAYIN:              1,
    PAYOUT:             2,
    DOMESTIC_SETTLEMENT:3,
    NORMAL:             4
  },

  DEBIT_CREDIT: {
    DEBIT:  'S',
    CREDIT: 'H'
  },

  SUCCESS_TXN_STATUSES: ['01'],   // SUCCESS code from txn ingestion

  GROUP_MODE: {
    DAILY:          'DAILY',
    PER_TRANSACTION:'PER_TRANSACTION'
  },

  // DB_CHUNK_SIZE aligned with production default batch size (2000) for
  // high-volume days (35k – 1L records). Heavy UPDATE/DELETE still uses a
  // smaller 500-row split inside the repository to respect HANA parameter
  // limits, but this constant drives the main INSERT/UPSERT chunking.
  DB_CHUNK_SIZE:       Number(process.env.DB_CHUNK_SIZE || 2000),
  DB_SMALL_CHUNK_SIZE: Number(process.env.DB_SMALL_CHUNK || 500)
});
