using { mobi.db as db } from '../db/schema';

service DomesticSettlementConsolidationService {

  @cds.persistence.skip
  entity LineItems {
    key CONSOL_REF_ID          : String(50);
    key DOC_REF_ITEM           : Integer;
        SAP_REF_DOCUMENT       : String(20);
        COMPANY_CODE           : String(4);
        MOBI_PORTAL_CODE       : String(2);
        PAYMENT_TYPE           : String(20);
        PAYMENT_SUB_TYPE       : String(30);
        MERCHANT_ID            : String(20);
        SAP_SUPPLIER_NUMBER    : String(10);
        POSTING_DATE           : Date;
        DOCUMENT_DATE          : Date;
        BASELINE_DATE          : Date;
        CURRENCY               : String(3);
        AP_PAYOUT              : Decimal(18,2);
        GL_ACCOUNT             : String(10);
        DEBIT_CREDIT_INDICATOR : String(1);
        COST_CENTER            : String(10);
        PROFIT_CENTER          : String(10);
        DOCUMENT_TYPE           : String(2);
        POSTING_STATUS          : String(20);
        CONSOL_STATUS           : String(20);
        POST_DATE               : Timestamp;
        HTTP_STATUS             : Integer;
        ERROR_CODE              : String(20);
        ERROR_DETAIL            : String(255);
        RETRY_COUNT             : Integer;
        CREATED_BY              : String(50);
        CREATED_TIMESTAMP       : Timestamp;
        CHANGED_BY              : String(50);
        CHANGED_TIMESTAMP       : Timestamp;
  }

  type DomesticSettlementConsolidationRunResult {
    scenario            : String(40);
    dryRun              : Boolean;
    inputTransactions   : Integer;
    skippedTransactions : Integer;
    glAccountMissing    : Integer;
    bpMasterMissing     : Integer;
    errorRecordsUpdated : Integer;
    headersCreated      : Integer;
    lineItemsCreated    : Integer;
    transactionsUpdated : Integer;
    consolRefIds        : String(5000);
    message             : String(500);
  }

  type PostingResultUpdateRequest {
    consolRefId     : String(50);
    sapRefDocument  : String(20);
    postingStatus   : String(20);
    httpStatus      : Integer;
    errorCode       : String(20);
    errorDetail     : String(255);
  }

  type PostingResultUpdateResponse {
    consolRefId     : String(50);
    status          : String(20);
    postingStatus   : String(20);
    message         : String(500);
  }

  action runDomesticSettlementConsolidation(
    companyCode  : String(4),
    postingDate  : Date,
    documentDate : Date,
    baselineDate : Date,
    dryRun       : Boolean
  ) returns DomesticSettlementConsolidationRunResult;

  action updateBatchPostingResults(
    items : array of PostingResultUpdateRequest
  ) returns array of PostingResultUpdateResponse;
}

// using { mobi.db as db } from '../db/schema';

// service DomesticSettlementConsolidationService {
//   entity LineItems as projection on db.MOBI_DB_CONSOLIDATIONLINEITEM;

//   type DomesticSettlementConsolidationRunResult {
//     scenario            : String(40);
//     dryRun              : Boolean;
//     inputTransactions   : Integer;
//     skippedTransactions : Integer;
//     glAccountMissing    : Integer;
//     headersCreated      : Integer;
//     lineItemsCreated    : Integer;
//     transactionsUpdated : Integer;
//     consolRefIds        : String(5000);
//     message             : String(500);
//   }

//   action runDomesticSettlementConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns DomesticSettlementConsolidationRunResult;
// }


// using { mobi.db as db } from '../db/schema';

// service DomesticSettlementConsolidationService {
//   @cds.persistence.skip
//   entity LineItems {
//     key CONSOL_REF_ID          : String(50);
//     key DOC_REF_ITEM           : Integer;
//         SAP_REF_DOCUMENT       : String(20);
//         COMPANY_CODE           : String(4);
//         MOBI_PORTAL_CODE       : String(2);
//         PAYMENT_TYPE           : String(20);
//         PAYMENT_SUB_TYPE       : String(30);
//         MERCHANT_ID            : String(20);
//         SAP_SUPPLIER_NUMBER    : String(10);
//         POSTING_DATE           : Date;
//         DOCUMENT_DATE          : Date;
//         BASELINE_DATE          : Date;
//         CURRENCY               : String(3);
//         AP_PAYOUT              : Decimal(18, 2);
//         GL_ACCOUNT             : String(10);
//         DEBIT_CREDIT_INDICATOR : String(1);
//         COST_CENTER            : String(10);
//         PROFIT_CENTER          : String(10);
//         DOCUMENT_TYPE          : String(2);
//         POSTING_STATUS         : String(20);
//         CONSOL_STATUS          : String(20);
//         POST_DATE              : Timestamp;
//         HTTP_STATUS            : Integer;
//         ERROR_CODE             : String(20);
//         ERROR_DETAIL           : String(255);
//         RETRY_COUNT            : Integer;
//         CREATED_BY             : String(50);
//         CREATED_TIMESTAMP      : Timestamp;
//         CHANGED_BY             : String(50);
//         CHANGED_TIMESTAMP      : Timestamp;
//   }

//   type DomesticSettlementConsolidationRunResult {
//     scenario            : String(40);
//     dryRun              : Boolean;
//     inputTransactions   : Integer;
//     skippedTransactions : Integer;
//     glAccountMissing    : Integer;
//     bpMasterMissing     : Integer;
//     errorRecordsUpdated : Integer;
//     headersCreated      : Integer;
//     lineItemsCreated    : Integer;
//     transactionsUpdated : Integer;
//     consolRefIds        : String(5000);
//     message             : String(500);
//   }

//   action runDomesticSettlementConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns DomesticSettlementConsolidationRunResult;
// }
// action updateBatchPostingResults(items: array of {
// consolRefId: String(50);
// sapRefDocument: String(20);
// postingStatus: String(20);
// httpStatus: Integer;
// errorCode: String(20);
// errorDetail: String(255);
// }) returns array of {
// consolRefId: String(50);
// status: String(20);
// postingStatus: String(20);
// message: String(500);
// };



// using { mobi.db as db } from '../db/schema';

// service DomesticSettlementConsolidationService {
//   @cds.persistence.skip
//   entity PostingDocuments {
//     key CONSOL_REF_ID        : String(50);
//         SAP_REF_DOCUMENT     : String(20);
//         COMPANY_CODE         : String(4);
//         MOBI_PORTAL_CODE     : String(2);
//         PAYMENT_TYPE         : String(20);
//         PAYMENT_SUB_TYPE     : String(30);
//         DOCUMENT_TYPE        : String(2);
//         POSTING_DATE         : Date;
//         DOCUMENT_DATE        : Date;
//         BASELINE_DATE        : Date;
//         TOTAL_DEBIT_AMOUNT   : Decimal(18, 2);
//         TOTAL_CREDIT_AMOUNT  : Decimal(18, 2);
//         CURRENCY             : String(3);
//         POSTING_STATUS       : String(20);
//         CONSOL_STATUS        : String(20);
//         POST_DATE            : Timestamp;
//         HTTP_STATUS          : Integer;
//         ERROR_CODE           : String(20);
//         ERROR_DETAIL         : String(255);
//         RETRY_COUNT          : Integer;
//         CREATED_BY           : String(50);
//         CREATED_TIMESTAMP    : Timestamp;
//         CHANGED_BY           : String(50);
//         CHANGED_TIMESTAMP    : Timestamp;
//         items                : Composition of many PostingDocumentItems
//                                  on items.CONSOL_REF_ID = CONSOL_REF_ID;
//   }

//   @cds.persistence.skip
//   entity PostingDocumentItems {
//     key CONSOL_REF_ID          : String(50);
//     key DOC_REF_ITEM           : Integer;
//         SAP_REF_DOCUMENT       : String(20);
//         COMPANY_CODE           : String(4);
//         MOBI_PORTAL_CODE       : String(2);
//         PAYMENT_TYPE           : String(20);
//         PAYMENT_SUB_TYPE       : String(30);
//         MERCHANT_ID            : String(20);
//         SAP_SUPPLIER_NUMBER    : String(10);
//         POSTING_DATE           : Date;
//         DOCUMENT_DATE          : Date;
//         BASELINE_DATE          : Date;
//         CURRENCY               : String(3);
//         AP_PAYOUT              : Decimal(18, 2);
//         GL_ACCOUNT             : String(10);
//         DEBIT_CREDIT_INDICATOR : String(1);
//         COST_CENTER            : String(10);
//         PROFIT_CENTER          : String(10);
//         DOCUMENT_TYPE          : String(2);
//         POSTING_STATUS         : String(20);
//         CONSOL_STATUS          : String(20);
//         POST_DATE              : Timestamp;
//         HTTP_STATUS            : Integer;
//         ERROR_CODE             : String(20);
//         ERROR_DETAIL           : String(255);
//         RETRY_COUNT            : Integer;
//         CREATED_BY             : String(50);
//         CREATED_TIMESTAMP      : Timestamp;
//         CHANGED_BY             : String(50);
//         CHANGED_TIMESTAMP      : Timestamp;
//   }

//   type DomesticSettlementConsolidationRunResult {
//     scenario            : String(40);
//     dryRun              : Boolean;
//     inputTransactions   : Integer;
//     skippedTransactions : Integer;
//     glAccountMissing    : Integer;
//     bpMasterMissing     : Integer;
//     errorRecordsUpdated : Integer;
//     headersCreated      : Integer;
//     lineItemsCreated    : Integer;
//     transactionsUpdated : Integer;
//     consolRefIds        : String(5000);
//     message             : String(500);
//   }

//   type DomesticSettlementPostingUpdateResult {
//     consolRefId     : String(50);
//     postingStatus   : String(20);
//     sapRefDocument  : String(20);
//     message         : String(500);
//   }

//   action runDomesticSettlementConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns DomesticSettlementConsolidationRunResult;

//   action updateDomesticSettlementPostingResult(
//     consolRefId    : String(50),
//     sapRefDocument : String(20),
//     postingStatus  : String(20),
//     httpStatus     : Integer,
//     errorCode      : String(20),
//     errorDetail    : String(255)
//   ) returns DomesticSettlementPostingUpdateResult;
// }












// *****************************************
// using { mobi.db as db } from '../db/schema';

// service DomesticSettlementConsolidationService {
//   @cds.persistence.skip
//   entity PostingItems {
//     key CONSOL_REF_ID          : String(50);
//     key DOC_REF_ITEM           : Integer;
//         SAP_REF_DOCUMENT       : String(20);
//         COMPANY_CODE           : String(4);
//         MOBI_PORTAL_CODE       : String(2);
//         PAYMENT_TYPE           : String(20);
//         PAYMENT_SUB_TYPE       : String(30);
//         MERCHANT_ID            : String(20);
//         SAP_SUPPLIER_NUMBER    : String(10);
//         POSTING_DATE           : Date;
//         DOCUMENT_DATE          : Date;
//         BASELINE_DATE          : Date;
//         CURRENCY               : String(3);
//         AP_PAYOUT              : Decimal(18, 2);
//         GL_ACCOUNT             : String(10);
//         DEBIT_CREDIT_INDICATOR : String(1);
//         COST_CENTER            : String(10);
//         PROFIT_CENTER          : String(10);
//         DOCUMENT_TYPE          : String(2);
//         POSTING_STATUS         : String(20);
//         CONSOL_STATUS          : String(20);
//         POST_DATE              : Timestamp;
//         HTTP_STATUS            : Integer;
//         ERROR_CODE             : String(20);
//         ERROR_DETAIL           : String(255);
//         RETRY_COUNT            : Integer;
//         CREATED_BY             : String(50);
//         CREATED_TIMESTAMP      : Timestamp;
//         CHANGED_BY             : String(50);
//         CHANGED_TIMESTAMP      : Timestamp;
//   }
// ************************************

// using { mobi.db as db } from '../db/schema';

// service DomesticSettlementConsolidationService {

//   entity PostingItems as
//     select from db.MOBI_DB_CONSOLIDATIONLINEITEM as L
//       inner join db.MOBI_DB_CONSOLIDATIONHEADER as H
//         on L.CONSOL_REF_ID = H.CONSOL_REF_ID
//   {
//       key L.CONSOL_REF_ID,
//       key L.DOC_REF_ITEM,
//       H.TOTAL_CREDIT_AMOUNT,
//       H.SAP_REF_DOCUMENT,
//       H.COMPANY_CODE,
//       H.MOBI_PORTAL_CODE,
//       H.PAYMENT_TYPE,
//       H.PAYMENT_SUB_TYPE,

//       L.MERCHANT_ID,
//       L.SAP_SUPPLIER_NUMBER,
//       L.SAP_CUSTOMER_NUMBER,

//       H.POSTING_DATE,
//       H.DOCUMENT_DATE,
//       H.BASELINE_DATE,

//       L.HOST_NAME,
//       H.CURRENCY,

//       L.HOST_MDR_AMOUNT,
//       L.HOST_FEE_PAYABLE,
//       L.MDR_REVENUE,
//       L.AR_PAYIN,
//       L.AP_PAYIN,
//       L.AP_PAYOUT,
//       L.TRANSACTION_AMOUNT,

//       L.GL_ACCOUNT,
//       L.DEBIT_CREDIT_INDICATOR,
//       L.COST_CENTER,
//       L.PROFIT_CENTER,

//       H.DOCUMENT_TYPE,

//       H.POSTING_STATUS,
//       H.POST_DATE,
//       H.HTTP_STATUS,
//       H.ERROR_CODE,
//       H.ERROR_DETAIL,
//       H.RETRY_COUNT,

//       H.CREATED_BY,
//       H.CREATED_TIMESTAMP,
//       H.CHANGED_BY,
//       H.CHANGED_TIMESTAMP
//   }

//   type DomesticSettlementConsolidationRunResult {
//     scenario            : String(40);
//     dryRun              : Boolean;
//     inputTransactions   : Integer;
//     skippedTransactions : Integer;
//     glAccountMissing    : Integer;
//     bpMasterMissing     : Integer;
//     errorRecordsUpdated : Integer;
//     headersCreated      : Integer;
//     lineItemsCreated    : Integer;
//     transactionsUpdated : Integer;
//     consolRefIds        : String(5000);
//     message             : String(500);
//   }

//   type DomesticSettlementPostingUpdateResult {
//     consolRefId     : String(50);
//     postingStatus   : String(20);
//     sapRefDocument  : String(20);
//     message         : String(500);
//   }

//   action runDomesticSettlementConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns DomesticSettlementConsolidationRunResult;

//   action updateDomesticSettlementPostingResult(
//     consolRefId    : String(50),
//     sapRefDocument : String(20),
//     postingStatus  : String(20),
//     httpStatus     : Integer,
//     errorCode      : String(20),
//     errorDetail    : String(255)
//   ) returns DomesticSettlementPostingUpdateResult;
// }
