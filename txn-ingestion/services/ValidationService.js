const Constants = require('../utils/Constants');
const key = (...values) => values.map((value) => String(value || '').trim().toUpperCase()).join('|');
const isHost = (master) => String(master.TYPE || '').trim().toUpperCase() === 'HOST';

class ValidationService {
  constructor({ technicalValidator, businessValidator, currencyValidator, amountValidator, masterRepository, duplicateValidator }) {
    Object.assign(this, { technicalValidator, businessValidator, currencyValidator, amountValidator, masterRepository, duplicateValidator });
  }

  async validateBatch(records, duplicateContext = { mobiReferencesSeen: new Set(), hostReferencesSeen: new Set(), masterData: null }) {
    // Load once per file; the shared duplicateContext is passed by BatchProcessingService.
    if (!duplicateContext.masterData) duplicateContext.masterData = await this.masterRepository.findActiveForValidation();
    const allMasters = duplicateContext.masterData;
    const portalCodes = new Set(allMasters.map((master) => key(master.MOBI_PORTAL_CODE)));
    const portalCompanyKeys = new Set(allMasters.map((master) => key(master.MOBI_PORTAL_CODE, master.SAP_COMPANY_CODE)));
    const merchantMap = new Map();
    const hostKeys = new Set();

    for (const master of allMasters) {
      const masterKey = key(master.MOBI_PORTAL_CODE, master.SAP_COMPANY_CODE, master.ID);
      if (isHost(master)) hostKeys.add(masterKey);
      else merchantMap.set(masterKey, master);
    }

    const { mobiReferencesSeen, hostReferencesSeen } = duplicateContext;
    const validated = [];
    for (const record of records) {
      const mobiRef = String(record.MOBI_REFERENCE_ID || '').trim();
      if (mobiRef && mobiReferencesSeen.has(mobiRef)) {
        validated.push(this._markInvalid(record, { code: 'DUPLICATE_MOBI_REFERENCE_ID', message: `Duplicate MOBI reference ID in file: ${mobiRef}` }));
        continue;
      }
      if (mobiRef) mobiReferencesSeen.add(mobiRef);

      const hostRef = String(record.HOST_REFERENCE_ID || '').trim();
      const hostDayKeys = [record.TXN_CREATED_DATE, record.TXN_PAID_DATE].filter(Boolean).map((day) => key(hostRef, day));
      if (hostRef && hostDayKeys.some((hostDayKey) => hostReferencesSeen.has(hostDayKey))) {
        validated.push(this._markInvalid(record, { code: 'DUPLICATE_HOST_REFERENCE_ID', message: `Duplicate host reference ID on the same transaction day: ${hostRef}` }));
        continue;
      }
      hostDayKeys.forEach((hostDayKey) => hostReferencesSeen.add(hostDayKey));
      validated.push(await this._validateOne(record, { portalCodes, portalCompanyKeys, merchantMap, hostKeys }));
    }
    return validated;
  }

  async _validateOne(record, master) {
    for (const validator of [this.technicalValidator, this.businessValidator, this.currencyValidator, this.amountValidator, this.duplicateValidator]) {
      if (!validator) continue;
      const result = await validator.validate(record);
      if (!result.valid) return this._markInvalid(record, result);
    }

    const portalKey = key(record.MOBI_PORTAL_CODE);
    const portalCompanyKey = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE);
    const merchantKey = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE, record.MERCHANT_ID);
    const hostKey = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE, record.HOST_NAME);

    if (!master.portalCodes.has(portalKey)) return this._markInvalid(record, { code: 'INVALID_PORTAL_CODE', message: `Portal code is not active in master data: ${record.MOBI_PORTAL_CODE}` });
    if (!master.portalCompanyKeys.has(portalCompanyKey)) return this._markInvalid(record, { code: 'INVALID_COMPANY_CODE', message: `Company code is not valid for portal ${record.MOBI_PORTAL_CODE}: ${record.COMPANY_CODE}` });
    const merchant = master.merchantMap.get(merchantKey);
    if (!merchant) return this._markInvalid(record, { code: 'INVALID_MERCHANT_ID', message: `Merchant ID is not active for portal/company: ${record.MERCHANT_ID}` });
    if (!master.hostKeys.has(hostKey)) return this._markInvalid(record, { code: 'INVALID_HOST_ID', message: `Host ID/name is not active for portal/company: ${record.HOST_NAME}` });

    record.COUNTRY_CODE = merchant.COUNTRY_CODE;
    record.ROW_STATUS = Constants.ROW_STATUS.VALID;
    record.ERROR_CODE = '';
    record.ERROR_DETAIL = '';
    return record;
  }

  _markInvalid(record, result) {
    record.ROW_STATUS = Constants.ROW_STATUS.INVALID;
    record.ERROR_CODE = result.code;
    record.ERROR_DETAIL = result.message;
    return record;
  }
}
module.exports = ValidationService; 

// const Constants = require('../utils/Constants');

// class ValidationService {
//   constructor({ technicalValidator, businessValidator, currencyValidator, amountValidator, masterRepository, duplicateValidator }) {
//     Object.assign(this, { technicalValidator, businessValidator, currencyValidator, amountValidator, masterRepository, duplicateValidator });
//   }

//   async validateBatch(records) {
//     const ids = records.map((r) => r.MERCHANT_ID).filter(Boolean);
//     const masters = await this.masterRepository.findActiveByIds(ids);
//     const masterMap = new Map();
//     for (const m of masters) masterMap.set(`${m.MOBI_PORTAL_CODE}|${m.SAP_COMPANY_CODE}|${m.ID}`, m);

//     const validated = []; const seenKeys = new Set();
//     for (const record of records) {
//       const dupKey = `${record.COMPANY_CODE}|${record.MOBI_REFERENCE_ID}|${record.PAYMENT_TYPE}`;
//       if (seenKeys.has(dupKey)) { validated.push(this._markInvalid(record, { code: 'DUPLICATE_TRANSACTION', message: `Duplicate within file: ${record.MOBI_REFERENCE_ID}` })); continue; }
//       seenKeys.add(dupKey);
//       validated.push(await this._validateOne(record, masterMap));
//     }
//     return validated;
//   }

//   async _validateOne(record, masterMap) {
//     for (const v of [this.technicalValidator, this.businessValidator, this.currencyValidator, this.amountValidator, this.duplicateValidator]) {
//       if (!v) continue;
//       const r = await v.validate(record);
//       if (!r.valid) return this._markInvalid(record, r);
//     }
//     const master = masterMap.get(`${record.MOBI_PORTAL_CODE}|${record.COMPANY_CODE}|${record.MERCHANT_ID}`);
//     if (!master) return this._markInvalid(record, { code: 'MERCHANT_NOT_FOUND', message: `Merchant ${record.MERCHANT_ID} not found/inactive` });
//     record.COUNTRY_CODE = master.COUNTRY_CODE;
//     record.ROW_STATUS = Constants.ROW_STATUS.VALID; record.ERROR_CODE = ''; record.ERROR_DETAIL = '';
//     return record;
//   }

//   _markInvalid(record, result) { record.ROW_STATUS = Constants.ROW_STATUS.INVALID; record.ERROR_CODE = result.code; record.ERROR_DETAIL = result.message; return record; }
// }
// module.exports = ValidationService;
