const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

const key = (...values) => values.map((v) => String(v || '').trim().toUpperCase()).join('|');
const isHost = (m) => String(m.TYPE || '').trim().toUpperCase() === 'HOST';

/**
 * ValidationService - runs all configured validators against each record and
 * AGGREGATES every error for the record (not just the first). Master-data
 * lookups (portal/company/merchant/host) are cached per file to keep the check
 * fast even on large files.
 */
class ValidationService {
  constructor({ technicalValidator, businessValidator, currencyValidator,
                amountValidator, masterRepository, duplicateValidator }) {
    Object.assign(this, { technicalValidator, businessValidator, currencyValidator,
      amountValidator, masterRepository, duplicateValidator });
  }

  async validateBatch(records, duplicateContext = { mobiReferencesSeen: new Set(), hostReferencesSeen: new Set(), masterData: null }) {
    if (!duplicateContext.masterData) {
      duplicateContext.masterData = await this.masterRepository.findActiveForValidation();
    }
    const all = duplicateContext.masterData;

    const portalCodes       = new Set(all.map((m) => key(m.MOBI_PORTAL_CODE)));
    const portalCompanyKeys = new Set(all.map((m) => key(m.MOBI_PORTAL_CODE, m.SAP_COMPANY_CODE)));
    const merchantMap       = new Map();
    const hostKeys          = new Set();

    for (const m of all) {
      const k = key(m.MOBI_PORTAL_CODE, m.SAP_COMPANY_CODE, m.ID);
      if (isHost(m)) hostKeys.add(k);
      else merchantMap.set(k, m);
    }

    const { mobiReferencesSeen, hostReferencesSeen } = duplicateContext;
    const validated = [];

    for (const record of records) {
      const allErrors = [];

      // 1. Within-file duplicate checks
      const mobiRef = String(record.MOBI_REFERENCE_ID || '').trim();
      if (mobiRef && mobiReferencesSeen.has(mobiRef)) {
        allErrors.push({ code: Constants.ERROR_CODES.DUPLICATE_MOBI_REF, message: F.duplicateMobiRef(mobiRef) });
      } else if (mobiRef) {
        mobiReferencesSeen.add(mobiRef);
      }

      const hostRef = String(record.HOST_REFERENCE_ID || '').trim();
      const hostDayKeys = [record.TXN_CREATED_DATE, record.TXN_PAID_DATE].filter(Boolean).map((d) => key(hostRef, d));
      if (hostRef && hostDayKeys.some((k) => hostReferencesSeen.has(k))) {
        allErrors.push({
          code: Constants.ERROR_CODES.DUPLICATE_HOST_REF,
          message: F.duplicateHostRef(hostRef, record.TXN_CREATED_DATE)
        });
      } else {
        hostDayKeys.forEach((k) => hostReferencesSeen.add(k));
      }

      // 2. Composite validators (each returns {valid, errors[]})
      for (const validator of [this.technicalValidator, this.businessValidator,
                               this.currencyValidator, this.amountValidator]) {
        if (!validator) continue;
        const result = validator.validate(record);
        if (!result.valid) allErrors.push(...(result.errors || [{ code: '00', message: 'Unknown validation error' }]));
      }

      // 3. Master-data lookups
      const portalKey        = key(record.MOBI_PORTAL_CODE);
      const companyPortalKey = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE);
      const merchantKey      = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE, record.MERCHANT_ID);
      const hostKey          = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE, record.HOST_NAME);

      if (!portalCodes.has(portalKey)) {
        allErrors.push({
          code: Constants.ERROR_CODES.INVALID_PORTAL_MASTER,
          message: F.invalidPortalMaster(record.MOBI_PORTAL_CODE)
        });
      } else if (!portalCompanyKeys.has(companyPortalKey)) {
        allErrors.push({
          code: Constants.ERROR_CODES.INVALID_COMPANY_PORTAL,
          message: F.invalidCompanyPortal(record.COMPANY_CODE, record.MOBI_PORTAL_CODE)
        });
      } else {
        if (!merchantMap.has(merchantKey)) {
          allErrors.push({ code: Constants.ERROR_CODES.INVALID_MERCHANT, message: F.invalidMerchant(record.MERCHANT_ID) });
        }
        if (!hostKeys.has(hostKey)) {
          allErrors.push({ code: Constants.ERROR_CODES.INVALID_HOST, message: F.invalidHost(record.HOST_NAME) });
        } else {
          const merchant = merchantMap.get(merchantKey);
          if (merchant) record.COUNTRY_CODE = merchant.COUNTRY_CODE;
        }
      }

      // 4. DB duplicate validator
      if (this.duplicateValidator && allErrors.length === 0) {
        const dupResult = await this.duplicateValidator.validate(record);
        if (!dupResult.valid) allErrors.push(...(dupResult.errors || []));
      }

      if (allErrors.length > 0) {
        record.ROW_STATUS   = Constants.ROW_STATUS.INVALID;
        record.ERROR_CODE   = StatusCodeUtil.joinErrorCodes(allErrors);
        record.ERROR_DETAIL = StatusCodeUtil.joinErrorDetails(allErrors);
      } else {
        record.ROW_STATUS   = Constants.ROW_STATUS.VALID;
        record.ERROR_CODE   = '';
        record.ERROR_DETAIL = '';
        record.TXN_STATUS   = StatusCodeUtil.toCode('TRANSACTION', record.TXN_STATUS_TEXT, '01');
      }

      validated.push(record);
    }

    return validated;
  }
}

module.exports = ValidationService;
