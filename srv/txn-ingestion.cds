using { mobi.db as db } from '../db/schema';

/** Transaction-only SFTP ingestion API. */
service IngestiontxnService {

  entity Audit       as projection on db.MOBI_DB_AUDIT;
  entity FileLogs    as projection on db.MOBI_DB_FILELOG;
  entity FileBatches as projection on db.MOBI_DB_FILEBATCH;

  function getStatus() returns String;

  action triggerTransactionIngestion() returns {
    filesProcessed : Integer;
    message        : String;
    logs           : array of String;
  };
}
