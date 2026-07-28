const cds = require('@sap/cds');
const { UPSERT, UPDATE, INSERT } = cds.ql;
const { v4: uuid } = require('uuid');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

// === SAFE ENTITY RESOLVER (used only for insert paths) ===
let _auditEntity = null;
function getAuditEntity() {
  if (_auditEntity) return _auditEntity;
  try {
    const entities = cds.entities('mobi.db') || {};
    _auditEntity = entities.MOBI_DB_AUDIT || entities['mobi.db.MOBI_DB_AUDIT'];
  } catch (_) {}
  if (!_auditEntity && cds.model) {
    try {
      _auditEntity = cds.model.definitions?.['mobi.db.MOBI_DB_AUDIT'] ||
                     cds.model.entities?.['mobi.db.MOBI_DB_AUDIT'];
    } catch (_) {}
  }
  return _auditEntity;
}

class AuditRepository {
  _text(value) { return value === null || value === undefined ? '' : String(value); }

  _details(details = {}) {
    return {
      CONSOL_REF_ID:     this._text(details.CONSOL_REF_ID),
      MOBI_REFERENCE_ID: this._text(details.MOBI_REFERENCE_ID),
      COMPANY_CODE:      this._text(details.COMPANY_CODE),
      MOBI_PORTAL_CODE:  this._text(details.MOBI_PORTAL_CODE),
      PAYMENT_TYPE:      this._text(details.PAYMENT_TYPE),
      PAYMENT_SUB_TYPE:  this._text(details.PAYMENT_SUB_TYPE),
      MERCHANT_ID:       this._text(details.MERCHANT_ID),
      HOST_NAME:         this._text(details.HOST_NAME)
    };
  }

  // ------------------------------------------------------------------
  // FILE-LEVEL SUMMARY ROW  (unchanged behaviour)
  // ------------------------------------------------------------------

  async start({ auditId, runId, fileName, createdBy, details = {} }) {
    const db  = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const entry = {
      AUDIT_ID:         auditId,
      RUN_ID:           this._text(runId),
      FILE_NAME:        this._text(fileName),
      STATUS:           'PROCESSING',
      STATUS_CODE:      '01',
      TOTAL_RECORDS:    0,
      SUCCESS_COUNT:    0,
      ERROR_COUNT:      0,
      ERROR_CODE:       '',
      ERROR_DETAIL:     '',
      PROCESS_START_AT: now,
      ...this._details(details),
      CREATED_BY:       'System_SFTP',
      CREATED_TIMESTAMP:now,
      CHANGED_BY:       '',
      CHANGED_TIMESTAMP:''
    };

    const Audit = getAuditEntity();
    if (Audit) {
      await db.run(UPSERT.into(Audit).entries(entry));
    } else {
      await db.run(UPSERT.into('MOBI_DB_AUDIT').entries(entry));
    }
    return entry;
  }

  async updateProgress(auditId, stats = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    await db.update('MOBI_DB_AUDIT').set({
      TOTAL_RECORDS:     stats.totalRows  ?? 0,
      SUCCESS_COUNT:     stats.validCount ?? 0,
      ERROR_COUNT:       stats.errorCount ?? 0,
      ERROR_FILE_PATH:   this._text(stats.errorFilePath),
      ...this._details(details),
      CHANGED_BY:        changedBy || Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId });
  }

  async complete(auditId, result, changedBy, options = {}) {
    if (!auditId) return;
    const db  = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusText = options.statusOverride ||
      (result.validCount > 0 && result.errorCount > 0 ? 'PARTIALLY_PROCESSED'
       : result.validCount > 0 ? 'COMPLETED' : 'FAILED');
    const statusCode = StatusCodeUtil.toCode('FILE', statusText, '05');
    const errCode    = options.errorCode !== undefined
      ? this._text(options.errorCode)
      : (result.errorCount > 0 ? '04' : '');
    await db.update('MOBI_DB_AUDIT').set({
      STATUS:            statusText,
      STATUS_CODE:       statusCode,
      TOTAL_RECORDS:     result.totalRows  ?? 0,
      SUCCESS_COUNT:     result.validCount ?? 0,
      ERROR_COUNT:       result.errorCount ?? 0,
      ERROR_CODE:        errCode,
      ERROR_DETAIL:      this._text(options.errorDetail).substring(0, 500),
      ERROR_FILE_PATH:   this._text(options.errorFilePath),
      PROCESS_END_AT:    now,
      ...this._details(options.details),
      CHANGED_BY:        changedBy || Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId });
  }

  async fail(auditId, error, counts = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db  = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const errorDetail = (details.errorDetail !== undefined)
      ? this._text(details.errorDetail).substring(0, 500)
      : this._text(error && error.message).substring(0, 500);
    const errorCode   = (error && error.code) ? this._text(error.code) : '05';
    await db.update('MOBI_DB_AUDIT').set({
      STATUS:            'FAILED',
      STATUS_CODE:       '05',
      TOTAL_RECORDS:     counts.totalRows ?? 0,
      SUCCESS_COUNT:     counts.validCount ?? 0,
      ERROR_COUNT:       counts.errorCount ?? 0,
      ERROR_CODE:        errorCode,
      ERROR_DETAIL:      errorDetail,
      ERROR_FILE_PATH:   this._text(details.errorFilePath),
      PROCESS_END_AT:    now,
      ...this._details(details),
      CHANGED_BY:        changedBy || Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }).where({ AUDIT_ID: auditId });
  }

  // ------------------------------------------------------------------
  // NEW : ONE AUDIT ROW PER RECORD
  // ------------------------------------------------------------------

  async insertRecordRows({ runId, fileName, validRecords = [], errorRows = [],
                           inserted = true, errorFilePath = null,
                           processStartAt = null,
                           changedBy = Constants.SYSTEM_USERS.SFTP }) {
    if (!validRecords.length && !errorRows.length) return 0;
    const db  = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const startedAt = processStartAt || now;
    const entries = [];

    for (const r of validRecords) {
      entries.push({
        AUDIT_ID:          uuid(),
        RUN_ID:            this._text(runId).substring(0, 50),
        FILE_NAME:         this._text(fileName).substring(0, 100),
        STATUS:            inserted ? 'SUCCESS' : 'NOT_INSERTED',
        STATUS_CODE:       inserted ? '02'      : '04',
        TOTAL_RECORDS:     1,
        SUCCESS_COUNT:     inserted ? 1 : 0,
        ERROR_COUNT:       0,
        ERROR_CODE:        '',
        ERROR_DETAIL:      '',
        ERROR_FILE_PATH:   null,
        PROCESS_START_AT:  startedAt,
        PROCESS_END_AT:    now,
        MOBI_PORTAL_CODE:  this._text(r.MOBI_PORTAL_CODE).substring(0, 2),
        COMPANY_CODE:      this._text(r.SAP_COMPANY_CODE).substring(0, 4),
        MERCHANT_ID:       this._text(r.ID).substring(0, 20),
        HOST_NAME:         this._text(r.HOST_NAME).substring(0, 15),
        MASTER_NAME:       this._text(r.MASTER_NAME).substring(0, 40),
        CREATED_BY:        changedBy,
        CREATED_TIMESTAMP: now,
        CHANGED_BY:        changedBy,
        CHANGED_TIMESTAMP: now
      });
    }

    for (const e of errorRows) {
      const allCodes   = this._text(e.errorCode).trim();
      const firstCode  = allCodes ? allCodes.split(',')[0].trim().substring(0, 2) : '';
      const codePrefix = allCodes && allCodes.includes(',') ? `[CODES: ${allCodes}]`  : '';
      entries.push({
        AUDIT_ID:          uuid(),
        RUN_ID:            this._text(runId).substring(0, 50),
        FILE_NAME:         this._text(fileName).substring(0, 100),
        STATUS:            'FAILED',
        STATUS_CODE:       '05',
        TOTAL_RECORDS:     1,
        SUCCESS_COUNT:     0,
        ERROR_COUNT:       1,
        ERROR_CODE:        firstCode,
        ERROR_DETAIL:      (codePrefix + this._text(e.errorDetail)).substring(0, 500),
        ERROR_FILE_PATH:   errorFilePath || null,
        PROCESS_START_AT:  startedAt,
        PROCESS_END_AT:    now,
        MERCHANT_ID:       this._text(e.mobiReferenceId).substring(0, 20),
        CREATED_BY:        changedBy,
        CREATED_TIMESTAMP: now,
        CHANGED_BY:        changedBy,
        CHANGED_TIMESTAMP: now
      });
    }

    const chunkSize = Number(process.env.AUDIT_CHUNK_SIZE || 500);
    let written = 0;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      try {
        const Audit = getAuditEntity();
        if (Audit) {
          await db.run(INSERT.into(Audit).entries(chunk));
        } else {
          await db.run(INSERT.into('MOBI_DB_AUDIT').entries(chunk));
        }
        written += chunk.length;
      } catch (err) {
        console.error(`[AuditRepository] record rows ${i}-${i + chunk.length} failed: ${err.message}`);
      }
    }
    return written;
  }

  async insertRecordErrors({ runId, fileName, errorRows, processStartAt, changedBy, errorFilePath = null }) {
    return this.insertRecordRows({
      runId, fileName, validRecords: [], errorRows: errorRows || [],
      inserted: false, errorFilePath, processStartAt, changedBy
    });
  }

  // ------------------------------------------------------------------
  // NEW: Replicate CPI / external MASTER updates into per-record AUDIT rows
  // ------------------------------------------------------------------

  /**
   * Uses RAW SQL to completely bypass CDS CQL compiler.
   * This fixes the exact error:
   * "CDS compilation failed ... Mismatched ‘[’, expecting ‹Identifier›, ‘(’"
   */
  async updateRecordAuditFromMaster(masterRecord = {}, changedBy = 'CPI') {
    const merchantId = this._text(masterRecord.ID || masterRecord.MERCHANT_ID);
    const fileName   = this._text(masterRecord.FILE_NAME);
    if (!merchantId || !fileName) {
      console.warn('[AuditRepository] updateRecordAuditFromMaster: missing ID or FILE_NAME, skipping');
      return 0;
    }

    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    const ps = String(masterRecord.POSTING_STATUS || masterRecord.STATUS_CODE || '').trim().toUpperCase();

    let statusText   = 'SUCCESS';
    let statusCode   = '02';
    let successCount = 1;
    let errorCount   = 0;
    let errorCode    = '';
    let errorDetail  = '';

    const isSuccess = ['01', 'ACTIVE', 'SUCCESS', 'POSTED', 'COMPLETED', '02'].includes(ps);

    if (isSuccess) {
      statusText   = 'SUCCESS';
      statusCode   = '02';
      successCount = 1;
      errorCount   = 0;
    } else {
      statusText   = 'FAILED';
      statusCode   = '05';
      successCount = 0;
      errorCount   = 1;
      errorCode    = masterRecord.ERROR_CODE || (ps.length === 2 ? ps : '05');
      errorDetail  = this._text(
        masterRecord.ERROR_DETAIL ||
        masterRecord.ERROR_MESSAGE ||
        `CPI / downstream processing failed (POSTING_STATUS=${masterRecord.POSTING_STATUS || ps})`
      ).substring(0, 500);
    }

    // ============================================================
    // ULTRA-SAFE RAW SQL — completely bypasses CDS CQL compiler
    // This is the hardened version to fix:
    // "CDS compilation failed ... Mismatched ‘[’, expecting ‹Identifier›, ‘(’"
    // ============================================================
    const sql = `
      UPDATE "MOBI_DB_AUDIT"
      SET 
        "STATUS"            = ?, 
        "STATUS_CODE"       = ?, 
        "SUCCESS_COUNT"     = ?, 
        "ERROR_COUNT"       = ?, 
        "ERROR_CODE"        = ?, 
        "ERROR_DETAIL"      = ?, 
        "PROCESS_END_AT"    = ?, 
        "CHANGED_BY"        = ?, 
        "CHANGED_TIMESTAMP" = ?
      WHERE 
        "MERCHANT_ID"   = ? 
        AND "FILE_NAME" = ? 
        AND "TOTAL_RECORDS" = 1
    `;

    const params = [
      statusText,
      statusCode,
      successCount,
      errorCount,
      errorCode,
      errorDetail,
      now,
      changedBy,
      now,
      merchantId,
      fileName
    ];

    console.log(`[AuditRepository] RAW SQL replication for ${merchantId} / ${fileName}`);

    // ============================================================
    // BULLETPROOF RAW SQL — ZERO CQL, ZERO CDS COMPILER
    // Use the OBJECT form { sql, values }.
    // This is the recommended way to run native SQL in CAP
    // without triggering the CDS CQL compiler at all.
    // This fixes: "CDS compilation failed ... Mismatched ‘[’, expecting ‹Identifier›, ‘(’"
    // ============================================================
    const result = await db.run({
      sql: sql.trim(),
      values: params
    });

    console.log(`[AuditRepository] Replicated MASTER update for ${merchantId} (file: ${fileName}) -> ${statusText}`);
    return result ?? 1;
  }
}

module.exports = AuditRepository;