// using { mobi.db as db } from '../db/schema';

// service PayoutConsolidationService {
// //  entity Headers as projection on db.MOBI_DB_CONSOLIDATIONHEADER;
//   entity LineItems as projection on db.MOBI_DB_CONSOLIDATIONLINEITEM;

//   type PayoutConsolidationRunResult {
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

//   action runPayoutConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns PayoutConsolidationRunResult;
// }
using { mobi.db as db } from '../db/schema';

service PayoutConsolidationService {
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
        HOST_MDR_AMOUNT        : Decimal(18, 2);
        HOST_FEE_PAYABLE       : Decimal(18, 2);
        MDR_REVENUE            : Decimal(18, 2);
        AP_PAYOUT              : Decimal(18, 2);
        TRANSACTION_AMOUNT     : Decimal(18, 2);
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

  type PayoutConsolidationRunResult {
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

  action runPayoutConsolidation(
    companyCode  : String(4),
    postingDate  : Date,
    documentDate : Date,
    baselineDate : Date,
    dryRun       : Boolean
  ) returns PayoutConsolidationRunResult;

  action updateBatchPostingResults(
    items : array of {
      consolRefId    : String(50);
      sapRefDocument : String(20);
      postingStatus  : String(20);
      httpStatus     : Integer;
      errorCode      : String(20);
      errorDetail    : String(255);
    }
  ) returns array of {
      consolRefId    : String(50);
      status         : String(20);
      postingStatus  : String(20);
      message        : String(500);
  };
}


// using { mobi.db as db } from '../db/schema';

// service PayoutConsolidationService {
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
//         HOST_FEE_PAYABLE       : Decimal(18, 2);
//         MDR_REVENUE            : Decimal(18, 2);
//         AP_PAYOUT              : Decimal(18, 2);
//         TRANSACTION_AMOUNT     : Decimal(18, 2);
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

//   type PayoutConsolidationRunResult {
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

//   action runPayoutConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns PayoutConsolidationRunResult;
//    action updateBatchPostingResults(
//     items : array of {
//       consolRefId    : String(50);
//       sapRefDocument : String(20);
//       postingStatus  : String(20);
//       httpStatus     : Integer;
//       errorCode      : String(20);
//       errorDetail    : String(255);
//     }
//   ) returns array of {
//       consolRefId    : String(50);
//       status         : String(20);
//       postingStatus  : String(20);
//       message        : String(500);
//   };
// }




// using { mobi.db as db } from '../db/schema';

// service PayoutConsolidationService {
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
//         SAP_CUSTOMER_NUMBER    : String(10);
//         POSTING_DATE           : Date;
//         DOCUMENT_DATE          : Date;
//         BASELINE_DATE          : Date;
//         HOST_NAME              : String(15);
//         CURRENCY               : String(3);
//         HOST_MDR_AMOUNT        : Decimal(18, 2);
//         HOST_FEE_PAYABLE       : Decimal(18, 2);
//         MDR_REVENUE            : Decimal(18, 2);
//         AP_PAYOUT              : Decimal(18, 2);
//         TRANSACTION_AMOUNT     : Decimal(18, 2);
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

//   type PayoutConsolidationRunResult {
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

//   type PayoutPostingUpdateResult {
//     consolRefId     : String(50);
//     postingStatus   : String(20);
//     sapRefDocument  : String(20);
//     message         : String(500);
//   }

//   action runPayoutConsolidation(
//     companyCode  : String(4),
//     postingDate  : Date,
//     documentDate : Date,
//     baselineDate : Date,
//     dryRun       : Boolean
//   ) returns PayoutConsolidationRunResult;

//   action updatePayoutPostingResult(
//     consolRefId    : String(50),
//     sapRefDocument : String(20),
//     postingStatus  : String(20),
//     httpStatus     : Integer,
//     errorCode      : String(20),
//     errorDetail    : String(255)
//   ) returns PayoutPostingUpdateResult;
// }
