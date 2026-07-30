using { mobi.db as db } from '../db/schema';

/** Master-data API and master SFTP ingestion endpoint. */
service IngestionMasterService {
  entity Master     as projection on db.MOBI_DB_MASTER;
  entity FileLogs    as projection on db.MOBI_DB_FILELOG;
  entity FileBatches as projection on db.MOBI_DB_FILEBATCH;

  function getStatus() returns String;

  action triggerMasterIngestion() returns {
    filesProcessed : Integer;
    message        : String;
    logs           : array of String;
  };  
 action replicateMasterStatusToAudit(
      items : array of {
        ID              : String(20);
        BP_NUMBER       : String(20);
        POSTING_STATUS  : String(2);
        STATUS_CODE     : String(3);
        ERROR_DETAIL    : String(500);
    }
  ) returns {

    updated     : Integer;
    message     : String;
    merchantId  : String(20);
     BP_NUMBER       : String(20);         
  };
  action lookupMerchant(
    portalCode  : String(2),
    companyCode : String(4),
    merchantId  : String(20)
  ) returns {
    found        : Boolean;
    countryCode  : String(2);
    merchantName : String(40);
    activeFlag   : String(1);
  };
}
