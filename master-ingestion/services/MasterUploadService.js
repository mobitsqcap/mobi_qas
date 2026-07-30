const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');

const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const HashUtil = require('../utils/HashUtil');
const DateUtil = require('../utils/DateUtil');
const ErrorMessageUtil = require('../utils/ErrorMessageUtil');
const MasterRecord = require('../models/MasterRecord');
const MasterValidator = require('./MasterValidator');

const F = StatusCodeUtil.FRIENDLY;

/**
 * MasterUploadService
 *
 * Handles the "Master BP Upload" UI app flow:
 *   - merchants whose BP number was ALREADY created in SAP Public Cloud
 *     are uploaded manually from the freestyle UI5 app (Excel -> UI -> this action)
 *   - records are validated exactly like the SFTP CSV ingestion (MasterValidator)
 *   - PLUS for this flow BP_NUMBER and EXTERNAL_BP_NUMBER are mandatory
 *   - duplicates already present in MOBI_DB_MASTER are REJECTED
 *   - valid records are inserted with STATUS_CODE '063' (BP_CREATED_SUCCESS)
 *     and the BP_NUMBER provided, so CPI will NOT try to create the BP again
 */
class MasterUploadService {

  constructor({ masterRepository, fileLogRepository, auditRepository }) {
    Object.assign(this, { masterRepository, fileLogRepository, auditRepository });
    this.validator = new MasterValidator();
  }

  /**
   * @param {object} p
   * @param {Array}  p.records   UI payload (DB-style field names, see service .cds)
   * @param {string} p.fileName  uploaded file name (for traceability only)
   * @param {string} p.actor     logged in user id
   * @returns summary + per-row errors for the UI table
   */
  async processUpload({ records = [], fileName = 'Master_BP_Upload.xlsx', actor }) {
    if (!records.length) {
      const e = new Error('No records were sent from the app. Please upload a file with at least one data row.');
      e.code = StatusCodeUtil.toCode('EMPTY_FILE', '013');
      throw e;
    }

    const now = DateUtil.nowTimestamp();
    const auditId = uuid();
    const fileId = HashUtil.sha256(`${fileName}|${now}`);
    const fileHash = HashUtil.sha256(JSON.stringify(records));
    const changedBy = actor || Constants.SYSTEM_USERS.DEFAULT;

    /* -------------------------------------------------------------- */
    /* 1) Map UI payload -> MasterRecord (same shape as CSV ingestion)  */
    /* -------------------------------------------------------------- */
    const mapped = records.map((r, idx) =>
      MasterRecord.fromCsvRow({
        mobi_portal_code: r.MOBI_PORTAL_CODE,
        sap_company_code: r.SAP_COMPANY_CODE,
        id: r.ID,
        external_bp_number: r.EXTERNAL_BP_NUMBER,
        bp_number: r.BP_NUMBER,
        type: r.TYPE,
        name: r.MASTER_NAME,
        address1: r.ADDRESS1,
        postal_code: r.POSTAL_CODE,
        country: r.COUNTRY,
        country_code: r.COUNTRY_CODE,
        business_reg_no_tin: r.BUSINESS_REG_NO_TIN,
        host_name: r.HOST_NAME
      }, idx + 2) // excel-style row number (row 1 = header)
    );

    /* -------------------------------------------------------------- */
    /* 2) Mandatory for THIS flow: BP_NUMBER + EXTERNAL_BP_NUMBER       */
    /*    (they are optional in the SFTP flow, so checked separately)   */
    /* -------------------------------------------------------------- */
    const extraErrors = [];
    const candidates = [];
    for (const rec of mapped) {
      const missing = [];
      if (!String(rec.EXTERNAL_BP_NUMBER_RAW || rec.EXTERNAL_BP_NUMBER || '').trim()) {
        missing.push(F.missingField('EXTERNAL_BP_NUMBER'));
      }
      if (!String(rec.BP_NUMBER_RAW || rec.BP_NUMBER || '').trim() || String(rec.BP_NUMBER).trim() === ' ') {
        missing.push(F.missingField('BP_NUMBER'));
      }
      if (missing.length) {
        extraErrors.push({
          rowNo: rec._rowNumber,
          mobiReferenceId: rec._rawId || rec.ID || '',
          errorCode: Constants.ERROR_CODES.MANDATORY_FIELD_MISSING,
          errorDetail: missing.join(' ')
        });
      } else {
        candidates.push(rec);
      }
    }

    /* -------------------------------------------------------------- */
    /* 3) Existing-BP duplicate check (portal|company|id composite)     */
    /* -------------------------------------------------------------- */
    const existingIdKeys = await this._loadExistingIdKeys(candidates);

    /* -------------------------------------------------------------- */
    /* 4) Full field validation (same rules as the SFTP ingestion)      */
    /* -------------------------------------------------------------- */
    const { validRecords, errorRows } = this.validator.validateRecords(candidates, { existingIdKeys });

    const allErrors = [...errorRows, ...extraErrors]
      .sort((a, b) => (Number(a.rowNo) || 0) - (Number(b.rowNo) || 0));

    /* -------------------------------------------------------------- */
    /* 5) Insert valid records with STATUS_CODE '063'                   */
    /* -------------------------------------------------------------- */
    let inserted = 0;
    let insertError = null;

    const enriched = validRecords.map((record, index) => ({
      ...record,
      AUDIT_ID: auditId,
      FILE_ID: fileId,
      FILE_NAME: fileName,
      RECORD_NUMBER: index + 1,
      POSTING_STATUS: '01',
      STATUS_CODE: '063',          // BP_CREATED_SUCCESS -> CPI skips these
      BP_CREATION_DATE: now,
      ACTIVE_FLAG: Constants.ACTIVE_FLAG,
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: ' '
    }));

    if (enriched.length) {
      try {
        await this.masterRepository.upsertBatch(enriched);
        inserted = enriched.length;
      } catch (upsertErr) {
        insertError = upsertErr;
        // HANA unique constraint (301) => duplicate slipped in
        const msg = String(upsertErr?.message || '').toLowerCase();
        if (upsertErr?.code == 301 || msg.includes('unique constraint') || msg.includes('duplicate')) {
          const sampleId = enriched[0]?.ID || '';
          allErrors.push({
            rowNo: enriched[0]?._rowNumber || 2,
            mobiReferenceId: sampleId,
            errorCode: Constants.ERROR_CODES.DUPLICATE_BP_IN_DATABASE,
            errorDetail: F.duplicateBpInDb(sampleId, '', '')
          });
          inserted = 0;
        } else {
          throw upsertErr;
        }
      }
    }

    const totalRows = mapped.length;
    const validCount = inserted;
    const errorCount = totalRows - inserted;

    /* -------------------------------------------------------------- */
    /* 6) Traceability: FILELOG + AUDIT (summary + record rows)         */
    /* -------------------------------------------------------------- */
    const errorDetail = allErrors.length
      ? ErrorMessageUtil.generateFileErrorSummary(allErrors, totalRows, validCount, errorCount)
      : '';

    try {
      await this.fileLogRepository.createInitial(
        { name: fileName, path: 'UI_UPLOAD/Master BP Upload', sizeBytes: null },
        auditId,
        fileHash,
        null,
        changedBy
      );
      await this.fileLogRepository.updateResult(
        auditId,
        { totalRows, validCount, errorCount },
        fileHash,
        changedBy,
        null,
        { errorDetail }
      );
    } catch (logErr) {
      console.warn(`[MasterUploadService] filelog write failed: ${logErr.message}`);
    }

    try {
      await this.auditRepository.start({
        auditId,
        runId: auditId,
        fileName,
        createdBy: changedBy
      });
      await this.auditRepository.complete(
        auditId,
        { totalRows, validCount, errorCount },
        changedBy,
        { errorDetail: errorDetail || undefined }
      );
      await this._insertRecordAuditRows({ auditId, validRecords: enriched.slice(0, inserted), errorRows: allErrors, fileName, changedBy, startedAt: now });
    } catch (auditErr) {
      console.warn(`[MasterUploadService] audit write failed: ${auditErr.message}`);
    }

    /* -------------------------------------------------------------- */
    /* 7) Result back to the UI                                         */
    /* -------------------------------------------------------------- */
    const message = errorCount === 0
      ? `${inserted} record(s) inserted into MOBI_DB_MASTER with STATUS_CODE 063 (BP_CREATED_SUCCESS).`
      : `${inserted} of ${totalRows} record(s) inserted. ${errorCount} record(s) rejected (see errors).`;

    return {
      totalRows,
      validCount,
      errorCount,
      inserted,
      message,
      errors: allErrors.map((e) => ({
        rowNo: Number(e.rowNo) || 0,
        id: String(e.mobiReferenceId || ''),
        errorDetail: String(e.errorDetail || '').substring(0, 500)
      }))
    };
  }

  /** composite-key set (portal|company|id) - same logic as UnifiedIngestionHandler */
  async _loadExistingIdKeys(candidates) {
    const keySet = new Set();
    const ids = [...new Set((candidates || []).map((r) => String(r.ID || '').trim()).filter(Boolean))];
    if (!ids.length) return keySet;

    try {
      const db = await cds.connect.to('db');
      const { SELECT } = cds.ql;
      const rows = await db.run(
        SELECT.from('mobi.db.MOBI_DB_MASTER')
          .columns('MOBI_PORTAL_CODE', 'SAP_COMPANY_CODE', 'ID')
          .where({ ID: { in: ids }, ACTIVE_FLAG: Constants.ACTIVE_FLAG })
      );
      for (const r of rows || []) {
        const portal = String(r.MOBI_PORTAL_CODE || '').trim().toUpperCase();
        const company = String(r.SAP_COMPANY_CODE || '').trim();
        const id = String(r.ID || '').trim().toUpperCase();
        if (portal && company && id) keySet.add(`${portal}|${company}|${id}`);
      }
    } catch (e) {
      console.warn(`[MasterUploadService] existing-key preload failed: ${e.message}`);
    }
    return keySet;
  }

  /** record-level audit rows (PROCESS_TYPE = 'PORTAL TO BTP') */
  async _insertRecordAuditRows({ auditId, validRecords, errorRows, fileName, changedBy, startedAt }) {
    const db = await cds.connect.to('db');
    const { INSERT } = cds.ql;
    const now = DateUtil.nowTimestamp();
    const entries = [];

    for (const r of validRecords) {
      entries.push({
        AUDIT_ID: uuid(),
        PROCESS_ID: String(auditId).substring(0, 50),
        PROCESS_NAME: 'MASTER_BP_UPLOAD',
        PROCESS_TYPE: 'PORTAL TO BTP',
        OBJECT_ID: String(r.EXTERNAL_BP_NUMBER || r.ID || '').substring(0, 100),
        OBJECT_NAME: String(r.BP_NUMBER || r.MASTER_NAME || r.ID || '').substring(0, 100),
        STATUS_CODE: '063',
        STATUS_MESSAGE: `${StatusCodeUtil.toText('063')}: BP ${r.BP_NUMBER} already created in Public Cloud; uploaded manually from Master BP Upload app.`,
        START_TIME: startedAt || now,
        END_TIME: now,
        CREATED_BY: String(changedBy || Constants.SYSTEM_USERS.DEFAULT).substring(0, 50),
        CREATED_TIMESTAMP: now
      });
    }

    for (const e of errorRows) {
      entries.push({
        AUDIT_ID: uuid(),
        PROCESS_ID: String(auditId).substring(0, 50),
        PROCESS_NAME: 'MASTER_BP_UPLOAD',
        PROCESS_TYPE: 'PORTAL TO BTP',
        OBJECT_ID: String(e.mobiReferenceId || `ROW_${e.rowNo || 'UNKNOWN'}`).substring(0, 100),
        OBJECT_NAME: String(
          e.mobiReferenceId ? `${e.mobiReferenceId} (Row ${e.rowNo})` : `Row ${e.rowNo || 'UNKNOWN'}`
        ).substring(0, 100),
        STATUS_CODE: '004', // FAILED
        STATUS_MESSAGE: String(`[CODES: ${e.errorCode || ''}] ${e.errorDetail || ''}`).substring(0, 500),
        START_TIME: startedAt || now,
        END_TIME: now,
        CREATED_BY: String(changedBy || Constants.SYSTEM_USERS.DEFAULT).substring(0, 50),
        CREATED_TIMESTAMP: now
      });
    }

    const chunkSize = Number(process.env.AUDIT_CHUNK_SIZE || 500);
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      try {
        await db.run(INSERT.into('mobi.db.MOBI_DB_AUDIT').entries(chunk));
      } catch (err) {
        console.error(`[MasterUploadService] audit rows ${i}-${i + chunk.length} failed: ${err.message}`);
      }
    }
  }
}

module.exports = MasterUploadService;
