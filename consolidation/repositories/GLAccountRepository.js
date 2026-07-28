const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const EntityNames = require('../constants/EntityNames');
const NormalizeUtil = require('../utils/NormalizeUtil');

const GL_FLAG_FIELDS = Object.freeze([
  'TXN_AMOUNT','HOST_MDR_AMOUNT','HOST_FEE_PAYABLE','MOBI_MDR_AMOUNT','MDR_REVENUE'
]);
const ACTIVE_STATUSES = new Set(['A','ACTIVE','01']);   // accept both legacy 'A' and code '01'

class GLAccountLookup {
  constructor(rows) {
    this.map = new Map();
    this.conflicts = new Map();
    this.rows = rows || [];
    this._build();
  }
  resolve(record, flagField, scenario) {
    for (const key of this._candidateKeys(record, flagField, scenario)) {
      if (this.conflicts.has(key)) return null;
      const gl = this.map.get(key);
      if (gl) return gl;
    }
    return null;
  }
  buildMissingDetail(record, flagField, scenario) {
    for (const key of this._candidateKeys(record, flagField, scenario)) {
      const c = this.conflicts.get(key);
      if (c) {
        return [
          'Duplicate active GL account mapping found',
          `scenario=${scenario.code}`,
          `company=${NormalizeUtil.text(record.COMPANY_CODE)}`,
          `paymentType=${NormalizeUtil.text(record.PAYMENT_TYPE)}`,
          `paymentSubType=${NormalizeUtil.text(record.PAYMENT_SUB_TYPE)}`,
          `host=${NormalizeUtil.text(record.HOST_NAME)}`,
          `field=${NormalizeUtil.upper(flagField)}`,
          `activeGLAccounts=${[...c].join('/')}`
        ].join(', ');
      }
    }
    return [
      'Active GL account missing. Status must be A/01 (ACTIVE).',
      `scenario=${scenario.code}`,
      `company=${NormalizeUtil.text(record.COMPANY_CODE)}`,
      `paymentType=${NormalizeUtil.text(record.PAYMENT_TYPE)}`,
      `paymentSubType=${NormalizeUtil.text(record.PAYMENT_SUB_TYPE)}`,
      `host=${NormalizeUtil.text(record.HOST_NAME)}`,
      `field=${NormalizeUtil.upper(flagField)}`
    ].join(', ');
  }
  _build() {
    for (const row of this.rows) {
      const glAccount = NormalizeUtil.text(row.GL_Accounts);
      if (!glAccount) continue;
      const status = NormalizeUtil.upper(row.Status ?? row.STATUS);
      if (!ACTIVE_STATUSES.has(status)) continue;
      const company = NormalizeUtil.text(row.COMPANY_CODE);
      const paymentTypeCode = NormalizeUtil.paymentCode(row.PAYMENT_TYPE);
      const paymentSubTypeCode = NormalizeUtil.paymentCode(row.PAYMENT_SUB_TYPE);
      const host = NormalizeUtil.host(row.HOST_NAME);
      for (const field of GL_FLAG_FIELDS) {
        if (NormalizeUtil.upper(row[field]) === 'X') {
          this._addMapping(this._key(company, paymentTypeCode, paymentSubTypeCode, host, field), glAccount);
        }
      }
    }
  }
  _addMapping(key, glAccount) {
    const existing = this.map.get(key);
    if (!existing) { this.map.set(key, glAccount); return; }
    if (existing === glAccount) return;
    const cs = this.conflicts.get(key) || new Set([existing]);
    cs.add(glAccount); this.conflicts.set(key, cs); this.map.delete(key);
  }
  _candidateKeys(record, flagField, scenario) {
    const company = NormalizeUtil.text(record.COMPANY_CODE);
    const host = NormalizeUtil.host(record.HOST_NAME);
    const field = NormalizeUtil.upper(flagField);
    const ptCodes = this._candidateCodes(record.PAYMENT_TYPE, scenario.paymentTypeAliases);
    const pstCodes = this._candidateCodes(record.PAYMENT_SUB_TYPE,
      scenario.glPaymentSubTypeAliases || scenario.paymentSubTypeAliases);
    const keys = [];
    for (const pt of ptCodes) for (const pst of pstCodes) keys.push(this._key(company, pt, pst, host, field));
    return keys;
  }
  _candidateCodes(primary, aliases=[]) {
    const values = [primary, ...(aliases||[])]
      .map((v) => NormalizeUtil.paymentCode(v)).filter((c) => c > 0);
    return [...new Set(values)];
  }
  _key(company, pt, pst, host, field) {
    return [company, pt, pst, host, NormalizeUtil.upper(field)].join('|');
  }
}

class GLAccountRepository {
  async loadLookup(records) {
    const companyCodes = [...new Set((records||[])
      .map((r) => NormalizeUtil.text(r.COMPANY_CODE)).filter(Boolean))];
    if (!companyCodes.length) return new GLAccountLookup([]);
    const db = await cds.connect.to('db');
    const rows = await db.run(SELECT.from(EntityNames.GL_ACCOUNTS).where({ COMPANY_CODE:{in:companyCodes} }));
    return new GLAccountLookup(rows || []);
  }
}
module.exports = GLAccountRepository;
