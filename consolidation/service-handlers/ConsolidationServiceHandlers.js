/**
 * ConsolidationServiceHandlers – READ/PATCH/POST handlers shared across
 * PAYIN, PAYOUT, and DOMESTIC_SETTLEMENT consolidation services.
 *
 * All handlers are code-driven (2-digit status codes) consistent with the
 * rest of the hardened project. Human-readable text is joined with " || "
 * when multiple errors exist.
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const ScenarioConfig = require('../config/ScenarioConfig');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');

const POSTED = Constants.POSTING_STATUS.POSTED;       // '03'
const POSTING_FAILED = Constants.POSTING_STATUS.FAILED; // '07'
const POSTING_PENDING = Constants.POSTING_STATUS.POSTING_PENDING; // '02'

/**
 * Fields allowed on a line-item PATCH. POSTED documents cannot be modified.
 */
const PATCHABLE_FIELDS = Object.freeze([
  'GL_ACCOUNT','COST_CENTER','PROFIT_CENTER','DEBIT_CREDIT_INDICATOR',
  'SAP_SUPPLIER_NUMBER','SAP_CUSTOMER_NUMBER',
  'HOST_MDR_AMOUNT','HOST_FEE_PAYABLE','MDR_REVENUE',
  'AR_PAYIN','AP_PAYIN','AP_PAYOUT','TRANSACTION_AMOUNT'
]);

/**
 * Accept both text ("POSTED") and code ("03") variants for posting status.
 */
function normalizePostingStatus(input) {
  const s = String(input || '').trim().toUpperCase();
  if (['POSTED','SUCCESS','S','03'].includes(s)) return POSTED;
  if (['POSTING_FAILED','FAILED','ERROR','E','07'].includes(s)) return POSTING_FAILED;
  if (['POSTING_PENDING','PENDING','02'].includes(s))  return POSTING_PENDING;
  return null;
}

function postingToConsolStatus(postingStatus) {
  if (postingStatus === POSTED)          return Constants.CONSOL_STATUS.POSTED;         // '03'
  if (postingStatus === POSTING_FAILED)  return Constants.CONSOL_STATUS.POSTING_FAILED; // '07'
  if (postingStatus === POSTING_PENDING) return Constants.CONSOL_STATUS.POSTING_PENDING;// '02'
  return Constants.CONSOL_STATUS.CONSOLIDATION_FAILED; // '06'
}

function buildPatchPayload(data) {
  const payload = {};
  for (const f of PATCHABLE_FIELDS) {
    if (data[f] !== undefined && data[f] !== null) payload[f] = data[f];
  }
  return payload;
}

class ConsolidationServiceHandlers {
  constructor({ scenario, consolidationService, log }) {
    this.scenario = ScenarioConfig[scenario];
    if (!this.scenario) throw new Error(`Unknown consolidation scenario: ${scenario}`);
    this.consolidationService = consolidationService;
    this.log = log || console;
  }

  // ------------------------------------------------------------------
  // Action handlers
  // ------------------------------------------------------------------

  /**
   * POST /.../triggerConsolidation?companyCode=&postingDate=&dryRun=true|false
   */
  createScenarioHandler() {
    return async (req) => {
      const { companyCode = null, postingDate = null, documentDate = null,
              baselineDate = null, dryRun = false } = req.data || {};
      const actor = req?.user?.id || req?.user?.attr?.user_name || this.scenario.systemUser;
      try {
        return await this.consolidationService.run(this.scenario.code, {
          companyCode, postingDate, documentDate, baselineDate,
          dryRun: dryRun === true || dryRun === 'true',
          requestedBy: actor
        });
      } catch (err) {
        this.log.error(`[${this.scenario.code}] run failed: ${err.message}`);
        req.error(500, err.message);
      }
    };
  }

  /**
   * POST /.../postingResult – single-document callback from SAP/CPI.
   * Accepts both code ("03") and text ("POSTED") status.
   */
  createPostingResultHandler() {
    return async (req) => {
      const data = req.data || {};
      const actor = req?.user?.id || req?.user?.attr?.user_name || this.scenario.systemUser;
      const code = normalizePostingStatus(data.postingStatus || data.POSTING_STATUS);
      if (!code && !data.errorCode && !data.ERROR_CODE) {
        req.error(400,
          'postingStatus is required (expected one of: 03/POSTED/SUCCESS, 07/FAILED/ERROR, 02/PENDING).');
        return;
      }
      try {
        return await this.consolidationService.updatePostingResult(this.scenario.code, {
          consolRefId:    data.consolRefId    || data.CONSOL_REF_ID,
          sapRefDocument: data.sapRefDocument || data.SAP_REF_DOCUMENT,
          postingStatus:  code,
          httpStatus:     data.httpStatus     ?? data.HTTP_STATUS,
          errorCode:      data.errorCode      || data.ERROR_CODE,
          errorDetail:    data.errorDetail    || data.ERROR_DETAIL,
          requestedBy:    actor
        });
      } catch (err) {
        this.log.error(`[${this.scenario.code}] postingResult failed: ${err.message}`);
        req.error(500, err.message);
      }
    };
  }

  /**
   * POST /.../batchPostingResult – array of posting results (for mass callback).
   */
  createBatchPostingResultHandler() {
    return async (req) => {
      const items = req.data?.results || req.data?.items || req.data || [];
      if (!Array.isArray(items)) {
        req.error(400, 'Expected an array of posting results (results:[]).');
        return;
      }
      const actor = req?.user?.id || req?.user?.attr?.user_name || this.scenario.systemUser;
      const succeeded = [];
      const failed = [];
      for (const item of items) {
        const code = normalizePostingStatus(item.postingStatus || item.POSTING_STATUS);
        try {
          const out = await this.consolidationService.updatePostingResult(this.scenario.code, {
            consolRefId:    item.consolRefId    || item.CONSOL_REF_ID,
            sapRefDocument: item.sapRefDocument || item.SAP_REF_DOCUMENT,
            postingStatus:  code,
            httpStatus:     item.httpStatus     ?? item.HTTP_STATUS,
            errorCode:      item.errorCode      || item.ERROR_CODE,
            errorDetail:    item.errorDetail    || item.ERROR_DETAIL,
            requestedBy:    actor
          });
          succeeded.push(out);
        } catch (err) {
          failed.push({
            consolRefId: item.consolRefId || item.CONSOL_REF_ID,
            error: String(err.message || err)
          });
        }
      }
      return { total: items.length, succeeded: succeeded.length, failed: failed.length, results: succeeded, failures: failed };
    };
  }

  // ------------------------------------------------------------------
  // READ handlers
  // ------------------------------------------------------------------

  /**
   * GET LineItems – join with the header's posting status; filter by scenario
   * payment type/sub-type and consol_ref prefix.
   */
  createLineItemsReadHandler() {
    return async (req) => {
      const db = await cds.connect.to('db');
      const prefix = this.scenario.refToken;
      const where = this._scenarioWhere({
        CONSOL_REF_ID: req.data?.consolRefId || req.data?.CONSOL_REF_ID
          ? (req.data?.consolRefId || req.data?.CONSOL_REF_ID)
          : { like: `${prefix}%` },
        POSTING_STATUS: req.data?.postingStatus ? normalizePostingStatus(req.data.postingStatus) : undefined
      });
      const rows = await db.run(
        SELECT.from(EntityNames.CONSOLIDATION_LINE_ITEM)
          .where(this._prune(where))
          .orderBy('CONSOL_REF_ID','DOC_REF_ITEM')
      );
      return rows.map((r) => this._toBaseColumn(r));
    };
  }

  /**
   * GET ConsolidationHeaders – filter by scenario posting status.
   */
  createPostingDocumentsReadHandler() {
    return async (req) => {
      const db = await cds.connect.to('db');
      const prefix = this.scenario.refToken;
      const where = this._scenarioWhere({
        CONSOL_REF_ID: req.data?.consolRefId ? req.data.consolRefId : { like: `${prefix}%` },
        POSTING_STATUS: req.data?.postingStatus ? normalizePostingStatus(req.data.postingStatus) : undefined,
        COMPANY_CODE: req.data?.companyCode || undefined
      });
      return db.run(
        SELECT.from(EntityNames.CONSOLIDATION_HEADER)
          .where(this._prune(where))
          .orderBy('POSTING_DATE desc','CONSOL_REF_ID')
      );
    };
  }

  /**
   * GET posting items for a given consolRefId – returns line items joined with
   * header company/portal/status fields for the posting UI.
   */
  createPostingItemsReadHandler() {
    return async (req) => {
      const consolRefId = req.data?.consolRefId || req.data?.CONSOL_REF_ID;
      if (!consolRefId) {
        req.error(400, 'consolRefId is required.');
        return;
      }
      const db = await cds.connect.to('db');
      const header = await db.run(
        SELECT.one.from(EntityNames.CONSOLIDATION_HEADER).where({ CONSOL_REF_ID: consolRefId })
      );
      if (!header) {
        req.error(404, `Consolidation document ${consolRefId} not found.`);
        return;
      }
      const items = await db.run(
        SELECT.from(EntityNames.CONSOLIDATION_LINE_ITEM)
          .where({ CONSOL_REF_ID: consolRefId })
          .orderBy('DOC_REF_ITEM')
      );
      return {
        header: this._toBaseColumn(header),
        items: items.map((i) => this._toBaseColumn(i)),
        scenario: this.scenario.code
      };
    };
  }

  // ------------------------------------------------------------------
  // PATCH handlers
  // ------------------------------------------------------------------

  /**
   * PATCH /LineItems(consolRefId=, docRefItem=) – only allowed while
   * POSTING_STATUS = '02' (POSTING_PENDING). Rejects overwrite of POSTED docs.
   */
  createLineItemPatchHandler() {
    return async (req) => {
      const { consolRefId, docRefItem } = req.params?.[0] || req.data || {};
      if (!consolRefId) { req.error(400, 'consolRefId is required.'); return; }
      if (docRefItem === undefined) { req.error(400, 'docRefItem is required.'); return; }
      const db = await cds.connect.to('db');
      const now = new Date().toISOString();
      const actor = req?.user?.id || req?.user?.attr?.user_name || this.scenario.systemUser;

      const existing = await db.run(
        SELECT.one.from(EntityNames.CONSOLIDATION_LINE_ITEM)
          .columns('CONSOL_REF_ID','DOC_REF_ITEM','POSTING_STATUS')
          .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
      );
      if (!existing) { req.error(404, `Line item ${consolRefId}/${docRefItem} not found.`); return; }
      if (String(existing.POSTING_STATUS) === POSTED) {
        req.error(409, 'Line item belongs to a POSTED document and cannot be modified.');
        return;
      }

      const payload = buildPatchPayload(req.data || {});
      if (!Object.keys(payload).length) {
        req.error(400, `No patchable fields supplied. Allowed: ${PATCHABLE_FIELDS.join(', ')}.`);
        return;
      }
      payload.CHANGED_BY = actor;
      payload.CHANGED_TIMESTAMP = now;
      await db.run(
        UPDATE(EntityNames.CONSOLIDATION_LINE_ITEM)
          .set(payload)
          .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
      );
      return db.run(
        SELECT.one.from(EntityNames.CONSOLIDATION_LINE_ITEM)
          .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
      );
    };
  }

  /**
   * PATCH updatePostingItem – updates one line item's posting outcome
   * (SAP_REF_DOCUMENT, POSTING_STATUS, ERROR_CODE, ERROR_DETAIL).
   */
  createPostingItemUpdateHandler() {
    return async (req) => {
      const { consolRefId, docRefItem } = req.data || {};
      if (!consolRefId || docRefItem === undefined) {
        req.error(400, 'consolRefId and docRefItem are required.');
        return;
      }
      const db = await cds.connect.to('db');
      const actor = req?.user?.id || req?.user?.attr?.user_name || this.scenario.systemUser;
      const now = new Date().toISOString();
      const code = normalizePostingStatus(req.data.postingStatus || req.data.POSTING_STATUS);
      const payload = { CHANGED_BY: actor, CHANGED_TIMESTAMP: now, POST_DATE: now };
      if (code) payload.POSTING_STATUS = code;
      if (req.data.sapRefDocument !== undefined || req.data.SAP_REF_DOCUMENT !== undefined) {
        payload.SAP_REF_DOCUMENT = req.data.sapRefDocument || req.data.SAP_REF_DOCUMENT || null;
      }
      if (req.data.httpStatus !== undefined || req.data.HTTP_STATUS !== undefined) {
        payload.HTTP_STATUS = req.data.httpStatus ?? req.data.HTTP_STATUS;
      }
      if (req.data.errorCode !== undefined || req.data.ERROR_CODE !== undefined) {
        payload.ERROR_CODE = req.data.errorCode || req.data.ERROR_CODE || null;
      }
      if (req.data.errorDetail !== undefined || req.data.ERROR_DETAIL !== undefined) {
        payload.ERROR_DETAIL = req.data.errorDetail || req.data.ERROR_DETAIL || null;
      }
      await db.run(
        UPDATE(EntityNames.CONSOLIDATION_LINE_ITEM)
          .set(payload)
          .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
      );
      return db.run(
        SELECT.one.from(EntityNames.CONSOLIDATION_LINE_ITEM)
          .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
      );
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  _scenarioWhere(extra = {}) {
    const where = {
      PAYMENT_TYPE: { in: this.scenario.paymentTypeAliases },
      COMPANY_CODE: { in: this.scenario.allowedCompanyCodes }
    };
    if (this.scenario.paymentSubTypeAliases?.length) {
      where.PAYMENT_SUB_TYPE = { in: this.scenario.paymentSubTypeAliases };
    }
    return { ...where, ...extra };
  }

  _prune(obj) {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
    }
    return out;
  }

  /**
   * Map code POSTING_STATUS to a text STATUS column for backward-compatible reads.
   * Also ensures numeric fields are preserved as numbers.
   */
  _toBaseColumn(row) {
    if (!row) return row;
    const out = { ...row };
    switch (String(out.POSTING_STATUS)) {
      case POSTED:          out.STATUS_TEXT = 'POSTED';          break;
      case POSTING_FAILED:  out.STATUS_TEXT = 'POSTING_FAILED';  break;
      case POSTING_PENDING: out.STATUS_TEXT = 'POSTING_PENDING'; break;
      default:              out.STATUS_TEXT = 'PENDING';
    }
    out.CONSOL_STATUS_CODE = postingToConsolStatus(String(out.POSTING_STATUS));
    return out;
  }
}

module.exports = ConsolidationServiceHandlers;
