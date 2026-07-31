'use strict';

const cds = require('@sap/cds');
const { INSERT, UPSERT, UPDATE, DELETE } = cds.ql;

const { v4: uuid } = require('uuid');

const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const ENTITY = 'mobi.db.MOBI_DB_AUDIT';
const WRITE_CHUNK_SIZE = 500;

/**
 * Summary + row-level audit using the unchanged MOBI_DB_AUDIT schema.
 *
 * Summary row:
 *   AUDIT_ID    = FILELOG.AUDIT_ID
 *   PROCESS_ID  = FILELOG.AUDIT_ID
 *   OBJECT_ID   = source filename
 *   OBJECT_NAME = FILE_SUMMARY
 *
 * Detail rows:
 *   AUDIT_ID    = unique UUID per CSV transaction
 *   PROCESS_ID  = FILELOG.AUDIT_ID (shared grouping value)
 *   OBJECT_ID   = source filename
 *   OBJECT_NAME = MOBI_REFERENCE_ID, or ROW_<number> when unavailable
 *
 * STATUS_CODE always contains one three-digit code. Full multi-error details
 * are preserved in the companion text report; AUDIT stores a concise summary.
 */
class AuditRepository {
  constructor() {
    this.metadata = new Map();
  }

  async start({ auditId, runId, fileName, createdBy }) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    const meta = {
      auditId: String(auditId),
      processId: String(auditId).slice(0, 50),
      fileName: String(fileName || '').slice(0, 100),
      createdBy: String(createdBy || 'SYSTEM_SFTP').slice(0, 50),
      startTime: now
    };
    this.metadata.set(String(auditId), meta);

    await db.run(DELETE.from(ENTITY).where({ PROCESS_ID: meta.processId }));
    await db.run(DELETE.from(ENTITY).where({ AUDIT_ID: auditId }));

    const code = StatusCodeUtil.toCode('STARTED');
    await db.run(
      INSERT.into(ENTITY).entries(this._entry({
        meta,
        rowAuditId: meta.auditId,
        objectName: 'FILE_SUMMARY',
        statusCode: code,
        statusMessage: `File audit started for ${meta.fileName}.`,
        endTime: null
      }))
    );
  }

  async markProcessing(auditId, stats = {}) {
    return this.updateProgress(auditId, stats);
  }

  async updateProgress(auditId, stats = {}) {
    const db = await cds.connect.to('db');
    const code = StatusCodeUtil.toCode('PROCESSING');
    await db.run(
      UPDATE(ENTITY).set({
        STATUS_CODE: code,
        STATUS_MESSAGE: this._summaryMessage('PROCESSING', stats)
      }).where({ AUDIT_ID: auditId })
    );
  }

  async initializeRows(auditId, fileName, records) {
    const db = await cds.connect.to('db');
    const meta = this._meta(auditId, fileName);
    const code = StatusCodeUtil.toCode('PROCESSING');
    const now = DateUtil.nowTimestamp();

    await db.run(DELETE.from(ENTITY).where({ PROCESS_ID: meta.processId }));

    const entries = [
      this._entry({
        meta,
        rowAuditId: meta.auditId,
        objectName: 'FILE_SUMMARY',
        statusCode: code,
        statusMessage: this._summaryMessage('PROCESSING', {
          totalRows: records?.length || 0,
          validCount: 0,
          errorCount: 0
        }),
        endTime: null,
        createdTimestamp: now
      })
    ];

    (records || []).forEach((record, index) => {
      record._AUDIT_RECORD_ID = uuid();
      const rowNumber = record._ROW_NUMBER || index + 2;
      entries.push(this._entry({
        meta,
        rowAuditId: record._AUDIT_RECORD_ID,
        record,
        rowNumber,
        statusCode: code,
        statusMessage: this._detailMessage(record, {
          rowNumber,
          status: 'PROCESSING',
          resultCode: code,
          detail: 'Transaction record is being validated.'
        }),
        endTime: null,
        createdTimestamp: now
      }));
    });

    await this._writeChunks(db, INSERT, entries);
  }

  async finalizeRows(auditId, fileName, records, options = {}) {
    const db = await cds.connect.to('db');
    const meta = this._meta(auditId, fileName);
    const now = DateUtil.nowTimestamp();

    const validationFailed = StatusCodeUtil.toCode('VALIDATION_FAILED');
    const transactionSuccess = StatusCodeUtil.toCode('TRANSACTION_SUCCESS');
    const completed = StatusCodeUtil.toCode('COMPLETED');

    const invalidCount = (records || []).filter((record) => record.ROW_STATUS === 'INVALID').length;
    const validCount = (records || []).length - invalidCount;
    const summaryCode = options.fileRejected ? validationFailed : completed;

    const entries = [
      this._entry({
        meta,
        rowAuditId: meta.auditId,
        objectName: 'FILE_SUMMARY',
        statusCode: summaryCode,
        statusMessage: options.fileRejected
          ? `File rejected. total=${records.length}, row_errors=${invalidCount}, otherwise_valid_not_inserted=${validCount}.`
          : `File completed successfully. total=${records.length}, inserted=${records.length}, errors=0.`,
        endTime: now
      })
    ];

    (records || []).forEach((record, index) => {
      const rowNumber = record._ROW_NUMBER || index + 2;
      let status;
      let auditCode;
      let detail;

      if (options.fileRejected) {
        status = 'FAILED';
        if (record.ROW_STATUS === 'INVALID') {
          auditCode = this._singleCode(record.STATUS_CODE, validationFailed);
          detail = this._allErrorDetail(record) || 'Record failed validation.';
        } else {
          auditCode = validationFailed;
          detail = 'Row was valid but was not inserted because another row caused complete-file rejection.';
        }
      } else {
        // Successfully inserted transaction -> 041 TRANSACTION_SUCCESS.
        status = 'SUCCESS';
        auditCode = transactionSuccess;
        detail = 'TRANSACTION SUCCESS';
      }

      entries.push(this._entry({
        meta,
        rowAuditId: record._AUDIT_RECORD_ID || uuid(),
        record,
        rowNumber,
        statusCode: auditCode,
        statusMessage: options.fileRejected
          ? this._errorAuditMessage(rowNumber, detail)
          : detail,
        endTime: now
      }));
    });

    await this._writeChunks(db, UPSERT, entries);
  }

  async recordFileFailure(auditId, fileName, rawRows, error) {
    const db = await cds.connect.to('db');
    const meta = this._meta(auditId, fileName);
    const code = this._singleCode(error?.code, StatusCodeUtil.toCode('UNKNOWN_ERROR'));
    const detail = String(error?.message || StatusCodeUtil.toText(code));
    const now = DateUtil.nowTimestamp();
    const sourceRows = rawRows || [];

    await db.run(DELETE.from(ENTITY).where({ PROCESS_ID: meta.processId }));

    const entries = [
      this._entry({
        meta,
        rowAuditId: meta.auditId,
        objectName: 'FILE_SUMMARY',
        statusCode: code,
        statusMessage: `File failed. code=${StatusCodeUtil.toText(code)}, rows=${sourceRows.length}, detail=${detail}`,
        endTime: now
      })
    ];

    sourceRows.forEach((raw, index) => {
      const rowNumber = index + 2;
      entries.push(this._entry({
        meta,
        rowAuditId: uuid(),
        raw,
        rowNumber,
        statusCode: code,
        statusMessage: this._errorAuditMessage(rowNumber, detail),
        endTime: now
      }));
    });

    await this._writeChunks(db, INSERT, entries);
  }

  async complete(auditId, result = {}, changedBy, options = {}) {
    const db = await cds.connect.to('db');
    const failed = Number(result.errorCount || 0) > 0;
    const code = failed
      ? this._singleCode(options.errorCode, StatusCodeUtil.toCode('VALIDATION_FAILED'))
      : StatusCodeUtil.toCode('COMPLETED');
    await db.run(
      UPDATE(ENTITY).set({
        STATUS_CODE: code,
        STATUS_MESSAGE: String(options.errorDetail || StatusCodeUtil.toText(code)).slice(0, 500),
        END_TIME: DateUtil.nowTimestamp()
      }).where({ AUDIT_ID: auditId })
    );
  }

  async fail(auditId, error) {
    const db = await cds.connect.to('db');
    const code = this._singleCode(error?.code, StatusCodeUtil.toCode('UNKNOWN_ERROR'));
    await db.run(
      UPDATE(ENTITY).set({
        STATUS_CODE: code,
        STATUS_MESSAGE: String(error?.message || StatusCodeUtil.toText(code)).slice(0, 500),
        END_TIME: DateUtil.nowTimestamp()
      }).where({ AUDIT_ID: auditId })
    );
  }

  _entry({
    meta,
    rowAuditId,
    record = null,
    raw = null,
    rowNumber = 0,
    objectName = null,
    statusCode,
    statusMessage,
    endTime,
    createdTimestamp = null
  }) {
    const source = raw || record?._RAW_ROW || {};
    const mobiReference = String(source.mobi_reference_id ?? record?.MOBI_REFERENCE_ID ?? '').trim();
    const isSummary = objectName === 'FILE_SUMMARY';

    return {
      AUDIT_ID: rowAuditId,
      PROCESS_ID: meta.processId,
      PROCESS_NAME: 'TRANSACTION_INGESTION',
      PROCESS_TYPE: isSummary ? 'SFTP' : 'PORTAL TO BTP',
      OBJECT_ID: isSummary
        ? meta.fileName
        : String(mobiReference || `ROW_${rowNumber || 0}`).slice(0, 100),
      OBJECT_NAME: isSummary
        ? 'FILE_SUMMARY'
        : String(mobiReference || `ROW_${rowNumber || 0}`).slice(0, 100),
      STATUS_CODE: this._singleCode(statusCode, StatusCodeUtil.toCode('UNKNOWN_ERROR')),
      STATUS_MESSAGE: String(statusMessage || '').slice(0, 500),
      START_TIME: meta.startTime,
      END_TIME: endTime,
      CREATED_BY: meta.createdBy,
      CREATED_TIMESTAMP: createdTimestamp || meta.startTime
    };
  }

  _detailMessage(record, options = {}) {
    const source = options.raw || record?._RAW_ROW || {};
    const value = (rawName, recordName) =>
      String(source[rawName] ?? record?.[recordName] ?? '').replace(/[\r\n|]+/g, ' ').trim();

    return [
      `ROW_NO=${options.rowNumber || ''}`,
      `PAYMENT_TYPE=${value('payment_type', 'PAYMENT_TYPE')}`,
      `COMPANY_CODE=${value('sap_company_code', 'COMPANY_CODE')}`,
      `MOBI_PORTAL_CODE=${value('mobi_portal_code', 'MOBI_PORTAL_CODE')}`,
      `STATUS=${options.status || ''}`,
      `RESULT_CODE=${StatusCodeUtil.toText(this._singleCode(options.resultCode, '100'))}`,
      `DETAIL=${String(options.detail || '').replace(/[\r\n]+/g, ' ').trim()}`
    ].join(' | ').slice(0, 500);
  }

  _errorAuditMessage(rowNumber, detail) {
    const clean = String(detail || '')
      .replace(/\[\d+\]\s*\(\d{3}\)\s*/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim();
    return `E | ROW_NO=${rowNumber || ''} | ${clean}`.slice(0, 500);
  }

  _allErrorDetail(record) {
    // Same canonical detail used by the error text file -> audit and text file
    // always agree on a record's error description.
    return StatusCodeUtil.recordErrorDetail(record);
  }

  _singleCode(value, fallback) {
    const first = String(value || '').split(',').map((code) => code.trim()).find(Boolean);
    return StatusCodeUtil.normalizeCode(first, StatusCodeUtil.toText(fallback || '100')).slice(0, 3);
  }

  _summaryMessage(status, stats = {}) {
    return `${status}; total=${Number(stats.totalRows || 0)},` +
      `valid=${Number(stats.validCount || 0)}, errors=${Number(stats.errorCount || 0)}`;
  }

  _meta(auditId, fileName = '') {
    return this.metadata.get(String(auditId)) || {
      auditId: String(auditId),
      processId: String(auditId).slice(0, 50),
      fileName: String(fileName || '').slice(0, 100),
      createdBy: 'SYSTEM_SFTP',
      startTime: DateUtil.nowTimestamp()
    };
  }

  async _writeChunks(db, operation, entries) {
    for (let index = 0; index < entries.length; index += WRITE_CHUNK_SIZE) {
      await db.run(operation.into(ENTITY).entries(entries.slice(index, index + WRITE_CHUNK_SIZE)));
    }
  }
}

module.exports = AuditRepository;
