const cds = require('@sap/cds');

const EntityNames = require('../constants/EntityNames');
const ScenarioConfig = require('../config/ScenarioConfig');

const FIELDS_BY_SCENARIO = Object.freeze({

  PAYIN: [
    'CONSOL_REF_ID', 'DOC_REF_ITEM', 'SAP_REF_DOCUMENT', 'COMPANY_CODE',
    'MOBI_PORTAL_CODE', 'PAYMENT_TYPE', 'PAYMENT_SUB_TYPE', 'MERCHANT_ID',
    'SAP_SUPPLIER_NUMBER', 'SAP_CUSTOMER_NUMBER', 'POSTING_DATE', 'DOCUMENT_DATE',
    'BASELINE_DATE', 'HOST_NAME', 'CURRENCY', 'HOST_MDR_AMOUNT', 'MDR_REVENUE',
    'AR_PAYIN', 'AP_PAYIN', 'GL_ACCOUNT', 'DEBIT_CREDIT_INDICATOR', 'COST_CENTER',
    'PROFIT_CENTER', 'DOCUMENT_TYPE', 'POSTING_STATUS', 'CONSOL_STATUS',
    'POST_DATE', 'HTTP_STATUS', 'ERROR_CODE', 'ERROR_DETAIL', 'RETRY_COUNT',
    'CREATED_BY', 'CREATED_TIMESTAMP', 'CHANGED_BY', 'CHANGED_TIMESTAMP'
  ],

  PAYOUT: [
    'CONSOL_REF_ID', 'DOC_REF_ITEM', 'SAP_REF_DOCUMENT', 'COMPANY_CODE',
    'MOBI_PORTAL_CODE', 'PAYMENT_TYPE', 'PAYMENT_SUB_TYPE', 'MERCHANT_ID',
    'SAP_SUPPLIER_NUMBER', 'SAP_CUSTOMER_NUMBER', 'POSTING_DATE', 'DOCUMENT_DATE',
    'BASELINE_DATE', 'HOST_NAME', 'CURRENCY', 'HOST_MDR_AMOUNT', 'HOST_FEE_PAYABLE',
    'MDR_REVENUE', 'AP_PAYOUT', 'TRANSACTION_AMOUNT', 'GL_ACCOUNT',
    'DEBIT_CREDIT_INDICATOR', 'COST_CENTER', 'PROFIT_CENTER', 'DOCUMENT_TYPE',
    'POSTING_STATUS', 'CONSOL_STATUS', 'POST_DATE', 'HTTP_STATUS', 'ERROR_CODE',
    'ERROR_DETAIL', 'RETRY_COUNT', 'CREATED_BY', 'CREATED_TIMESTAMP',
    'CHANGED_BY', 'CHANGED_TIMESTAMP'
  ],

  DOMESTIC_SETTLEMENT: [
    'CONSOL_REF_ID', 'DOC_REF_ITEM', 'SAP_REF_DOCUMENT', 'COMPANY_CODE',
    'MOBI_PORTAL_CODE', 'PAYMENT_TYPE', 'PAYMENT_SUB_TYPE', 'MERCHANT_ID',
    'SAP_SUPPLIER_NUMBER', 'POSTING_DATE', 'DOCUMENT_DATE', 'BASELINE_DATE',
    'CURRENCY', 'AP_PAYOUT', 'GL_ACCOUNT', 'DEBIT_CREDIT_INDICATOR',
    'COST_CENTER', 'PROFIT_CENTER', 'DOCUMENT_TYPE', 'POSTING_STATUS',
    'CONSOL_STATUS', 'POST_DATE', 'HTTP_STATUS', 'ERROR_CODE', 'ERROR_DETAIL',
    'RETRY_COUNT', 'CREATED_BY', 'CREATED_TIMESTAMP', 'CHANGED_BY',
    'CHANGED_TIMESTAMP'
  ]
});

function createLineItemsReadHandler(scenarioCode) {
  const allowedFields = FIELDS_BY_SCENARIO[scenarioCode];
  if (!allowedFields) {
    throw new Error(`Unsupported line item read scenario ${scenarioCode}`);
  }
  const scenario = ScenarioConfig[scenarioCode];
  const scenarioFilter = scenarioWhere(scenarioCode, scenario);

  return async function lineItemsReadHandler(req) {
    const db = await cds.connect.to('db');
    const sourceSelect = req.query?.SELECT || {};

    const query = {
      SELECT: {
        from: { ref: [EntityNames.CONSOLIDATION_LINE_ITEM] },
        columns: buildColumns(sourceSelect.columns, allowedFields),
        where: combineWhere(scenarioFilter, transformExpression(sourceSelect.where)),
        orderBy: transformExpression(sourceSelect.orderBy),
        limit: sourceSelect.limit,
        one: sourceSelect.one
      }
    };

    cleanupSelect(query.SELECT);

    const rows = await db.run(query);

    if (Array.isArray(rows)) {
      return rows.map(addConsolStatus);
    }
    return addConsolStatus(rows);
  };
}

// -----------------------------------------------------------------------------
// Column handling
// -----------------------------------------------------------------------------
function buildColumns(requestedColumns, allowedFields) {
  if (isCountColumns(requestedColumns)) {
    return requestedColumns;
  }
  if (!requestedColumns?.length || requestedColumns.some((column) => column === '*' || column?.ref?.[0] === '*')) {
    return allowedFields.map(toBaseColumn);
  }
  const mapped = requestedColumns
    .filter((column) => !column.ref || allowedFields.includes(column.ref[0]))
    .map(toBaseColumn);
  return mapped.length ? mapped : allowedFields.map(toBaseColumn);
}

function isCountColumns(columns = []) {
  return columns.some((column) => column.func === 'count' || column.as === '$count');
}

function toBaseColumn(columnOrField) {
  const field = typeof columnOrField === 'string' ? columnOrField : columnOrField?.ref?.[0];
  if (field === 'CONSOL_STATUS') {
    return { ref: ['POSTING_STATUS'], as: 'CONSOL_STATUS' };
  }
  return typeof columnOrField === 'string' ? { ref: [field] } : columnOrField;
}

// -----------------------------------------------------------------------------
// Expression / WHERE helpers
// -----------------------------------------------------------------------------
function transformExpression(value) {
  if (!value) return value;
  if (Array.isArray(value)) {
    return value.map(transformExpression);
  }
  if (value.ref?.[0] === 'CONSOL_STATUS') {
    return { ...value, ref: ['POSTING_STATUS', ...value.ref.slice(1)] };
  }
  if (typeof value === 'object') {
    const clone = { ...value };
    for (const [key, nestedValue] of Object.entries(clone)) {
      clone[key] = transformExpression(nestedValue);
    }
    return clone;
  }
  return value;
}

function combineWhere(left, right) {
  if (!left?.length) return right;
  if (!right?.length) return left;
  return ['(', ...left, ')', 'and', '(', ...right, ')'];
}

/**
 * Build raw CQN token array for scenario filtering:
 *   1. PAYMENT_TYPE (and SUB_TYPE for PAYOUT/DS) as in original code
 *   2. COMPANY_CODE IN (allowed company codes for the scenario)
 *   3. CONSOL_REF_ID LIKE '<cc><refToken>%' for every allowed company, ORed
 *      with a bare '<refToken>%' fallback (matches the ReferenceNumberService
 *      output shape `<COMPANY><refToken><YYYYMMDD><NNNN>`, e.g. 2000PAYOUT202607230001)
 */
function scenarioWhere(scenarioCode, scenario) {
  const clauses = [];

  // --- 1. Payment type / sub-type (original logic) ---
  if (scenarioCode === 'PAYIN') {
    clauses.push(
      '(', { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYINS' },
      'or', { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYIN' }, ')'
    );
  } else if (scenarioCode === 'PAYOUT') {
    clauses.push(
      { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYOUT' },
      'and',
      { ref: ['PAYMENT_SUB_TYPE'] }, '<>', { val: 'DOMESTIC SETTLEMENT' }
    );
  } else if (scenarioCode === 'DOMESTIC_SETTLEMENT') {
    clauses.push(
      { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYOUT' },
      'and',
      { ref: ['PAYMENT_SUB_TYPE'] }, '=', { val: 'DOMESTIC SETTLEMENT' }
    );
  }

  // --- 2. COMPANY_CODE IN (allowed companies) ---
  const companies = scenario?.allowedCompanyCodes || [];
  if (companies.length > 0) {
    const inClause = [
      { ref: ['COMPANY_CODE'] }, 'in',
      { list: companies.map((cc) => ({ val: cc })) }
    ];
    clauses.push('and', ...inClause);
  }

  // --- 3. CONSOL_REF_ID prefix filter (fixes the empty-result bug) ---
  const refToken = scenario?.refToken;
  if (refToken) {
    const patterns = [
      ...companies.map((cc) => `${cc}${refToken}%`),
      `${refToken}%`
    ];
    // Build OR chain: (CONSOL_REF_ID like ? or CONSOL_REF_ID like ? or ...)
    const likeChain = ['('];
    patterns.forEach((pat, idx) => {
      if (idx > 0) likeChain.push('or');
      likeChain.push({ ref: ['CONSOL_REF_ID'] }, 'like', { val: pat });
    });
    likeChain.push(')');
    clauses.push('and', ...likeChain);
  }

  return clauses;
}

function cleanupSelect(select) {
  Object.keys(select).forEach((key) => {
    if (select[key] === undefined || select[key] === null) {
      delete select[key];
    }
  });
}

// -----------------------------------------------------------------------------
// Result shaping
// -----------------------------------------------------------------------------
function addConsolStatus(row) {
  if (!row) return row;
  // Map POSTING_STATUS code -> CONSOL_STATUS text (code passthrough kept as-is
  // from your original addConsolStatus). Also force CHANGED_* to null per spec.
  if (row.POSTING_STATUS !== undefined && row.CONSOL_STATUS === undefined) {
    row.CONSOL_STATUS = row.POSTING_STATUS;
  }
  row.CHANGED_BY = null;
  row.CHANGED_TIMESTAMP = null;
  return row;
}

module.exports = createLineItemsReadHandler;
