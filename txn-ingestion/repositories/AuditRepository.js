'use strict';

const cds = require('@sap/cds');
const { INSERT, UPDATE, DELETE } = cds.ql;

const StatusCodeUtil = require('../utils/StatusCodeUtil');
const DateUtil = require('../utils/DateUtil');

const ENTITY = 'mobi.db.MOBI_DB_AUDIT';
const WRITE_CHUNK_SIZE = 500;
class AuditRepository {
  constructor() {
    this.lineItemCounters = new Map();
  }
  _nextAuditLineItem(auditId) {
    const key = String(auditId);
    const next = (this.lineItemCounters.get(key) || 0) + 1;
    this.lineItemCounters.set(key, next);
    return next;
  }
  async start({ auditId, runId, fileName, createdBy }) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    this.lineItemCounters.set(String(auditId), 0);
    const lineItemNo = this._nextAuditLineItem(auditId);

    await db.run(DELETE.from(ENTITY).where({ AUDIT_ID: auditId }));

    await db.run(INSERT.into(ENTITY).entries({
      AUDIT_ID: auditId,
      AUDIT_LINE_ITEM: lineItemNo,
      PROCESS_NAME: 'TRANSACTION_INGESTION',
      PROCESS_TYPE: 'FILE',
      MESSAGE_TYPE: 'I',
      STATUS_MESSAGE: `File ${fileName} received — processing started.`,
      CREATED_BY: String(createdBy || 'SYSTEM_SFTP').slice(0, 100),
      CREATED_TIMESTAMP: now
    }));
  }

  async markProcessing(auditId, stats = {}) {
    return this.updateProgress(auditId, stats);
  }

  async updateProgress(auditId, stats = {}) {
    const db = await cds.connect.to('db');
    await db.run(UPDATE(ENTITY).set({
      MESSAGE_TYPE: 'I',
      STATUS_MESSAGE: this._summaryMessage('PROCESSING', stats)
    }).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 }));
  }

  async initializeRows(auditId, fileName, records) {
    const db = await cds.connect.to('db');

    await db.run(DELETE.from(ENTITY).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: { '>': 1 } }));

    (records || []).forEach((record) => {
      if (!record._AUDIT_LINE_ITEM) {
        record._AUDIT_LINE_ITEM = this._nextAuditLineItem(auditId);
      }
    });
  }

  async finalizeRows(auditId, fileName, records, options = {}) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    const invalidCount = (records || []).filter((r) => r.ROW_STATUS === 'INVALID').length;
    const validCount = (records || []).length - invalidCount;

    const summaryMessageType = options.fileRejected ? 'W' : 'S';
    const summaryMessage = options.fileRejected
      ? `File ${fileName} rejected. total=${records.length}, errors=${invalidCount}, valid_not_inserted=${validCount}.`
      : `File ${fileName} completed successfully. total=${records.length}, inserted=${records.length}, errors=0.`;

    await db.run(UPDATE(ENTITY).set({
      MESSAGE_TYPE: summaryMessageType,
      STATUS_MESSAGE: summaryMessage.slice(0, 500)
    }).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 }));

    await db.run(DELETE.from(ENTITY).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: { '>': 1 } }));

    const entries = [];
    for (const record of (records || [])) {
      const lineItemNo = record._AUDIT_LINE_ITEM || this._nextAuditLineItem(auditId);

      let messageType;
      let messageText;

      if (options.fileRejected) {
        if (record.ROW_STATUS === 'INVALID') {
          messageType = 'E';
          messageText = StatusCodeUtil.recordErrorDetail(record) || 'Record failed validation.';
        } else {
          messageType = 'W';
          messageText = 'Row was valid but not inserted (another row caused file rejection).';
        }
      } else {
        messageType = 'S';
        messageText = 'Data Inserted Successfully';
      }

      entries.push({
        AUDIT_ID: auditId,
        AUDIT_LINE_ITEM: lineItemNo,
        PROCESS_NAME: 'TRANSACTION_INGESTION',
        PROCESS_TYPE: 'SFTP TO BTP',
        MESSAGE_TYPE: messageType,
        STATUS_MESSAGE: this._rowMessage(record, messageText, { rowNumber: record._ROW_NUMBER }),
        CREATED_BY: 'SYSTEM_SFTP',
        CREATED_TIMESTAMP: now
      });
    }

    await this._writeChunks(db, INSERT, entries);
  }

  async recordFileFailure(auditId, fileName, rawRows, error) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const detail = String(error?.message || 'File failed');
    const sourceRows = rawRows || [];

    await db.run(UPDATE(ENTITY).set({
      MESSAGE_TYPE: 'E',
      STATUS_MESSAGE: `File ${fileName} failed. rows=${sourceRows.length}, detail=${detail}`.slice(0, 500)
    }).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 }));

    const entries = sourceRows.map((raw, index) => {
      const lineItemNo = this._nextAuditLineItem(auditId);
      const rowNumber = raw?._ROW_NUMBER || index + 2;
      return {
        AUDIT_ID: auditId,
        AUDIT_LINE_ITEM: lineItemNo,
        PROCESS_NAME: 'TRANSACTION_INGESTION',
        PROCESS_TYPE: 'SFTP TO BTP',
        MESSAGE_TYPE: 'E',
        STATUS_MESSAGE: this._rowMessage(raw, detail, { rowNumber }),
        CREATED_BY: 'SYSTEM_SFTP',
        CREATED_TIMESTAMP: now
      };
    });

    await this._writeChunks(db, INSERT, entries);
  }

  async complete(auditId, result = {}, changedBy, options = {}) {
    const db = await cds.connect.to('db');
    const failed = Number(result.errorCount || 0) > 0;
    const messageType = failed ? 'E' : 'S';
    const message = String(options.errorDetail || (failed ? 'File completed with errors' : 'File completed successfully')).slice(0, 500);
    await db.run(UPDATE(ENTITY).set({
      MESSAGE_TYPE: messageType,
      STATUS_MESSAGE: message
    }).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 }));
  }

  async fail(auditId, error) {
    const db = await cds.connect.to('db');
    const message = String(error?.message || 'File failed').slice(0, 500);
    await db.run(UPDATE(ENTITY).set({
      MESSAGE_TYPE: 'E',
      STATUS_MESSAGE: message
    }).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 }));
  }

  _summaryMessage(status, stats = {}) {
    return `${status}; total=${Number(stats.totalRows || 0)}, valid=${Number(stats.validCount || 0)}, errors=${Number(stats.errorCount || 0)}`.slice(0, 500);
  }

  _mobiRef(record) {
    const raw = record?._RAW_ROW || {};
    const value = record?.MOBI_REFERENCE_ID ?? raw.mobi_reference_id ?? raw.MOBI_REFERENCE_ID ?? '';
    return String(value).replace(/[\r\n|]+/g, ' ').trim();
  }
  _rowMessage(record, messageText, options = {}) {
    const rowNumber = options.rowNumber ?? record?._ROW_NUMBER ?? '';
    const ref = this._mobiRef(record);
    const refPart = ref ? `Mobi Ref ID: ${ref}` : 'Mobi Ref ID: N/A';
    const text = String(messageText ?? '').replace(/[\r\n]+/g, ' ').trim();
    return `Row ${rowNumber} | ${refPart} | ${text}`.slice(0, 500);
  }

  async _writeChunks(db, operation, entries) {
    for (let i = 0; i < entries.length; i += WRITE_CHUNK_SIZE) {
      await db.run(operation.into(ENTITY).entries(entries.slice(i, i + WRITE_CHUNK_SIZE)));
    }
  }
}

module.exports = AuditRepository;
