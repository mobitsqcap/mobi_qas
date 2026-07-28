/**
 * SecureLogger – wraps console with correlation-id support, secret masking,
 * and structured leveled logging suitable for BTP Application Logs / Kibana.
 */
const crypto = require('crypto');
const DEFAULTS = require('../config/productionDefaults').logging;

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let currentLevel = LEVELS[(process.env.LOG_LEVEL || DEFAULTS.logLevel).toLowerCase()] ?? LEVELS.info;

function mask(value) {
  if (!value || typeof value !== 'string') return value;
  for (const field of DEFAULTS.maskFields) {
    const re = new RegExp(`("?${field}"?\\s*[:=]\\s*")([^"]{0,120})(")`, 'gi');
    value = value.replace(re, (_, p1, p2, p3) => `${p1}${'*'.repeat(Math.min(p2.length, 8))}${p3}`);
  }
  return value;
}

function makeCorrelationId(req) {
  if (req?.headers?.[DEFAULTS.correlationIdHeader]) return req.headers[DEFAULTS.correlationIdHeader];
  if (req?.headers?.['x-request-id']) return req.headers['x-request-id'];
  return crypto.randomUUID();
}

class SecureLogger {
  constructor(moduleName) { this.module = moduleName; }
  _log(level, message, meta = {}) {
    if (LEVELS[level] > currentLevel) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      module: this.module,
      correlationId: meta.correlationId || 'none',
      message: mask(String(message)),
      ...meta
    };
    delete entry.correlationId;
    const line = mask(JSON.stringify(entry));
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
  error(m, meta) { this._log('error', m, meta); }
  warn(m, meta)  { this._log('warn', m, meta); }
  info(m, meta)  { this._log('info', m, meta); }
  debug(m, meta) { this._log('debug', m, meta); }
  child(moduleName) { return new SecureLogger(moduleName); }

  static setLevel(level) {
    const l = (level || '').toLowerCase();
    if (LEVELS[l] !== undefined) currentLevel = LEVELS[l];
  }
  static middleware() {
    return (req, res, next) => {
      req.correlationId = makeCorrelationId(req);
      const started = Date.now();
      res.setHeader(DEFAULTS.correlationIdHeader, req.correlationId);
      res.on('finish', () => {
        const logger = new SecureLogger('http');
        logger.info(`${req.method} ${req.url} ${res.statusCode}`, {
          correlationId: req.correlationId,
          method: req.method,
          url: mask(req.url),
          status: res.statusCode,
          durationMs: Date.now() - started
        });
      });
      next();
    };
  }
}

module.exports = SecureLogger;
module.exports.makeCorrelationId = makeCorrelationId;
