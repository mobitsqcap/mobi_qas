using { mobi.db as db } from '../db/schema';

service PayinConsolidationService {

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
        SAP_CUSTOMER_NUMBER    : String(10);
        POSTING_DATE           : Date;
        DOCUMENT_DATE          : Date;
        BASELINE_DATE          : Date;
        HOST_NAME              : String(15);
        CURRENCY               : String(3);
        HOST_MDR_AMOUNT        : Decimal(18,2);
        MDR_REVENUE            : Decimal(18,2);
        AR_PAYIN               : Decimal(18,2);
        AP_PAYIN               : Decimal(18,2);
        GL_ACCOUNT             : String(10);
        DEBIT_CREDIT_INDICATOR : String(1);
        COST_CENTER            : String(10);
        PROFIT_CENTER          : String(10);
        DOCUMENT_TYPE          : String(2);
        POSTING_STATUS         : String(20);
        CONSOL_STATUS          : String(20);
        POST_DATE              : Timestamp;
        HTTP_STATUS            : Integer;
        ERROR_CODE             : String(20);
        ERROR_DETAIL           : String(255);
        RETRY_COUNT            : Integer;
        CREATED_BY             : String(50);
        CREATED_TIMESTAMP      : Timestamp;
        CHANGED_BY             : String(50);
        CHANGED_TIMESTAMP      : Timestamp;
  }

  type PayinConsolidationRunResult {
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

  action runPayinConsolidation(
    companyCode  : String(4),
    postingDate  : Date,
    documentDate : Date,
    baselineDate : Date,
    dryRun       : Boolean
  ) returns PayinConsolidationRunResult;

  action updateBatchPostingResults(items : array of {
      consolRefId    : String(50);
      sapRefDocument : String(20);
      postingStatus  : String(20);
      httpStatus     : Integer;
      errorCode      : String(20);
      errorDetail    : String(255);
  }) returns array of {
      consolRefId    : String(50);
      status         : String(20);
      postingStatus  : String(20);
      message        : String(500);
  };
}








// using { mobi.db as db } from '../db/schema';

// service PayinConsolidationService {
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
//         SAP_CUSTOMER_NUMBER    : String(10);
//         POSTING_DATE           : Date;
//         DOCUMENT_DATE          : Date;
//         BASELINE_DATE          : Date;
//         HOST_NAME              : String(15);
//         CURRENCY               : String(3);
//         HOST_MDR_AMOUNT        : Decimal(18, 2);
//         MDR_REVENUE            : Decimal(18, 2);
//         AR_PAYIN               : Decimal(18, 2);
//         AP_PAYIN               : Decimal(18, 2);
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

//   type PayinConsolidationRunResult {
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

//   action runPayinConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns PayinConsolidationRunResult;
// }



















// using { mobi.db as db } from '../db/schema';

// service PayinConsolidationService {
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
//   entity PostingDocumentItems as projection on db.MOBI_DB_CONSOLIDATIONLINEITEM;
 

//   type PayinConsolidationRunResult {
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

//   type PayinPostingUpdateResult {
//     consolRefId     : String(50);
//     postingStatus   : String(20);
//     sapRefDocument  : String(20);
//     message         : String(500);
//   }

//   action runPayinConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns PayinConsolidationRunResult;

//   action updatePayinPostingResult(
//     consolRefId    : String(50),
//     sapRefDocument : String(20),
//     postingStatus  : String(20),
//     httpStatus     : Integer,
//     errorCode      : String(20),
//     errorDetail    : String(255)
//   ) returns PayinPostingUpdateResult;
// }







// using { mobi.db as db } from '../db/schema';

// service PayinConsolidationService {
//   //entity Headers as projection on db.MOBI_DB_CONSOLIDATIONHEADER;
//   entity LineItems as projection on db.MOBI_DB_CONSOLIDATIONLINEITEM;

//   type PayinConsolidationRunResult {
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

//   action runPayinConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns PayinConsolidationRunResult;
// }



// using { mobi.db as db } from '../db/schema';

// service PayinConsolidationService {
//     key CONSOL_REF_ID,
//     key DOC_REF_ITEM,
//         SAP_REF_DOCUMENT,
//         COMPANY_CODE,
//         MOBI_PORTAL_CODE,
//         PAYMENT_TYPE,
//         PAYMENT_SUB_TYPE,
//         MERCHANT_ID,
//         SAP_SUPPLIER_NUMBER,
//         SAP_CUSTOMER_NUMBER,
//         POSTING_DATE,
//         DOCUMENT_DATE,
//         BASELINE_DATE,
//         HOST_NAME,
//         CURRENCY,
//         HOST_MDR_AMOUNT,
//         MDR_REVENUE,
//         AR_PAYIN,
//         AP_PAYIN,
//         GL_ACCOUNT,
//         DEBIT_CREDIT_INDICATOR,
//         COST_CENTER,
//         PROFIT_CENTER,
//         DOCUMENT_TYPE,
//         POSTING_STATUS,
//         POSTING_STATUS as CONSOL_STATUS,
//         POST_DATE,
//         HTTP_STATUS,
//         ERROR_CODE,
//         ERROR_DETAIL,
//         RETRY_COUNT,
//         CREATED_BY,
//         CREATED_TIMESTAMP,
//         CHANGED_BY,
//         CHANGED_TIMESTAMP
//   } where PAYMENT_TYPE = 'PAYINS' or PAYMENT_TYPE = 'PAYIN';

//   type PayinConsolidationRunResult {
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

//   type PayinPostingUpdateResult {
//     consolRefId     : String(50);
//     postingStatus   : String(20);
//     sapRefDocument  : String(20);
//     message         : String(500);
//   }

//   action runPayinConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns PayinConsolidationRunResult;

//   action updatePayinPostingResult(
//     consolRefId    : String(50),
//     sapRefDocument : String(20),
//     postingStatus  : String(20),
//     httpStatus     : Integer,
//     errorCode      : String(20),
//     errorDetail    : String(255)
//   ) returns PayinPostingUpdateResult;
// }

// ********************************
// using { mobi.db as db } from '../db/schema';

// service PayinConsolidationService {
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
//         SAP_CUSTOMER_NUMBER    : String(10);
//         POSTING_DATE           : Date;
//         DOCUMENT_DATE          : Date;
//         BASELINE_DATE          : Date;
//         HOST_NAME              : String(15);
//         CURRENCY               : String(3);
//         HOST_MDR_AMOUNT        : Decimal(18, 2);
//         MDR_REVENUE            : Decimal(18, 2);
//         AR_PAYIN               : Decimal(18, 2);
//         AP_PAYIN               : Decimal(18, 2);
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

//   type PayinConsolidationRunResult {
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
// }