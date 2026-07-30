const cds = require('@sap/cds');
const path = require('path');
const fs = require('fs');
/* ================================================================== */
/* Locate YOUR existing master-ingestion folder automatically.         */
/*                                                                     */
/* Works with BOTH layouts (nothing in your existing files changes):   */
/*   a) <root>/srv/master-ingestion/...        (folder inside srv)     */
/*   b) <root>/master-ingestion/...            (folder next to srv)    */
/*                                                                     */
/* IMPORTANT: copy MasterUploadService.js into YOUR existing services  */
/* folder (next to your MasterCsvService.js).                         */
/* ================================================================== */
function resolveIngestionBase() {
  const candidates = [
    path.join(__dirname, '..', 'master-ingestion'), // a) <root>/master-ingestion   (from srv/)
    path.join(__dirname, 'master-ingestion')        // b) <root>/srv/master-ingestion
  ];
  for (const dir of candidates) {
    // verify it is the REAL ingestion folder (contains your utils), not a stray copy
    if (fs.existsSync(path.join(dir, 'utils', 'StatusCodeUtil.js')) &&
        fs.existsSync(path.join(dir, 'services', 'MasterCsvService.js'))) {
      return dir;
    }
  }
  throw new Error(
    '[master-upload-service] Could not locate your master-ingestion folder. ' +
    'Looked for utils/StatusCodeUtil.js + services/MasterCsvService.js at: ' +
    candidates.join(' | ') +
    '. Adjust the paths above to match your project layout.'
  );
}

const INGESTION_BASE = resolveIngestionBase();
const load = (...p) => require(path.join(INGESTION_BASE, ...p));

const uploadServicePath = path.join(INGESTION_BASE, 'services', 'MasterUploadService.js');
if (!fs.existsSync(uploadServicePath)) {
  throw new Error(
    `[master-upload-service] MasterUploadService.js not found at ${uploadServicePath}. ` +
    'Please copy srv/master-ingestion/services/MasterUploadService.js from this package ' +
    'into YOUR master-ingestion/services/ folder (same folder as your MasterCsvService.js).'
  );
}

const StatusCodeUtil = require('../master-ingestion/utils/StatusCodeUtil');
const MasterRepository = require('../master-ingestion/repositories/MasterRepository');
const FileLogRepository = require('../master-ingestion/repositories/FileLogRepository');
const AuditRepository = require('../master-ingestion/repositories/AuditRepository');
const MasterUploadService = require('../master-ingestion/services/MasterUploadService');

/**
 * Separate service impl for the "Master BP Upload" UI app.
 * IngestionMasterService (SFTP ingestion) is completely independent of this.
 */
module.exports = cds.service.impl(async function () {

  await StatusCodeUtil.ensureStatusTable();

  // Repositories - reuse your existing master-ingestion classes
  const masterRepository = new MasterRepository();
  const fileLogRepository = new FileLogRepository();
  const auditRepository = new AuditRepository();

  // Upload engine (validation + insert + audit)
  const masterUploadService = new MasterUploadService({
    masterRepository,
    fileLogRepository,
    auditRepository
  });

  const actorOf = (req) =>
    req?.user?.id || req?.user?.attr?.email || req?.user?.attr?.user_name || 'UNKNOWN_USER';

  this.on('getStatus', () => 'Master BP upload service is up');

  /**
   * uploadMasterRecords
   * Inserts manually maintained (already-created) BP numbers into
   * MOBI_DB_MASTER with STATUS_CODE '063' so CPI skips them.
   */
  this.on('uploadMasterRecords', async (req) => {
    const { fileName, records } = req.data || {};
    const actor = actorOf(req);

    if (!Array.isArray(records) || records.length === 0) {
      return req.error(400, 'No records provided. Please upload a file with at least one data row.');
    }

    // hard safety cap so one UI upload cannot overload HANA/CPI
    const maxRows = Number(process.env.UI_UPLOAD_MAX_ROWS || 5000);
    if (records.length > maxRows) {
      return req.error(400, `Too many records (${records.length}). Maximum allowed per upload is ${maxRows}.`);
    }

    try {
      const result = await masterUploadService.processUpload({
        records,
        fileName: fileName || 'Master_BP_Upload.xlsx',
        actor
      });
      return result;
    } catch (err) {
      console.error(`[MasterUploadService] uploadMasterRecords failed: ${err.stack || err.message}`);
      return req.error(err.code && /^\d+$/.test(String(err.code)) ? 400 : 500, err.message);
    }
  });

});
