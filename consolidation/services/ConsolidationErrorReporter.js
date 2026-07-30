'use strict';

const path = require('path');

const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * Requirement #5 (+ point 2 revision).
 *
 * When consolidation cannot process a transaction because of a recoverable GL
 * or business-partner gap, write a human-readable TEXT report (same layout as
 * the ingestion _text.file) into the shared SFTP error folder.
 *
 * File name: Transactions_YYYYMMDD_Consolidation.file
 *   - YYYYMMDD is the consolidation run's posting date (fallback: today).
 *   - Folder: Transaction_Data/ERROR (Constants.SFTP.CONSOL_ERROR_PATH).
 *   - Overwritten on every run that still has errors (point 5).
 */
class ConsolidationErrorReporter {
  constructor(sftpService) {
    this.sftpService = sftpService;
  }

  async writeErrorReport({ postingDate, scenarioCode, errorRecords, changedBy, runId }) {
    const records = (errorRecords || []).filter(Boolean);
    if (!records.length) return null;

    const date8 = DateUtil.date8(postingDate);
    const fileName = `Transactions_${date8}_Consolidation.file`;
    const remotePath = path.posix.join(Constants.SFTP.CONSOL_ERROR_PATH, fileName);

    const buffer = this._buildTextFile({
      fileName, auditId: runId || scenarioCode || 'CONSOLIDATION',
      scenarioCode, postingDate: date8, records
    });

    await this.sftpService.uploadFile(remotePath, buffer);

    return {
      remotePath,
      fileName,
      date8,
      scenarioCode,
      recordsWritten: records.length
    };
  }

  /**
   * Point 5: when a consolidation run comes back clean (all GL/BP fixed), freeze
   * the previous error report by renaming
   *   Transactions_YYYYMMDD_Consolidation.file
   * to
   *   Transactions_YYYYMMDD_HHMMSS.csv
   * (content kept). Returns { renamedFrom, fileName } when a rename happened,
   * or null when there was no previous report to rename.
   */
  async resolveErrorReport({ postingDate }) {
    const date8 = DateUtil.date8(postingDate);
    const hhmmss = DateUtil.nowHHMMSS();
    const fromPath = path.posix.join(Constants.SFTP.CONSOL_ERROR_PATH, `Transactions_${date8}_Consolidation.file`);
    const toPath = path.posix.join(Constants.SFTP.CONSOL_ERROR_PATH, `Transactions_${date8}_${hhmmss}.csv`);
    const renamed = await this.sftpService.renameFile(fromPath, toPath);
    return renamed ? { renamedFrom: fromPath, fileName: path.posix.basename(toPath) } : null;
  }

  _buildTextFile({ fileName, auditId, scenarioCode, postingDate, records }) {
    const sanitize = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const generatedAt = new Date().toISOString();

    const codeTexts = [...new Set(
      records
        .map((entry) => StatusCodeUtil.toText(entry.statusCode))
        .filter(Boolean)
    )];

    const lines = [
      `FILE NAME       : ${fileName}`,
      `AUDIT ID        : ${auditId}`,
      `ERROR CODE      : ${codeTexts.join(',') || 'CONSOLIDATION_FAILED'}`,
      `ERROR DETAIL    : ${records.length} record(s) blocked during ${scenarioCode || 'CONSOLIDATION'} consolidation (posting date ${postingDate}) due to missing GL account / business-partner configuration.`,
      `GENERATED AT    : ${generatedAt}`,
      '',
      'This file contains the consolidation records that failed validation.',
      '',
      'Only invalid records are listed below in a human-readable format.',
      '',
      'S.NO | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | PAYMENT_TYPE | COMPANY_CODE | MOBI_PORTAL_CODE | ERROR_CODE | ERROR_DETAIL'
    ];

    records.forEach((entry, index) => {
      const record = entry.record || {};
      lines.push([
        index + 1,
        auditId,
        '',
        NormalizeUtil.text(record.MOBI_REFERENCE_ID),
        NormalizeUtil.text(record.PAYMENT_TYPE),
        NormalizeUtil.text(record.COMPANY_CODE),
        NormalizeUtil.text(record.MOBI_PORTAL_CODE),
        StatusCodeUtil.toText(entry.statusCode),
        sanitize(entry.message)
      ].join(' | '));
    });

    return Buffer.from(lines.join('\n'), 'utf8');
  }
}

module.exports = ConsolidationErrorReporter;
