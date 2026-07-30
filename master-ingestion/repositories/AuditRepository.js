const cds = require('@sap/cds');
const { UPSERT, UPDATE, INSERT, SELECT } = cds.ql;
const { v4: uuid } = require('uuid');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * AuditRepository (master ingestion)
 *
 * Updated to match the actual MOBI_DB_AUDIT schema:
 *   - AUDIT_ID          : UUID (key)
 *   - PROCESS_ID        : String(50)
 *   - PROCESS_NAME      : String(50)
 *   - PROCESS_TYPE      : String(20)
 *   - OBJECT_ID         : String(100)
 *   - OBJECT_NAME       : String(100)
 *   - STATUS_CODE       : String(3)
 *   - STATUS_MESSAGE    : String(500)
 *   - START_TIME        : Timestamp
 *   - END_TIME          : Timestamp
 *   - CREATED_BY        : String(50)
 *   - CREATED_TIMESTAMP : Timestamp
 */
class AuditRepository {
  _text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  // ------------------------------------------------------------------
  // FILE-LEVEL SUMMARY ROW (Requirement 3: OBJECT_NAME = 'FILE_SUMMARY')
  // ------------------------------------------------------------------
  async start({ auditId, runId, fileName, createdBy, details = {} }) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusCode = StatusCodeUtil.toCode('STARTED', '001');
    const entry = {
      AUDIT_ID: auditId || uuid(),
      PROCESS_ID: this._text(runId || fileName || 'FILE_INGESTION').substring(0, 50),
      PROCESS_NAME: this._text(fileName || 'MASTER_INGESTION').substring(0, 50),
      PROCESS_TYPE: 'FILE',
      OBJECT_ID: this._text(fileName).substring(0, 100),
      OBJECT_NAME: 'FILE_SUMMARY',
      STATUS_CODE: statusCode,
      STATUS_MESSAGE: StatusCodeUtil.toText(statusCode) || 'STARTED',
      START_TIME: now,
      END_TIME: null,
      CREATED_BY: this._text(createdBy || 'System_SFTP').substring(0, 50),
      CREATED_TIMESTAMP: now
    };
    await db.run(UPSERT.into('mobi.db.MOBI_DB_AUDIT').entries(entry));
    return entry;
  }

  async updateProgress(auditId, stats = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusCode = StatusCodeUtil.toCode('PROCESSING', '002');
    const statusMessage = `PROCESSING: ${stats.validCount || 0} valid, ${stats.errorCount || 0} error(s) of ${stats.totalRows || 0} total records`;
    await db.run(
      UPDATE('mobi.db.MOBI_DB_AUDIT')
        .set({
          STATUS_CODE: statusCode,
          STATUS_MESSAGE: statusMessage.substring(0, 500),
          END_TIME: now
        })
        .where({ AUDIT_ID: auditId })
    );
  }

  async complete(auditId, result, changedBy, options = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusText = options.statusOverride ||
      (result.validCount > 0 && result.errorCount > 0 ? 'PARTIALLY_COMPLETED'
        : result.validCount > 0 ? 'COMPLETED' : 'FAILED');
    const statusCode = StatusCodeUtil.toCode(statusText, '003');
    const detailMsg = options.errorDetail
      ? this._text(options.errorDetail)
      : `${StatusCodeUtil.toText(statusCode)}: ${result.validCount || 0} valid, ${result.errorCount || 0} error(s) of ${result.totalRows || 0} total records`;

    await db.run(
      UPDATE('mobi.db.MOBI_DB_AUDIT')
        .set({
          STATUS_CODE: statusCode,
          STATUS_MESSAGE: detailMsg.substring(0, 500),
          END_TIME: now
        })
        .where({ AUDIT_ID: auditId })
    );
  }

  async fail(auditId, error, counts = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    // Preserve DUPLICATE_FILE (015) or other specific status codes in MOBI_DB_AUDIT
    let errCode = (error && error.code) ? String(error.code).trim() : '';
    if (!errCode && details.errorCode) errCode = String(details.errorCode).trim();
    const statusCode = (errCode && StatusCodeUtil.STATUS[errCode])
      ? errCode
      : StatusCodeUtil.toCode('FAILED', '004');

    const errorDetail = (details.errorDetail !== undefined)
      ? this._text(details.errorDetail)
      : this._text(error && error.message);
    const statusMessage = `${StatusCodeUtil.toText(statusCode)}: ${errorDetail}`;

    await db.run(
      UPDATE('mobi.db.MOBI_DB_AUDIT')
        .set({
          STATUS_CODE: statusCode,
          STATUS_MESSAGE: statusMessage.substring(0, 500),
          END_TIME: now
        })
        .where({ AUDIT_ID: auditId })
    );
  }

  // ------------------------------------------------------------------
  // RECORD INGESTION ROWS: MASTER_INGESTION / PORTAL TO BTP
  // ------------------------------------------------------------------
  async insertRecordRows({
    runId,
    fileName,
    validRecords = [],
    errorRows = [],
    inserted = true,
    errorFilePath = null,
    processStartAt = null,
    changedBy = Constants.SYSTEM_USERS.SFTP
  }) {
    if (!validRecords.length && !errorRows.length) return 0;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const startedAt = processStartAt || now;
    const entries = [];

    // ---- valid records (Success / Skipped scenario) --------------------
    for (const r of validRecords) {
      const statusCode = inserted
        ? StatusCodeUtil.toCode('SUCCESS', '006')
        : StatusCodeUtil.toCode('SKIPPED', '010');
      const statusMessage = inserted
        ? StatusCodeUtil.toText(statusCode) || 'SUCCESS'
        : StatusCodeUtil.toText(statusCode) || 'SKIPPED';

      entries.push({
        AUDIT_ID: uuid(),
        PROCESS_ID: this._text(runId || fileName || 'MASTER_INGESTION').substring(0, 50),
        PROCESS_NAME: 'MASTER_INGESTION',
        PROCESS_TYPE: 'SFTP TO BTP',
        OBJECT_ID: this._text(r.ID).substring(0, 100),
        OBJECT_NAME: this._text(r.MASTER_NAME || r.NAME || r.ID).substring(0, 100),
        STATUS_CODE: statusCode,
        STATUS_MESSAGE: statusMessage.substring(0, 500),
        START_TIME: startedAt,
        END_TIME: now,
        CREATED_BY: this._text(changedBy || Constants.SYSTEM_USERS.SFTP).substring(0, 50),
        CREATED_TIMESTAMP: now
      });
    }

    // ---- error rows (Failure scenario) ----------------------------------
    for (const e of errorRows) {
      const allCodes = this._text(e.errorCode).trim();
      const codePrefix = allCodes ? `[CODES: ${allCodes}] ` : '';
      const statusCode = StatusCodeUtil.toCode('FAILED', '004');
      const detail = this._text(e.errorDetail || StatusCodeUtil.toText(statusCode));
      const statusMessage = (codePrefix + detail).substring(0, 500);

      entries.push({
        AUDIT_ID: uuid(),
        PROCESS_ID: this._text(runId || fileName || 'MASTER_INGESTION').substring(0, 50),
        PROCESS_NAME: 'MASTER_INGESTION',
        PROCESS_TYPE: 'SFTP TO BTP',
        OBJECT_ID: this._text(e.mobiReferenceId || (`ROW_${e.rowNo || 'UNKNOWN'}`)).substring(0, 100),
        OBJECT_NAME: this._text(e.mobiReferenceId ? `${e.mobiReferenceId} (Row ${e.rowNo})` : `Row ${e.rowNo || 'UNKNOWN'}`).substring(0, 100),
        STATUS_CODE: statusCode,
        STATUS_MESSAGE: statusMessage,
        START_TIME: startedAt,
        END_TIME: now,
        CREATED_BY: this._text(changedBy || Constants.SYSTEM_USERS.SFTP).substring(0, 50),
        CREATED_TIMESTAMP: now
      });
    }

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

  // ------------------------------------------------------------------
  // CPI TO SAP STATUS REPLICATION: CREATE NEW ROWS & UPDATE FILE SUMMARY
  // ------------------------------------------------------------------
  /**
   * Once STATUS_CODE in MOBI_DB_MASTER gets updated to 063 (BP_CREATED_SUCCESS) or 100 (error),
   * 1. Creates NEW rows in MOBI_DB_AUDIT table (PROCESS_TYPE = 'CPI TO SAP')
   * 2. Requirement 4: Updates the FILE summary row (PROCESS_TYPE = 'FILE') with a summary
   *    of how many BPs created and how many failed!
   */
  async createRecordAuditFromCPIBatch(items) {
    if (!items || !items.length) return 0;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    // Look up master table records to retrieve EXTERNAL_BP_NUMBER, MASTER_NAME, and AUDIT_ID
    const ids = items.map(i => i.ID).filter(Boolean);
    const masterMap = new Map();
    if (ids.length) {
      try {
        const rows = await db.run(
          SELECT.from('mobi.db.MOBI_DB_MASTER')
            .columns('ID', 'EXTERNAL_BP_NUMBER', 'MASTER_NAME', 'AUDIT_ID')
            .where({ ID: { in: ids } })
        );
        for (const r of (rows || [])) {
          masterMap.set(r.ID, r);
        }
      } catch (e) {
        console.warn('[AuditRepository] Could not preload master map for CPI audit:', e.message);
      }
    }

    let successCount = 0;
    let failCount = 0;
    let targetProcessId = null;

    const entries = items.map(item => {
      const bp = String(item.BP_NUMBER || '').trim();
      const isSuccess = (bp.length > 0 && bp.toLowerCase() !== 'null') || item.STATUS_CODE === '063';
      if (isSuccess) successCount++;
      else failCount++;

      const statusCode = isSuccess ? '063' : (item.STATUS_CODE || '100');
      const statusMessage = isSuccess
        ? (StatusCodeUtil.toText('063') || 'BP_CREATED_SUCCESS')
        : String(item.ERROR_DETAIL || item.ERROR_MESSAGE || item.ERROR_CODE || StatusCodeUtil.toText('100') || 'UNKNOWN_ERROR').trim().substring(0, 500);

      const masterRow = masterMap.get(item.ID);
      const externalBpNumber = item.EXTERNAL_BP_NUMBER || (masterRow && masterRow.EXTERNAL_BP_NUMBER) || item.ID || '';
      const objectName = isSuccess
        ? bp
        : (item.BP_NUMBER || (masterRow && masterRow.MASTER_NAME) || item.ID || 'ERROR');

      const cpiRunId = item.PROCESS_ID || item.RUN_ID || item.AUDIT_ID;
      const processId = String(
        cpiRunId || (masterRow && masterRow.AUDIT_ID) || item.ID || 'CPI_RESPONSE'
      ).substring(0, 50);

      if (!targetProcessId) targetProcessId = processId;

      return {
        AUDIT_ID: uuid(),
        PROCESS_ID: processId,
        PROCESS_NAME: 'INTEGRATION',
        PROCESS_TYPE: 'CPI TO SAP',
        OBJECT_ID: String(externalBpNumber).substring(0, 100),
        OBJECT_NAME: String(objectName).substring(0, 100),
        STATUS_CODE: statusCode,
        STATUS_MESSAGE: statusMessage.substring(0, 500),
        START_TIME: now,
        END_TIME: now,
        CREATED_BY: String(item.CREATED_BY || 'CPI_SYSTEM').substring(0, 50),
        CREATED_TIMESTAMP: now
      };
    });

    const chunkSize = Number(process.env.AUDIT_CHUNK_SIZE || 500);
    let written = 0;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      try {
        await db.run(INSERT.into('mobi.db.MOBI_DB_AUDIT').entries(chunk));
        written += chunk.length;
      } catch (err) {
        console.error(`[AuditRepository] CPI audit insertion failed for chunk ${i}: ${err.message}`);
      }
    }

    // ---- Requirement 4: Update the FILE summary row with BP creation statistics ----
    if (targetProcessId) {
      const summaryMsg = `COMPLETED: ${successCount} BPs created successfully, ${failCount} failed of ${items.length} total records`;
      const summaryStatusCode = failCount === 0 ? '063' : (successCount > 0 ? '005' : '100');
      try {
        await db.run(
          UPDATE('mobi.db.MOBI_DB_AUDIT')
            .set({
              STATUS_CODE: summaryStatusCode,
              STATUS_MESSAGE: summaryMsg.substring(0, 500),
              END_TIME: now
            })
            .where({
              PROCESS_TYPE: 'FILE',
              PROCESS_ID: targetProcessId
            })
        );
        console.log(`[AuditRepository] Updated file summary row (${targetProcessId}) with CPI statistics: ${summaryMsg}`);
      } catch (summaryErr) {
        console.warn('[AuditRepository] Could not update file summary row with CPI statistics:', summaryErr.message);
      }
    }

    return written;
  }

  async updateRecordAuditFromMasterBatch(items) {
    return this.createRecordAuditFromCPIBatch(items);
  }

  async updateRecordAuditFromMaster(item) {
    if (!item) return 0;
    return this.createRecordAuditFromCPIBatch([item]);
  }

  async insertRecordErrors({ runId, fileName, errorRows, processStartAt, changedBy, errorFilePath = null }) {
    return this.insertRecordRows({
      runId,
      fileName,
      validRecords: [],
      errorRows: errorRows || [],
      inserted: false,
      errorFilePath,
      processStartAt,
      changedBy
    });
  }
}

module.exports = AuditRepository;
