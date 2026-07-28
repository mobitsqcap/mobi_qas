/**
 * StatusCodeUtil – Shared code/text mapping backed by MOBI_DB_STATUS.
 *
 * Rules enforced across modules:
 *  - DB tables (TRANSACTION, MASTER, FILELOG, CONSOLIDATION_*, GLAccounts) store
 *    2-digit codes (e.g. '01', '02') so joins / queries / processing are fast.
 *  - AUDIT logs and error TEXT files store BOTH the friendly text AND the code
 *    so operations / business can read them without a lookup.
 *  - Error messages should always include the expected format so the user can
 *    rectify the issue (e.g. "expected Transactions_YYYYMMDD.csv").
 *
 * All code maps declared here are also written as seed CSV on deploy so that
 * MOBI_DB_STATUS is populated.
 */

const cds = require('@sap/cds');
const { INSERT } = cds.ql;

/* ------------------------------------------------------------------ */
/* Master categories.                                                 */
/* ------------------------------------------------------------------ */

const CATEGORIES = Object.freeze({
  FILE:        'FILE',
  MASTER:      'MASTER',
  TRANSACTION: 'TRANSACTION',
  CONSOL:      'CONSOL',
  POSTING:     'POSTING',
  VALIDATION:  'VALIDATION',
  SYSTEM:      'SYSTEM',
  AUDIT:       'AUDIT'
});

/* ------------------------------------------------------------------ */
/* Status / Error codes by category.  Keys are 2-char codes.          */
/* ------------------------------------------------------------------ */

const CODES = Object.freeze({

  // FILE-level statuses (used in FILELOG and AUDIT at run level)
  [CATEGORIES.FILE]: {
    '01': 'RECEIVED',
    '02': 'PROCESSING',
    '03': 'COMPLETED',
    '04': 'PARTIALLY_PROCESSED',
    '05': 'FAILED',
    '06': 'INVALID_FILE_NAME',
    '07': 'DUPLICATE_FILE',
    '08': 'DUPLICATE_FILE_NAME',
    '09': 'FILE_NOT_FOUND',
    '10': 'SFTP_MOVE_FAILED',
    '11': 'EMPTY_FILE'
  },

  // MASTER / BP statuses
  [CATEGORIES.MASTER]: {
    '01': 'ACTIVE',
    '02': 'INACTIVE',
    '03': 'PENDING',
    '04': 'VALIDATION_FAILED',
    '05': 'DUPLICATE_BP_IN_DATABASE',
    '06': 'CROSS_COMPANY_CODE_DUPLICATE',
    '07': 'DUPLICATE_ID_IN_BATCH',
    '08': 'MISSING_REQUIRED_FIELD',
    '09': 'FIELD_LENGTH_EXCEEDED',
    '10': 'INVALID_TYPE',
    '11': 'INVALID_PORTAL_CODE',
    '12': 'INVALID_COMPANY_CODE',
    '13': 'INVALID_COUNTRY_CODE',
    '14': 'MISSING_BP_NUMBER',
    '15': 'MISSING_EXTERNAL_BP_NUMBER',
    '16': 'SUCCESS'
  },

  // TRANSACTION statuses (TXN_STATUS)
  [CATEGORIES.TRANSACTION]: {
    '01': 'SUCCESS',
    '02': 'FAILED',
    '03': 'PENDING',
    '04': 'RETURN',
    '05': 'FAILURE'
  },

  // ROW_STATUS (transaction row lifecycle)
  [CATEGORIES.VALIDATION]: {
    '01': 'VALID',
    '02': 'INVALID',
    '03': 'POSTED',
    '04': 'POSTING_PENDING',
    '05': 'MISSING_COMPANY_CODE',
    '06': 'MISSING_PORTAL_CODE',
    '07': 'MISSING_PAYMENT_TYPE',
    '08': 'MISSING_PAYMENT_SUB_TYPE',
    '09': 'MISSING_MERCHANT_ID',
    '10': 'MISSING_HOST_ID',
    '11': 'INVALID_AMOUNT',
    '12': 'INVALID_CURRENCY',
    '13': 'INVALID_PAYMENT_TYPE',
    '14': 'INVALID_PAYMENT_SUB_TYPE',
    '15': 'INVALID_TXN_STATUS',
    '16': 'INVALID_DATE_FORMAT',
    '17': 'DUPLICATE_MOBI_REFERENCE_ID',
    '18': 'DUPLICATE_HOST_REFERENCE_ID',
    '19': 'REFERENCE_ID_TOO_LONG',
    '20': 'EXPONENTIAL_REFERENCE_ID',
    '21': 'INVALID_PORTAL_CODE_MASTER',
    '22': 'INVALID_COMPANY_FOR_PORTAL',
    '23': 'INVALID_MERCHANT_ID',
    '24': 'INVALID_HOST_ID',
    '25': 'CSV_HEADER_MISMATCH'
  },

  // Consolidation statuses (CONSOL_STATUS on TRANSACTION & HEADER)
  [CATEGORIES.CONSOL]: {
    '01': 'PENDING',
    '02': 'POSTING_PENDING',
    '03': 'POSTED',
    '04': 'GL_ACCOUNT_MISSING',
    '05': 'BP_MASTER_MISSING',
    '06': 'CONSOLIDATION_FAILED',
    '07': 'POSTING_FAILED',
    '08': 'MISSING_GL_ACCOUNT',
    '09': 'MISSING_MERCHANT_BP',
    '10': 'MISSING_HOST_CUSTOMER_BP',
    '11': 'MISSING_BP_MASTER'
  },

  // Posting / Posting outcomes
  [CATEGORIES.POSTING]: {
    '01': 'POSTED',
    '02': 'POSTING_PENDING',
    '03': 'POSTING_FAILED'
  },

  // SYSTEM/audit level
  [CATEGORIES.SYSTEM]: {
    '01': 'PROCESSING',
    '02': 'COMPLETED',
    '03': 'PARTIAL',
    '04': 'ERROR',
    '05': 'STARTED',
    '06': 'SUCCESS'
  }
});

/* ------------------------------------------------------------------ */
/* Friendly, helpful error message templates.                         */
/* ------------------------------------------------------------------ */

const FRIENDLY = Object.freeze({

  invalidFileName: (fileName, expected) =>
    `File name does not match the expected pattern. Received: "${fileName}". ` +
    `Expected format: ${expected}. Please rename the file to the correct pattern and re-upload.`,

  missingColumn: (missing) =>
    `CSV header is missing required column(s): ${missing.join(', ')}. ` +
    `Please ensure the CSV contains all mandatory columns before re-uploading.`,

  missingField: (field) =>
    `Mandatory field "${field}" is missing or blank. Please populate it and re-upload.`,

  fieldTooLong: (field, maxLen, actualLen) =>
    `Field "${field}" exceeds the maximum length of ${maxLen} characters ` +
    `(received ${actualLen} characters). Please shorten the value and re-upload.`,

  invalidType: (value, allowed) =>
    `Invalid merchant type "${value}". Allowed values: ${allowed.join(', ')}. ` +
    `Please correct the type and re-upload.`,

  invalidPortal: (value, allowed) =>
    `Invalid MOBI_PORTAL_CODE "${value}". Allowed values: ${allowed.join(', ')}. ` +
    `Please use a valid portal code and re-upload.`,

  invalidCompany: (value, allowed) =>
    `Invalid SAP_COMPANY_CODE "${value}". Allowed values: ${allowed.join(', ')}. ` +
    `Company code must be numeric; please correct and re-upload.`,

  invalidCountry: (value) =>
    `Invalid COUNTRY_CODE "${value}". Must be a valid 2-letter ISO country code ` +
    `(e.g. IN, SG, MY, ID, AE). Please correct and re-upload.`,

  duplicateIdInBatch: (id) =>
    `Duplicate ID "${id}" found within the same file. Each merchant/host must be ` +
    `unique per file. Please remove the duplicate and re-upload.`,

  duplicateBpInDb: (id, company, portal) =>
    `Duplicate External BP Number "${id}" already exists in the system ` +
    `(Company: ${company}, Portal: ${portal}). Please use a unique ID or update the existing record.`,

  crossCompanyDuplicate: (id, existingCode, newCode) =>
    `BP ID "${id}" already exists under Company Code "${existingCode}". ` +
    `It cannot be created again under Company Code "${newCode}". ` +
    `Please verify the company code and re-upload.`,

  duplicateMobiRef: (ref) =>
    `Duplicate MOBI_REFERENCE_ID "${ref}" in file. Each transaction reference must be unique.`,

  duplicateHostRef: (ref, date) =>
    `Duplicate HOST_REFERENCE_ID "${ref}" on transaction date ${date}. ` +
    `Host reference must be unique per day.`,

  duplicateMobiRefDb: (ref) =>
    `MOBI_REFERENCE_ID "${ref}" already exists in the database. ` +
    `Please use a unique reference ID.`,

  duplicateHostRefDb: (ref) =>
    `HOST_REFERENCE_ID "${ref}" already exists for the same transaction day in the database.`,

  invalidAmount: (value) =>
    `Invalid transaction amount "${value}". Amount must be a positive number greater than zero.`,

  invalidCurrency: (value) =>
    `Invalid currency "${value}". Currency must be a 3-letter ISO code (e.g. MYR, IDR, INR).`,

  invalidPaymentType: (value, allowed) =>
    `Unsupported payment type "${value}". Allowed values: ${allowed.join(', ')}.`,

  invalidPaymentSubType: (value, allowed) =>
    `Unsupported payment sub-type "${value}". Allowed values: ${allowed.join(', ')}.`,

  invalidTxnStatus: (value, allowed) =>
    `Unsupported transaction status "${value}". Allowed values: ${allowed.join(', ')}.`,

  invalidDate: (value) =>
    `Invalid date value "${value}". Accepted formats: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, ` +
    `YYYY-MM-DD, DD-MM-YY. Please correct the date and re-upload.`,

  refTooLong: (field, maxLen) =>
    `${field} exceeds ${maxLen} characters. Please shorten the reference ID.`,

  exponentialRef: (field, value) =>
    `${field} "${value}" must not be an exponential/scientific number. ` +
    `Please provide the full reference ID as text.`,

  invalidMerchant: (id) =>
    `Merchant ID "${id}" is not active for the given portal/company combination. ` +
    `Please check master data or correct the ID.`,

  invalidHost: (host) =>
    `Host name "${host}" is not active for the given portal/company combination. ` +
    `Please check master data or correct the host name.`,

  invalidPortalMaster: (portal) =>
    `Portal code "${portal}" is not active in master data. Please configure the portal first.`,

  invalidCompanyPortal: (company, portal) =>
    `Company code "${company}" is not valid for portal "${portal}". ` +
    `Please verify the company/portal combination.`,

  fileMoveFailed: (from, to, reason) =>
    `Failed to move file from "${from}" to "${to}". Reason: ${reason}. ` +
    `Please check SFTP permissions/folder availability.`,

  fileDownloadFailed: (path, reason) =>
    `Failed to download file "${path}". Reason: ${reason}.`,

  sftpConnection: (reason) =>
    `SFTP connection failed: ${reason}. Please verify destination configuration.`,

  caseInsensitiveDuplicate: (value, existing) =>
    `Master ID "${value}" conflicts (case-insensitive) with existing ID "${existing}" ` +
    `for the same portal and company. Master IDs are case-insensitive; please use a unique value.`
});

/* ------------------------------------------------------------------ */
/* Public helpers.                                                    */
/* ------------------------------------------------------------------ */

function toText(category, code) {
  if (!code) return '';
  const map = CODES[category];
  return (map && map[String(code).padStart(2,'0')]) || String(code);
}

function toCode(category, text, defaultCode = null) {
  if (!text) return defaultCode;
  const map = CODES[category] || {};
  const needle = String(text).trim().toUpperCase();
  for (const [code, label] of Object.entries(map)) {
    if (label.toUpperCase() === needle) return code;
  }
  // Maybe it was already a code
  if (/^[A-Z0-9]{2}$/.test(needle) && map[needle]) return needle;
  return defaultCode;
}

function describe(category, code) {
  const c = String(code || '').padStart(2, '0');
  return { code: c, text: toText(category, c) };
}

/**
 * Load (or lazily initialise) MOBI_DB_STATUS table from the code maps above.
 * Safe to call on every service start – UPSERTs are used so duplicates are
 * not created and descriptions stay in sync with code.
 */
async function ensureStatusTable() {
  try {
    const db = await cds.connect.to('db');
    const entries = [];
    for (const [category, map] of Object.entries(CODES)) {
      for (const [code, description] of Object.entries(map)) {
        entries.push({ CATEGORY: category, CODE: code, DESCRIPTION: description });
      }
    }
    // Chunked UPSERT into MOBI_DB_STATUS
    const chunkSize = 100;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      try {
        await db.run(INSERT.into('mobi.db.MOBI_DB_STATUS').entries(chunk));
      } catch (err) {
        // UPSERT fallback if dialect requires it
        for (const row of chunk) {
          try {
            await db.run(INSERT.into('mobi.db.MOBI_DB_STATUS').entries(row));
          } catch (_) { /* already exists */ }
        }
      }
    }
  } catch (err) {
    console.warn('[StatusCodeUtil] ensureStatusTable skipped:', err.message);
  }
}

/**
 * Join multiple errors for a single record into one user-readable detail
 * string (so all errors are visible in the first pass, not one by one).
 *
 * @param {Array<{code:string, message:string}>} errors
 */
function joinErrorDetails(errors) {
  if (!errors || !errors.length) return '';
  return errors
    .map((e, idx) => `[${idx + 1}] (${e.code || 'XX'}) ${e.message}`)
    .join(' || ');
}

/**
 * Extract distinct 2-digit error codes from an error list (comma separated
 * for storage in ERROR_CODE).
 */
function joinErrorCodes(errors) {
  if (!errors || !errors.length) return '';
  return [...new Set(errors.map((e) => String(e.code || '').padStart(2,'0')).filter(Boolean))].join(',');
}

module.exports = Object.freeze({
  CATEGORIES,
  CODES,
  FRIENDLY,
  toText,
  toCode,
  describe,
  ensureStatusTable,
  joinErrorDetails,
  joinErrorCodes
});
