/**
 * FileGuard – pre-ingest production validation for files in FILE_IN:
 *  - File-name safety (no path traversal, no control chars, length)
 *  - Allowed extension (.csv)
 *  - Naming pattern (delegated to caller via regex)
 *  - Size limit
 *  - Size stability (defends against partial uploads)
 *  - Empty file / header-only file detection (after streaming a preview)
 *  - Encoding detection: BOM handling + UTF-8 validation + Latin-1 fallback
 *  - Partial-suffix detection (.part/.tmp/.inprogress)
 *
 * Return type: { ok: boolean, reason?: string, errorCode?: string, filePath?: string, sizeBytes?: number }
 */
const DEFAULTS = require('../config/productionDefaults').file;

class FileGuard {
  constructor(sftpService, options = {}) {
    this.sftp = sftpService;
    this.opts = { ...DEFAULTS, ...options };
  }

  isPartialUploadName(fileName) {
    const lower = String(fileName || '').toLowerCase();
    return this.opts.partialSuffixes.some((suf) => lower.endsWith(suf));
  }

  isSafeFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return false;
    if (fileName.length > 120) return false;
    // No directory separators or control chars
    if (/[\/\\\x00-\x1F<>:;"'|?*]/.test(fileName)) return false;
    return this.opts.safeNameRegex.test(fileName);
  }

  hasAllowedExtension(fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot < 0) return false;
    const ext = fileName.slice(dot + 1).toLowerCase();
    return this.opts.allowedExtensions.includes(ext);
  }

  matchesNamingPattern(fileName, regex) {
    return regex && regex.test(fileName);
  }

  async isSizeStable(remotePath, attempts = this.opts.sizeStableChecks, intervalMs = this.opts.sizeStableIntervalMs) {
    let last = -1;
    for (let i = 0; i < attempts; i++) {
      const entries = await this.sftp.listFiles(pathDir(remotePath));
      const base = pathBase(remotePath);
      const entry = entries.find((e) => e.name === base);
      if (!entry) return { stable: false, reason: `File disappeared during stability check: ${remotePath}` };
      if (entry.sizeBytes === last) return { stable: true, sizeBytes: entry.sizeBytes };
      last = entry.sizeBytes;
      if (i < attempts - 1) await sleep(intervalMs);
    }
    return { stable: false, reason: `File size is not stable after ${attempts} polls; upload may still be in progress.` };
  }

  async validatePreDownload(file, namingRegex) {
    const name = file.name;

    if (this.isPartialUploadName(name)) {
      return fail('09', `File appears to be still uploading (ends with a partial suffix). Expected rename to final filename after upload completes. File: "${name}"`);
    }
    if (!this.isSafeFileName(name)) {
      return fail('09', `Unsafe file name "${name}". Names must contain only letters, digits, underscore, hyphen and a single extension.`);
    }
    if (!this.hasAllowedExtension(name)) {
      return fail('09', `Unsupported file extension on "${name}". Allowed: ${this.opts.allowedExtensions.join(', ')}.`);
    }
    if (namingRegex && !this.matchesNamingPattern(name, namingRegex)) {
      return fail('06', `File name does not match the expected pattern. Received: "${name}". Please rename to the correct format (see documentation).`);
    }
    if (file.sizeBytes != null && file.sizeBytes > this.opts.maxSizeBytes) {
      return fail('09', `File "${name}" exceeds maximum allowed size (${Math.round(this.opts.maxSizeBytes/1024/1024)} MB). Received ${Math.round(file.sizeBytes/1024/1024)} MB.`);
    }
    // Size stability
    const stable = await this.isSizeStable(file.path);
    if (!stable.stable) return fail('10', stable.reason);
    return ok({ sizeBytes: stable.sizeBytes });
  }

  /**
   * Validate a downloaded buffer: BOM handling, UTF-8 validity, empty/header-only, size.
   * Returns { ok, encoding, cleanedBuffer, reason }
   */
  validateBuffer(buffer, fileName) {
    if (!buffer || buffer.length === 0) {
      return { ok:false, reason:'File is empty (0 bytes). Expected at least a header row.' };
    }
    if (buffer.length > this.opts.maxSizeBytes) {
      return { ok:false, reason:`File exceeds ${Math.round(this.opts.maxSizeBytes/1024/1024)} MB limit.` };
    }
    // Strip UTF-8 BOM
    let buf = buffer;
    let encoding = 'utf-8';
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      buf = buf.slice(3);
    } else if (buf[0] === 0xFF && buf[1] === 0xFE) {
      // UTF-16 LE – transcoding not supported here; reject with clear message
      return { ok:false, reason:'UTF-16 encoding detected. Please convert the file to UTF-8 before uploading.' };
    }
    // UTF-8 validity check
    if (!isValidUtf8(buf)) {
      // Fall back to Latin-1: re-decode by treating as binary
      encoding = 'latin1';
    }
    // Quick empty/header-only detection by counting newlines
    const text = buf.toString(encoding);
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return { ok:false, reason:'File is empty (no content).' };
    if (this.opts.rejectHeaderOnlyFiles && lines.length === 1) {
      return { ok:false, reason:'File contains only a header row and no data.' };
    }
    return { ok:true, encoding, cleanedBuffer: buf };
  }
}

function pathDir(p) { return p.slice(0, p.lastIndexOf('/')) || '/'; }
function pathBase(p) { return p.slice(p.lastIndexOf('/')+1); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function ok(extra) { return Object.assign({ ok:true }, extra); }
function fail(code, reason) { return { ok:false, errorCode: code, reason }; }

function isValidUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    if (buf[i] < 0x80) { i++; continue; }
    let len, codep;
    if ((buf[i] & 0xE0) === 0xC0) { len=2; codep=buf[i]&0x1F; }
    else if ((buf[i] & 0xF0) === 0xE0) { len=3; codep=buf[i]&0x0F; }
    else if ((buf[i] & 0xF8) === 0xF0) { len=4; codep=buf[i]&0x07; }
    else return false;
    if (i+len > buf.length) return false;
    for (let j=1;j<len;j++) {
      if ((buf[i+j]&0xC0) !== 0x80) return false;
      codep = (codep<<6) | (buf[i+j]&0x3F);
    }
    if (codep < 0x80 || (codep>=0xD800 && codep<=0xDFFF) || codep>0x10FFFF) return false;
    i += len;
  }
  return true;
}

module.exports = FileGuard;
module.exports.isValidUtf8 = isValidUtf8;
