using { mobi.db as db } from '../db/schema';

service IngestiontxnService {
  @readonly entity Audit       as projection on db.MOBI_DB_AUDIT;
  @readonly entity FileLogs    as projection on db.MOBI_DB_FILELOG;
  @readonly entity FileBatches as projection on db.MOBI_DB_FILEBATCH;

  function getStatus() returns String;

  action triggerTransactionIngestion() returns {
    filesProcessed : Integer;
    message        : String;
    logs           : array of String;
  };
}
