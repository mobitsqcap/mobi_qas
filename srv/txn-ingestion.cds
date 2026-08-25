using { mobi.db as db } from '../db/schema';

service IngestiontxnService {

  @readonly
  @restrict: [
    { grant: 'READ', to: 'Read' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity Audit as projection on db.MOBI_DB_AUDIT;

  @readonly
  @restrict: [
    { grant: 'READ', to: 'Read' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity FileLogs as projection on db.MOBI_DB_FILELOG;

  @readonly
  @restrict: [
    { grant: 'READ', to: 'Read' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity FileBatches as projection on db.MOBI_DB_FILEBATCH;

  function getStatus() returns String;

  action triggerTransactionIngestion() returns {
    filesProcessed : Integer;
    message        : String;
    logs           : array of String;
  };
}
