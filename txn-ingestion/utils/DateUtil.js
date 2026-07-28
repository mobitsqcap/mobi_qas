class DateUtil {
  static nowTimestamp() { return new Date().toISOString(); }

  static nowHCMSS() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  }

  static extractDate8(fileName) {
    const match = String(fileName || '').match(/_(\d{8})(?:_(?:ERRORS|Updated))?\.csv$/i);
    return match ? match[1] : null;
  }

  static parseCsvDate(value, { required = false } = {}) {
    if (!value || !String(value).trim()) {
      return required
        ? { iso: null, formatted: null, error: 'MISSING_DATE' }
        : { iso: null, formatted: null, error: null };
    }

    const raw = String(value).trim();
    const parsed = this._tryParseFormats(raw);
    if (!parsed) return { iso: null, formatted: null, error: `INVALID_DATE_FORMAT: ${raw}` };

    const { day, month, year } = parsed;
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return { iso: null, formatted: null, error: `INVALID_DATE_VALUES: ${raw}` };
    }

    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
      return { iso: null, formatted: null, error: `INVALID_DATE_VALUES: ${raw}` };
    }

    const formatted = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
    return { iso, formatted, error: null };
  }

  static _tryParseFormats(raw) {
    let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return { day: +m[3], month: +m[2], year: +m[1] };

    m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) {
      const first = +m[1], second = +m[2], year = +m[3];
      if (first > 12) return { day: first, month: second, year };
      if (second > 12) return { day: second, month: first, year };
      return { day: first, month: second, year };
    }

    m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
    if (m) {
      const first = +m[1], second = +m[2], year = 2000 + +m[3];
      if (first > 12) return { day: first, month: second, year };
      if (second > 12) return { day: second, month: first, year };
      return { day: first, month: second, year };
    }

    return null;
  }

  static parseCsvTime(value) {
    if (!value || !String(value).trim()) return null;
    const parts = String(value).trim().split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    const [h, m, s = '00'] = parts;
    if (![h, m, s].every((p) => /^\d{1,2}$/.test(p))) return null;
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
  }

  static dbDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s;
  }
}

module.exports = DateUtil;
