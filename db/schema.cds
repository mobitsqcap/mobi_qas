namespace mobi.db;

entity MOBI_DB_STATUS {
    key CATEGORY    : String(20); // e.g. 'MASTER', 'TRANSACTION', 'CONSOL', 'FILE', 'POSTING'
    key CODE        : String(2); // 2-digit/2-char code ('01','02',...)
        DESCRIPTION : String(100); // human readable text
}

entity MOBI_DB_AUDIT {
    key AUDIT_ID          : String(36);
        RUN_ID            : String(50);
        FILE_NAME         : String(100);
        STATUS            : String(30); // Text status (for UI/Ops)
        STATUS_CODE       : String(2); // 2-digit code from MOBI_DB_STATUS
        TOTAL_RECORDS     : Integer;
        SUCCESS_COUNT     : Integer;
        ERROR_COUNT       : Integer;
        ERROR_CODE        : String(10); // 2-digit error code
        ERROR_DETAIL      : String(500); // Human-readable detail
        PROCESS_START_AT  : Timestamp;
        PROCESS_END_AT    : Timestamp;
        CONSOL_REF_ID     : String(50);
        MOBI_REFERENCE_ID : String(100);
        COMPANY_CODE      : String(4);
        MOBI_PORTAL_CODE  : String(2);
        PAYMENT_TYPE      : String(20);
        PAYMENT_SUB_TYPE  : String(30);
        MERCHANT_ID       : String(20);
        HOST_NAME         : String(15);
        MASTER_NAME       : String(40);
        ERROR_FILE_PATH   : String(500); // path to generated error artifact
        CREATED_BY        : String(100);
        CREATED_TIMESTAMP : Timestamp;
        CHANGED_BY        : String(100);
        CHANGED_TIMESTAMP : Timestamp;
}

entity MOBI_DB_MASTER {
    key ID                          : String(20);
        AUDIT_ID                    : String(36);
        MOBI_PORTAL_CODE            : String(2);
        SAP_COMPANY_CODE            : String(4);
        TYPE                        : String(20);
        ADDRESS1                    : String(255);
        POSTAL_CODE                 : String(10);
        COUNTRY                     : String(80);
        COUNTRY_CODE                : String(2);
        BUSINESS_REG_NO_TIN         : String(50);
        MASTER_NAME                 : String(40);
        EXTERNAL_BP_NUMBER          : String(20);
        BP_NUMBER                   : String(10);
        CONSOLIDATED                : String(4);
        NAME                        : String(40);
        STREET                      : String(60);
        COUNTRY_REGION              : String(10);
        BP_TAX_LONG_NUMBER          : String(50);
        LANGUAGE                    : String(2);
        RECONCILIATION_ACCOUNT      : String(10);
        CHECK_DUPLICATE_INVOICE_IND : String(1);
        PURCHASING_ORGANIZATION     : String(4);
        GR_BASED_INVOICE_IND        : String(1);
        BUSINESS_PARTNER_CATEGORY   : String(1);
        BUSINESS_PARTNER_ROLE       : String(20);
        SALES_ORGANIZATION          : String(4);
        ACTIVE_FLAG                 : String(1); // 'X' when active; STATUS_CODE below drives state
        POSTING_STATUS              : String(2); // '01'=ACTIVE (see MOBI_DB_STATUS)
        STATUS_CODE                 : String(2); // 2-digit status code
        FILE_ID                     : String(64);
        FILE_NAME                   : String(100);
        RECORD_NUMBER               : Integer;
        BP_CREATION_DATE            : Timestamp;
        CREATED_BY                  : String(100);
        CREATED_TIMESTAMP           : Timestamp;
        CHANGED_BY                  : String(100);
        CHANGED_TIMESTAMP           : Timestamp;
}

entity MOBI_DB_TRANSACTION {
    key COMPANY_CODE          : String(4);
    key MOBI_REFERENCE_ID     : String(100);
    key PAYMENT_TYPE          : String(20);
        AUDIT_ID              : String(36);
        MOBI_PORTAL_CODE      : String(2);
        MERCHANT_ID           : String(20);
        MERCHANT_TYPE         : String(50);
        MERCHANT_NAME         : String(100);
        TXN_CREATED_DATE      : Date;
        TXN_PAID_DATE         : Date;
        TXN_CREATED_TIME      : Time;
        TXN_PAID_TIME         : Time;
        TIME_ZONE             : String(3);
        PAYMENT_SUB_TYPE      : String(30);
        PAYMENT_METHOD        : String(15);
        HOST_NAME             : String(15);
        TXN_CURRENCY          : String(3);
        TXN_AMOUNT            : Decimal(18, 2);
        HOST_MDR_AMOUNT       : Decimal(18, 2);
        HOST_FEE_PAYABLE      : Decimal(18, 2);
        MOBI_MDR_AMOUNT       : Decimal(18, 2);
        MDR_REVENUE           : Decimal(18, 2);
        AR_PAYIN              : Decimal(18, 2);
        AP_PAYIN              : Decimal(18, 2);
        AP_PAYOUT             : Decimal(18, 2);
        HOST_REFERENCE_ID     : String(100);
        MERCHANT_REFERENCE_ID : String(100);
        TXN_STATUS            : String(2); // 2-digit code (01=SUCCESS,...)
        TXN_STATUS_TEXT       : String(15); // kept for read/debug
        ORIGINAL_AMOUNT       : Decimal(18, 2);
        SETTLED_IN_CURRENCY   : String(3);
        CONVERSION_RATE       : Decimal(20, 8);
        COUNTRY_CODE          : String(2);
        CONSOL_STATUS         : String(2); // 2-digit code (see consolidation constants)
        CONSOL_REF_ID         : String(50);
        ROW_STATUS            : String(2); // 2-digit code (VALID/INVALID/POSTED/FAILED)
        ERROR_CODE            : String(2); // 2-digit error code (comma-separated if multiple)
        ERROR_DETAIL          : String(500); // human-readable (all errors joined)
        CREATED_BY            : String(100);
        CREATED_TIMESTAMP     : Timestamp;
        CHANGED_BY            : String(100);
        CHANGED_TIMESTAMP     : Timestamp;
}

entity MOBI_DB_FILELOG {
    key AUDIT_ID          : String(36);
        FILE_ID           : String(64);
        FILE_NAME         : String(100);
        FILE_PATH         : String(200);
        FILE_SIZE_BYTES   : Integer;
        FILE_HASH         : String(64);
        ROW_COUNT_TOTAL   : Integer;
        ROW_COUNT_VALID   : Integer;
        ROW_COUNT_ERROR   : Integer;
        STATUS            : String(30); // text
        STATUS_CODE       : String(2); // 2-digit code
        ERROR_CODE        : String(10);
        ERROR_DETAIL      : String(500);
        RECEIVED_AT       : Timestamp;
        PROCESS_START_AT  : Timestamp;
        PROCESS_END_AT    : Timestamp;
        CREATED_BY        : String(100);
        CREATED_TIMESTAMP : Timestamp;
        CHANGED_BY        : String(100);
        CHANGED_TIMESTAMP : Timestamp;
}

entity MOBI_DB_FILEBATCH {
    key AUDIT_ID      : String(36);
    key BATCH_NO      : Integer;
        FILE_NAME     : String(100);
        START_INDEX   : Integer;
        END_INDEX     : Integer;
        STATUS        : String(30);
        STATUS_CODE   : String(2);
        TOTAL_RECORDS : Integer;
        SUCCESS_COUNT : Integer;
        ERROR_COUNT   : Integer;
        START_TIME    : Timestamp;
        END_TIME      : Timestamp;
        ERROR_DETAIL  : String(255);
}

entity MOBI_DB_CONSOLIDATIONHEADER {
    key CONSOL_REF_ID       : String(50);
        SAP_REF_DOCUMENT    : String(20);
        COMPANY_CODE        : String(4);
        MOBI_PORTAL_CODE    : String(2);
        PAYMENT_TYPE        : String(20);
        PAYMENT_SUB_TYPE    : String(30);
        DOCUMENT_TYPE       : String(2);
        POSTING_DATE        : Date;
        DOCUMENT_DATE       : Date;
        BASELINE_DATE       : Date;
        TOTAL_DEBIT_AMOUNT  : Decimal(18, 2);
        TOTAL_CREDIT_AMOUNT : Decimal(18, 2);
        CURRENCY            : String(3);
        POSTING_STATUS      : String(2); // 2-digit code
        POST_DATE           : Timestamp;
        HTTP_STATUS         : Integer;
        ERROR_CODE          : String(2); // 2-digit code
        ERROR_DETAIL        : String(255);
        RETRY_COUNT         : Integer;
        CREATED_BY          : String(100);
        CREATED_TIMESTAMP   : Timestamp;
        CHANGED_BY          : String(100);
        CHANGED_TIMESTAMP   : Timestamp;
}

entity MOBI_DB_CONSOLIDATIONLINEITEM {
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
        AR_PAYIN               : Decimal(18, 2);
        AP_PAYIN               : Decimal(18, 2);
        AP_PAYOUT              : Decimal(18, 2);
        TRANSACTION_AMOUNT     : Decimal(18, 2);
        GL_ACCOUNT             : String(10);
        DEBIT_CREDIT_INDICATOR : String(1);
        COST_CENTER            : String(10);
        PROFIT_CENTER          : String(10);
        DOCUMENT_TYPE          : String(2);
        POSTING_STATUS         : String(2);
        POST_DATE              : Timestamp;
        HTTP_STATUS            : Integer;
        ERROR_CODE             : String(2);
        ERROR_DETAIL           : String(255);
        RETRY_COUNT            : Integer;
        CREATED_BY             : String(100);
        CREATED_TIMESTAMP      : Timestamp;
        CHANGED_BY             : String(100);
        CHANGED_TIMESTAMP      : Timestamp;
}

entity MOBI_DB_PROCESSING_LOCK {

    key LOCK_KEY     : String(120);

        LOCK_SCOPE   : String(40);


        RESOURCE     : String(200);


        OWNER_ID     : String(64);

        LOCK_ID      : String(36);

        STATUS       : String(16);

        ACQUIRED_AT  : Timestamp;


        EXPIRES_AT   : Timestamp;


        HEARTBEAT_AT : Timestamp;

}

entity MOBI_DB_GLAccounts {
    key GUID              : String(36);
    key GL_Accounts       : String(8);
        COMPANY_CODE      : String(4);
        PAYMENT_TYPE      : String(20);
        PAYMENT_SUB_TYPE  : String(30);
        HOST_NAME         : String(15);
        TXN_AMOUNT        : String(1);
        HOST_MDR_AMOUNT   : String(1);
        HOST_FEE_PAYABLE  : String(1);
        MOBI_MDR_AMOUNT   : String(1);
        MDR_REVENUE       : String(1);
        Status            : String(2); // 2-digit code (01=ACTIVE)
        CREATED_BY        : String(100);
        CREATED_TIMESTAMP : Timestamp;
        CHANGED_BY        : String(100);
        CHANGED_TIMESTAMP : Timestamp;
}
