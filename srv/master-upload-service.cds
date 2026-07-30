using { mobi.db as db } from '../db/schema';

/**
 * MasterUploadService
 * ------------------------------------------------------------------
 * SEPARATE service for the "Master BP Upload" UI app only.
 * Your existing IngestionMasterService is NOT touched by this app.
 *
 * Endpoint:  /odata/v4/master-upload
 *
 * Purpose: manual upload of merchants whose BP number was ALREADY
 * created in SAP Public Cloud. Inserts into MOBI_DB_MASTER with
 * STATUS_CODE '063' (BP_CREATED_SUCCESS) so CPI skips these records.
 */
service MasterUploadService @(path : '/master-upload') {

  /* read-only views (handy for verification/monitoring screens) */
  @readonly
  entity Master    as projection on db.MOBI_DB_MASTER;

  @readonly
  entity FileLogs  as projection on db.MOBI_DB_FILELOG;

  function getStatus() returns String;

  /* ------------------------------------------------------------------ */
  /* Upload action called by the Master BP Upload app                    */
  /* fileName : name of the uploaded Excel (traceability/audit only)     */
  /* records  : rows parsed on the UI (DB-style field names)             */
  /* ------------------------------------------------------------------ */
  action uploadMasterRecords(
    fileName : String(100),
    records  : array of {
      MOBI_PORTAL_CODE    : String(2);
      SAP_COMPANY_CODE    : String(4);
      ID                  : String(20);
      EXTERNAL_BP_NUMBER  : String(20);
      BP_NUMBER           : String(10);
      TYPE                : String(20);
      MASTER_NAME         : String(40);
      ADDRESS1            : String(255);
      POSTAL_CODE         : String(10);
      COUNTRY             : String(80);
      COUNTRY_CODE        : String(2);
      BUSINESS_REG_NO_TIN : String(50);
      HOST_NAME           : String(15);
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
