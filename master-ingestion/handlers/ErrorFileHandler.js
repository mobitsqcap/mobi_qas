const path = require('path');
const DateUtil = require('../utils/DateUtil');

/**
 * ErrorFileHandler - writes two artefacts into the ERROR folder:
 *   1. <originalname>_text.file - human-readable error summary with ALL errors
 *      per record (not just the first one).
 *   2. Moves/copies the offending source file to the ERROR folder so it is no
 *      longer processed.
 *
 * If a move fails (transient SFTP error) we still write the text file and
 * return the paths, so the audit log can always be updated.
 */
class ErrorFileHandler {
  constructor(sftpService) { this.sftpService = sftpService; }

  _resolveErrorDirectory(file, context = {}) {
    return context?.paths?.ERROR_PATH || file?.paths?.ERROR_PATH
        || (context.errorPath ? path.posix.dirname(context.errorPath) : null);
  }

  _resolveErrorFilePath(file, context = {}) {
    if (context?.errorPath) return context.errorPath;
    const dir = this._resolveErrorDirectory(file, context);
    return dir ? `${dir}/${file.name}` : null;
  }

  _resolveProcessingFilePath(file, context = {}) {
    if (context?.processingPath) return context.processingPath;
    const dir = context?.paths?.PROCESSING_PATH || file?.paths?.PROCESSING_PATH;
    return dir ? `${dir}/${file.name}` : null;
  }

  async handle(file, error, context = {}) {
    const target         = this._resolveErrorFilePath(file, context);
    const errorDirectory = this._resolveErrorDirectory(file, context);

    if (!target || !errorDirectory) {
      throw new Error(`ERROR path missing for file ${file.name}. Please check SFTP folder configuration.`);
    }

    // Move source to ERROR folder (best-effort)
    const candidates = [...new Set([file.path, this._resolveProcessingFilePath(file, context)].filter(Boolean))];
    let moveError = null;
    for (const src of candidates) {
      try {
        await this.sftpService.moveFile(src, target);
        file.path = target;
        moveError = null;
        break;
      } catch (e) {
        moveError = e;
      }
    }

    // Always write text error file even if the move failed
    const textBuf  = this._buildErrorTextFile(file, error, context, moveError);
    const textName = this._buildErrorTextFileName(file.name);
    const textPath = `${errorDirectory}/${textName}`;

    try {
      await this.sftpService.uploadFile(textPath, textBuf);
    } catch (uploadErr) {
      console.error('[ErrorFileHandler] Failed to upload error text file', uploadErr);
    }

    console.error(`[ErrorFileHandler] ${file.name} moved to error. Reason: ${error.message}`);
    return { errorPath: target, errorTextPath: textPath, moveError: moveError ? moveError.message : null };
  }

  _buildErrorTextFileName(originalName) {
    const dot = originalName.lastIndexOf('.');
    const base = dot >= 0 ? originalName.slice(0, dot) : originalName;
    return `${base}_text.file`;
  }

  _buildErrorTextFile(file, error, context, moveError = null) {
    const auditId = context?.auditId || context?.fileLog?.AUDIT_ID || '';

    const lines = [
      `FILE NAME       : ${file.name}`,
      `AUDIT ID        : ${auditId}`,
      `ERROR CODE      : ${error.code || 'FILE_PROCESSING_ERROR'}`,
      `ERROR DETAIL    : ${this._sanitize(error.message || '')}`,
      moveError
        ? `MOVE WARNING    : Source file could not be moved to ERROR folder (${this._sanitize(moveError.message)}); audit log has been updated.`
        : '',
      `GENERATED AT    : ${DateUtil.nowTimestamp()}`,
      '',
      'S.NO | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | ERROR_CODE | ERROR_DETAIL'
    ].filter(Boolean);

    // Normalise errorRows: either array of {rowNo, mobiReferenceId, errorCode, errorDetail}
    // or a single error summary.
    let rows = [];
    if (Array.isArray(error?.errorRows)) {
      rows = error.errorRows;
    } else {
      rows = [{
        rowNo:           error?.rowNumber || '',
        mobiReferenceId: error?.mobiReferenceId || '',
        errorCode:       error?.code || '',
        errorDetail:     error?.message || ''
      }];
    }

    rows.forEach((r, i) => {
      lines.push([
        i + 1,
        auditId,
        r.rowNo || '',
        r.mobiReferenceId || '',
        r.errorCode || error.code || '',
        this._sanitize(r.errorDetail || error.message || '')
      ].join(' | '));
    });

    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  _sanitize(v) { return String(v || '').replace(/[\r\n]+/g, ' ').trim(); }
}

module.exports = ErrorFileHandler;
