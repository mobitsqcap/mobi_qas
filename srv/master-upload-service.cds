using { mobi.db as db } from '../db/schema';


@requires: 'authenticated-user'
service MasterUploadService @(path : 'master-upload') {


    @restrict: [
        { grant: '*', to: 'AdminMasterBP' }
    ]
  entity Master as projection on db.MOBI_DB_MASTER;


  @readonly
  entity FileLogs  as projection on db.MOBI_DB_FILELOG;


  function getStatus() returns String;


  @requires: 'AdminMasterBP'
  action uploadMasterRecords(

    fileName : String(100),

    records  : array of {

      /* ---- core fields ---- */
      ID                        : String(20);
      AUDIT_ID                  : String(36); 
      MOBI_PORTAL_CODE          : String(2);
      SAP_COMPANY_CODE          : String(4);
      TYPE                      : String(20);
      ADDRESS1                  : String(255);
      POSTAL_CODE               : String(10);
      COUNTRY                   : String(80);
      COUNTRY_CODE              : String(2);
      BUSINESS_REG_NO_TIN       : String(50);
      MASTER_NAME               : String(40);
      EXTERNAL_BP_NUMBER        : String(20);
      BP_NUMBER                 : String(10);

      /* ---- optional master fields (filled = used, blank = derived) ---- */
      GROUPING                  : String(4);
      NAME                      : String(40);
      STREET                    : String(60);
      COUNTRY_REGION            : String(10);
      BP_TAX_LONG_NUMBER        : String(50);
      LANGUAGE                  : String(2);
      RECONCILIATION_ACCOUNT    : String(10);
      CHECK_DUPLICATE_INVOICE_IND : String(1);
      PURCHASING_ORGANIZATION   : String(4);
      GR_BASED_INVOICE_IND      : String(1);
      BUSINESS_PARTNER_CATEGORY : String(1);
      BUSINESS_PARTNER_ROLE     : String(20);
      SALES_ORGANIZATION        : String(4);
      ACTIVE_FLAG               : String(1);

     
      STATUS_CODE               : String(3);  
      FILE_ID                   : String(64);
      FILE_NAME                 : String(100);
      RECORD_NUMBER             : String(10); 
      BP_CREATION_DATE          : String(50); 

      ROW_NO                    : Integer;  

    }

  ) returns {

    totalRows  : Integer;
    validCount : Integer;
    errorCount : Integer;
    inserted   : Integer;
    message    : String;
    errors     : array of {
      rowNo       : Integer;
      id          : String(20);
      errorDetail : String(500);
    };

  };

}