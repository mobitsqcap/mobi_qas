/**
 * FileIntegrityService – coordinates all pre-ingest checks and returns a
 * single structured result:
 *   { accepted: boolean, errorCode?, reason?, encoding?, buffer?, sizeBytes? }
 *
 * Use this from ingestion handlers instead of duplicating checks. Wraps:
 *   - FileGuard (name/size/extension/partial upload/empty/header-only)
 *   - HashDuplicateService (duplicate content)
 *   - BOM/encoding validation
 *   - SFTP resilience for download (with retry/circuit-breaker)
 */
const FileGuard = require('./FileGuard');
const { getHashService } = require('./HashDuplicateService');
const { SftpResilience } = require('./SftpResilience');
const Logger = require('../logging/SecureLogger');
const log = new Logger('FileIntegrity');

class FileIntegrityService {
  constructor(sftpService, { namingRegex, category } = {}) {
    this.sftp = sftpService;
    this.resilient = new SftpResilience(sftpService);
    this.guard = new FileGuard(sftpService);
    this.namingRegex = namingRegex;
    this.category = category || 'TRANSACTION';
    this.hashSvc = getHashService();
  }

  async validate(file, { correlationId } = {}) {
    // 1. Pre-download checks: name, extension, size stability, partial suffix
    const pre = await this.guard.validatePreDownload(file, this.namingRegex);
    if (!pre.ok) {
      log.warn(`[${this.category}] rejected (pre-download): ${pre.reason}`, { correlationId, file: file.name });
      return { accepted:false, errorCode: pre.errorCode || '06', reason: pre.reason };
    }
    file.sizeBytes = pre.sizeBytes;

    // 2. Download with SFTP retry/circuit-breaker
    let buffer;
    try {
      buffer = await this.resilient.run(`download ${file.path}`,
        () => this.sftp.downloadFile(file.path));
    } catch (err) {
      log.error(`[${this.category}] download failed: ${err.message}`, { correlationId, file: file.name });
      return { accepted:false, errorCode:'09', reason:`Download failed: ${err.message}` };
    }

    // 3. Duplicate hash
    const hash = this.hashSvc.sha256(buffer);
    file.fileHash = hash;
    const dup = await this.hashSvc.isDuplicate(hash);
    if (dup.duplicate) {
      log.warn(`[${this.category}] duplicate content: ${dup.reason}`, { correlationId, file: file.name });
      return { accepted:false, errorCode:'07', reason: dup.reason };
    }

    // 4. Buffer validation (encoding, BOM, empty, header-only)
    const bufCheck = this.guard.validateBuffer(buffer, file.name);
    if (!bufCheck.ok) {
      log.warn(`[${this.category}] buffer invalid: ${bufCheck.reason}`, { correlationId, file: file.name });
      return { accepted:false, errorCode:'09', reason: bufCheck.reason };
    }

    this.hashSvc.beginProcessing(hash);
    return {
      accepted:true,
      buffer: bufCheck.cleanedBuffer,
      encoding: bufCheck.encoding,
      sizeBytes: buffer.length,
      hash,
      release: () => this.hashSvc.endProcessing(hash)
    };
  }
}

module.exports = FileIntegrityService;
