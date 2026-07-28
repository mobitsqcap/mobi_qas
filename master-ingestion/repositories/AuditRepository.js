const cds = require('@sap/cds');
const { UPSERT, UPDATE, INSERT } = cds.ql;
const { v4: uuid } = require('uuid');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * AuditRepository (master ingestion)
 *
 * UNCHANGED : *text() /* details() / start() / updateProgress() / complete() / fail()
 *             -> the file-level summary row works exactly as before.
 *
 * ADDED     : insertRecordRows()
 *             -> one audit row per master record, same content as the
 *                <filename>_text.file error file.
 *
 * NEW (for CPI feedback replication):
 *             updateRecordAuditFromMaster()
 *             -> When CPI (or any external process) updates POSTING_STATUS
 *                in MOBI_DB_MASTER (success or error), replicate the
 *                equivalent status into the matching per-record row(s)
 *                in MOBI_DB_AUDIT.
 *
 * No table changes. Only existing columns are used.
 */

class AuditRepository {
  _text(value) { return value === null || value === undefined ? '' : String(value); }

  _details(details = {}) {
    return {
      CONSOL_REF_ID: this._text(details.CONSOL_REF_ID),
      MOBI_REFERENCE_ID: this._text(details.MOBI_REFERENCE_ID),
      COMPANY_CODE: this._text(details.COMPANY_CODE),
      MOBI_PORTAL_CODE: this._text(details.MOBI_PORTAL_CODE),
      PAYMENT_TYPE: this._text(details.PAYMENT_TYPE),
      PAYMENT_SUB_TYPE: this._text(details.PAYMENT_SUB_TYPE),
      MERCHANT_ID: this._text(details.MERCHANT_ID),
      HOST_NAME: this._text(details.HOST_NAME)
    };
  }

  // ------------------------------------------------------------------
  // FILE-LEVEL SUMMARY ROW  (unchanged behaviour)
  // ------------------------------------------------------------------
  async start({ auditId, runId, fileName, createdBy, details = {} }) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const entry = {
      AUDIT_ID: auditId,
      RUN_ID: this._text(runId),
      FILE_NAME: this._text(fileName),
      STATUS: 'PROCESSING',
      STATUS_CODE: '01',
      TOTAL_RECORDS: 0,
      SUCCESS_COUNT: 0,
      ERROR_COUNT: 0,
      ERROR_CODE: '',
      ERROR_DETAIL: '',
      PROCESS_START_AT: now,
      ...this._details(details),
      CREATED_BY: 'System_SFTP',
      CREATED_TIMESTAMP: now
    };
    await db.run(UPSERT.into('mobi.db.MOBI_DB_AUDIT').entries(entry));
    return entry;
  }

  async updateRecordAuditFromMasterBatch(items) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    return db.tx(async tx => {
      const promises = items.map(item => {
        const id = String(item.ID || '').trim();
        const bp = String(item.BP_NUMBER || '').trim();
        
        // RULE: If BP_NUMBER is present and not blank, it is a SUCCESS
        const isSuccess = bp.length > 0 && bp.toLowerCase() !== 'null';

        let updateData = {
          PROCESS_END_AT:    now,
          CHANGED_BY:        ' ', // Single space
          CHANGED_TIMESTAMP: now  // Valid timestamp variable
        };

        if (isSuccess) {
          // SUCCESS CASE
          updateData.STATUS = 'BP CREATION SUCCESS';
          updateData.STATUS_CODE = '02'; // '02' is standard for Record Success
          updateData.SUCCESS_COUNT = 1;
          updateData.ERROR_COUNT = 0;
          updateData.BP_NUMBER = bp;
          updateData.ERROR_CODE = '';
          updateData.ERROR_DETAIL = '';
        } else {
          // FAILURE CASE: BP is missing
          updateData.STATUS = 'BP FAILED';
          updateData.STATUS_CODE = '05'; // '05' is standard for Failure
          updateData.SUCCESS_COUNT = 0;
          updateData.ERROR_COUNT = 1;
          updateData.MASTER_NAME = id; // Map ID to Master Name on failure
          updateData.ERROR_CODE = String(item.ERROR_CODE || '05').trim();
          updateData.ERROR_DETAIL = String(item.ERROR_DETAIL || 'BP creation failed').trim().substring(0, 500);
        }

        return tx.run(
          UPDATE('mobi.db.MOBI_DB_AUDIT')
            .set(updateData)
            .where({ 
                MERCHANT_ID: id,
                TOTAL_RECORDS: 1 // Target the specific record row
            })
        );
      });

      const results = await Promise.all(promises);
      const totalUpdated = results.reduce((acc, cur) => acc + (cur || 0), 0);
      
      console.log(`[AuditRepository] Batch update finished. Items: ${items.length}, Updated: ${totalUpdated}`);
      return totalUpdated;
    });
  }
  async updateProgress(auditId, stats = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    await db.run(UPDATE('mobi.db.MOBI_DB_AUDIT').set({
      TOTAL_RECORDS: stats.totalRows ?? 0,
      SUCCESS_COUNT: stats.validCount ?? 0,
      ERROR_COUNT: stats.errorCount ?? 0,
      ERROR_FILE_PATH: this._text(stats.errorFilePath),
      ...this._details(details),
      CHANGED_BY: changedBy || Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId }));
  }

  async complete(auditId, result, changedBy, options = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusText = options.statusOverride ||
      (result.validCount > 0 && result.errorCount > 0 ? 'PARTIALLY_PROCESSED'
        : result.validCount > 0 ? 'COMPLETED' : 'FAILED');
    const statusCode = StatusCodeUtil.toCode('FILE', statusText, '05');
    const errCode = options.errorCode !== undefined
      ? this._text(options.errorCode)
      : (result.errorCount > 0 ? '04' : '');

    await db.run(UPDATE('mobi.db.MOBI_DB_AUDIT').set({
      STATUS: statusText,
      STATUS_CODE: statusCode,
      TOTAL_RECORDS: result.totalRows ?? 0,
      SUCCESS_COUNT: result.validCount ?? 0,
      ERROR_COUNT: result.errorCount ?? 0,
      ERROR_CODE: errCode,
      ERROR_DETAIL: this._text(options.errorDetail).substring(0, 500),
      ERROR_FILE_PATH: this._text(options.errorFilePath),
      PROCESS_END_AT: now,
      ...this._details(options.details),
      CHANGED_BY: changedBy || Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId }));
  }

  async fail(auditId, error, counts = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const errorDetail = (details.errorDetail !== undefined)
      ? this._text(details.errorDetail).substring(0, 500)
      : this._text(error && error.message).substring(0, 500);
    const errorCode = (error && error.code) ? this._text(error.code) : '05';

    await db.run(UPDATE('mobi.db.MOBI_DB_AUDIT').set({
      STATUS: 'FAILED',
      STATUS_CODE: '05',
      TOTAL_RECORDS: counts.totalRows ?? 0,
      SUCCESS_COUNT: counts.validCount ?? 0,
      ERROR_COUNT: counts.errorCount ?? 0,
      ERROR_CODE: errorCode,
      ERROR_DETAIL: errorDetail,
      ERROR_FILE_PATH: this._text(details.errorFilePath),
      PROCESS_END_AT: now,
      ...this._details(details),
      CHANGED_BY: changedBy || Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId }));
  }

  // ------------------------------------------------------------------
  // NEW : ONE AUDIT ROW PER RECORD
  // ------------------------------------------------------------------
  /**
   * Writes one MOBI_DB_AUDIT row per master record.
   *
   * STATUS / STATUS_CODE per record:
   *    SUCCESS      ('02') -> record was valid and upserted
   *    FAILED       ('05') -> record failed validation
   *    NOT_INSERTED ('04') -> record was valid but nothing was written
   *
   * ERROR_CODE is String(2) in the table, but MasterValidator joins codes
   * ("07,08,13"). To keep the column as-is we store the FIRST code in
   * ERROR_CODE and prefix the full list into ERROR_DETAIL, like the text file.
   *
   * @param {string}  p.runId
   * @param {string}  p.fileName
   * @param {Array}   p.validRecords  clean records (post-validation)
   * @param {Array}   p.errorRows     [{rowNo, mobiReferenceId, errorCode, errorDetail}]
   * @param {boolean} p.inserted      true = validRecords were upserted
   * @param {string}  p.errorFilePath error text file path
   */
  async insertRecordRows({ runId, fileName, validRecords = [], errorRows = [],
    inserted = true, errorFilePath = null,
    processStartAt = null,
    changedBy = Constants.SYSTEM_USERS.SFTP }) {
    if (!validRecords.length && !errorRows.length) return 0;

    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const startedAt = processStartAt || now;
    const entries = [];

    // ---- valid records --------------------------------------------------
    for (const r of validRecords) {
      entries.push({
        AUDIT_ID: uuid(),
        RUN_ID: this._text(runId).substring(0, 50),
        FILE_NAME: this._text(fileName).substring(0, 100),

        STATUS: inserted ? 'SUCCESS' : 'NOT_INSERTED',
        STATUS_CODE: inserted ? '02' : '04',

        TOTAL_RECORDS: 1,
        SUCCESS_COUNT: inserted ? 1 : 0,
        ERROR_COUNT: 0,
        ERROR_CODE: '',
        ERROR_DETAIL: '',
        ERROR_FILE_PATH: null,

        PROCESS_START_AT: startedAt,
        PROCESS_END_AT: now,

        MOBI_PORTAL_CODE: this._text(r.MOBI_PORTAL_CODE).substring(0, 2),
        COMPANY_CODE: this._text(r.SAP_COMPANY_CODE).substring(0, 4),
        MERCHANT_ID: this._text(r.ID).substring(0, 20),
        HOST_NAME: this._text(r.HOST_NAME).substring(0, 15),
        MASTER_NAME: this._text(r.MASTER_NAME).substring(0, 40),

        CREATED_BY: changedBy,
        CREATED_TIMESTAMP: now,
        CHANGED_BY: changedBy,
        CHANGED_TIMESTAMP: now
      });
    }

    // ---- error rows -----------------------------------------------------
    for (const e of errorRows) {
      const allCodes = this._text(e.errorCode).trim();
      const firstCode = allCodes ? allCodes.split(',')[0].trim().substring(0, 2) : '';
      const codePrefix = allCodes && allCodes.includes(',') ? `[CODES: ${allCodes}] ` : '';

      entries.push({
        AUDIT_ID: uuid(),
        RUN_ID: this._text(runId).substring(0, 50),
        FILE_NAME: this._text(fileName).substring(0, 100),

        STATUS: 'FAILED',
        STATUS_CODE: '05',

        TOTAL_RECORDS: 1,
        SUCCESS_COUNT: 0,
        ERROR_COUNT: 1,
        ERROR_CODE: firstCode,
        ERROR_DETAIL: (codePrefix + this._text(e.errorDetail)).substring(0, 500),
        ERROR_FILE_PATH: errorFilePath || null,

        PROCESS_START_AT: startedAt,
        PROCESS_END_AT: now,

        // MasterValidator puts the master ID into mobiReferenceId
        MERCHANT_ID: this._text(e.mobiReferenceId).substring(0, 20),

        CREATED_BY: changedBy,
        CREATED_TIMESTAMP: now,
        CHANGED_BY: changedBy,
        CHANGED_TIMESTAMP: now
      });
    }

    // Chunked insert. Never throws - auditing must not break ingestion.
    const chunkSize = Number(process.env.AUDIT_CHUNK_SIZE || 500);
    let written = 0;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      try {
        await db.run(INSERT.into('mobi.db.MOBI_DB_AUDIT').entries(chunk));
        written += chunk.length;
      } catch (err) {
        console.error(`[AuditRepository] record rows ${i}-${i + chunk.length} failed: ${err.message}`);
      }
    }
    return written;
  }

  /**
   * Existing method kept for back-compatibility - now routed through the new
   * writer (and the missing INSERT import is fixed).
   */
  async insertRecordErrors({ runId, fileName, errorRows, processStartAt, changedBy, errorFilePath = null }) {
    return this.insertRecordRows({
      runId, fileName, validRecords: [], errorRows: errorRows || [],
      inserted: false, errorFilePath, processStartAt, changedBy
    });
  }
}
module.exports = AuditRepository;