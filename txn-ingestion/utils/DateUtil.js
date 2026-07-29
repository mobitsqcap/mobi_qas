// /**
//  * Date utility for Transaction Ingestion.
//  * Ensures ISO 8601 compliance. NULL never returned for timestamps - always ''.
//  */
// class DateUtil {
//   static nowTimestamp() {
//     return new Date().toISOString();
//   }

//   static nowHCMSS() {
//     const d = new Date();
//     const pad = (n) => String(n).padStart(2, '0');
//     return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
//   }

//   static extractDate8(fileName) {
//     const match = String(fileName || '').match(/_(\\d{8})(?:_ERRORS)?\\.csv$/i);
//     return match ? match[1] : '';
//   }

//   static parseCsvDate(value, { required = false } = {}) {
//     if (!value || !String(value).trim()) {
//       if (required) return { iso: '', error: 'MISSING_DATE' };
//       return { iso: '', error: '' };
//     }
//     const raw = String(value).trim();
//     const parts = raw.split('/');
//     if (parts.length !== 3) {
//       return { iso: '', error: `INVALID_DATE_FORMAT: ${raw}` };
//     }
//     const [day, month, year] = parts;
//     if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) {
//       return { iso: '', error: `INVALID_DATE_FORMAT: ${raw}` };
//     }
//     const dd = Number(day);
//     const mm = Number(month);
//     if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
//       return { iso: '', error: `INVALID_DATE_VALUES: ${raw}` };
//     }
//     const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
//     const date = new Date(`${iso}T00:00:00Z`);
//     if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
//       return { iso: '', error: `INVALID_DATE_VALUES: ${raw}` };
//     }
//     return { iso, error: '' };
//   }

//   static parseCsvTime(value) {
//     if (!value || !String(value).trim()) return '';
//     const parts = String(value).trim().split(':');
//     if (parts.length < 2 || parts.length > 3) return '';
//     const [hours, minutes, seconds = '00'] = parts;
//     if (![hours, minutes, seconds].every((part) => /^\d{1,2}$/.test(part))) return '';
//     return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
//   }
// }
// module.exports = DateUtil;
class DateUtil {

  /**
   * Parse CSV date from various formats.
   * Supported input formats:
   *   DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
   *   YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
   *   DD-MM-YY, DD/MM/YY, DD.MM.YY
   *   MM-DD-YYYY, MM/DD/YYYY, MM.DD.YYYY (US format)
   * Returns object with: { iso: 'YYYY-MM-DD', formatted: 'DD.MM.YYYY', error: null }
   */
  static parseCsvDate(value, { required = false } = {}) {

    if (!value || !String(value).trim()) {
      return required
        ? { iso: null, formatted: null, error: 'MISSING_DATE' }
        : { iso: null, formatted: null, error: null };
    }

    const raw = String(value).trim();

    // Try parsing with different formats
    const parsed = this._tryParseFormats(raw);
    if (!parsed) {
      return { iso: null, formatted: null, error: `INVALID_DATE_FORMAT: ${raw}` };
    }

    const { day, month, year } = parsed;

    // Validate day/month ranges
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return { iso: null, formatted: null, error: `INVALID_DATE_VALUES: ${raw}` };
    }

    // Validate actual date (e.g., Feb 30)
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
      return { iso: null, formatted: null, error: `INVALID_DATE_VALUES: ${raw}` };
    }

    // Return both ISO (for database) and DD.MM.YYYY (for display/storage)
    const formatted = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;

    return { iso, formatted, error: null };
  }

  static _tryParseFormats(raw) {
    // Format: YYYY-MM-DD | YYYY/MM/DD | YYYY.MM.DD (check first - unambiguous)
    let match = raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (match) return { day: +match[3], month: +match[2], year: +match[1] };

    // Format: DD-MM-YYYY | DD/MM/YYYY | DD.MM.YYYY
    // Format: MM-DD-YYYY | MM/DD/YYYY | MM.DD.YYYY (US)
    // Both match the same regex, need to disambiguate
    match = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (match) {
      const first = +match[1];
      const second = +match[2];
      const year = +match[3];

      // If first > 12, it must be DD-MM-YYYY (day > 12)
      if (first > 12) {
        return { day: first, month: second, year };
      }
      // If second > 12, it must be MM-DD-YYYY (day > 12)
      if (second > 12) {
        return { day: second, month: first, year };
      }
      // Ambiguous (both <= 12) - default to DD-MM-YYYY (European standard)
      return { day: first, month: second, year };
    }

    // Format: DD-MM-YY | DD/MM/YY | DD.MM.YY (assume 20xx)
    match = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})$/);
    if (match) {
      const first = +match[1];
      const second = +match[2];
      const year = 2000 + +match[3];

      // Same disambiguation logic
      if (first > 12) {
        return { day: first, month: second, year };
      }
      if (second > 12) {
        return { day: second, month: first, year };
      }
      return { day: first, month: second, year };
    }

    return null;
  }

  static parseCsvTime(value) {
    if (!value || !String(value).trim()) return null;

    const parts = String(value).trim().split(':');
    if (parts.length < 2 || parts.length > 3) return null;

    const [hours, minutes, seconds = '00'] = parts;
    if (![hours, minutes, seconds].every((part) => /^\d{1,2}$/.test(part))) return null;

    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
  }

  static nowTimestamp() {
    return new Date();
  }

  static nowHCMSS() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  }

  static extractDate8(fileName) {
    const match = String(fileName || '').match(/_(\d{8})(?:_ERRORS)?\.csv$/i);
    return match ? match[1] : null;
  }

  /**
   * Format a Date object or ISO string as DD.MM.YYYY
   */
  static formatDDMMYYYY(dateInput) {
    if (!dateInput) return null;
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return null;
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }
}

module.exports = DateUtil;