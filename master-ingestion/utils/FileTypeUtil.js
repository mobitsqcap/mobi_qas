const Constants = require('./Constants');

class FileTypeUtil {
  static classify(fileName) {
    if (Constants.FILES.MASTER_REGEX.test(fileName)) return 'MASTER';
    if (Constants.FILES.TRANSACTION_REGEX.test(fileName)) return 'TRANSACTION';
    return 'INVALID';
  }

  static expectedFormat(fileType) {
    if (fileType === 'MASTER')      return Constants.MASTER_EXPECTED_FORMAT;
    if (fileType === 'TRANSACTION') return Constants.TRANSACTION_EXPECTED_FORMAT;
    return `${Constants.MASTER_EXPECTED_FORMAT} / ${Constants.TRANSACTION_EXPECTED_FORMAT}`;
  }

  static extractDateNumber(fileName) {
    const match = String(fileName || '').match(/_(\d{8})\.csv$/i);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  static sortForProcessing(files) {
    const priority = { filein: 0, processing: 1 };
    return [...files].sort((a, b) => {
      const pa = priority[a.source] ?? 99;
      const pb = priority[b.source] ?? 99;
      if (pa !== pb) return pa - pb;
      const da = this.extractDateNumber(a.name);
      const db = this.extractDateNumber(b.name);
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
  }
}

module.exports = FileTypeUtil;
