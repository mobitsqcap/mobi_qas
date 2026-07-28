const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');
const Constants           = require('../master-ingestion/utils/Constants');
const StatusCodeUtil      = require('../master-ingestion/utils/StatusCodeUtil');
 
const SftpService         = require('../master-ingestion/services/SftpService');
const MasterCsvService    = require('../master-ingestion/services/MasterCsvService');
const MasterUpsertService = require('../master-ingestion/services/MasterUpsertService');
const FileHashService     = require('../master-ingestion/services/FileHashService');
 
const MasterRepository    = require('../master-ingestion/repositories/MasterRepository');
const FileLogRepository   = require('../master-ingestion/repositories/FileLogRepository');
const AuditRepository     = require('../master-ingestion/repositories/AuditRepository');
 
const ErrorFileHandler        = require('../master-ingestion/handlers/ErrorFileHandler');
const SuccessFileHandler      = require('../master-ingestion/handlers/SuccessFileHandler');
const MasterFileHandler       = require('../master-ingestion/handlers/MasterFileHandler');
const UnifiedIngestionHandler = require('../master-ingestion/handlers/UnifiedIngestionHandler');

module.exports = cds.service.impl(async function () {
  await StatusCodeUtil.ensureStatusTable();

  // ---------------------------------------------------------------
  // Repositories
  // ---------------------------------------------------------------
  const masterRepository  = new MasterRepository();
  const fileLogRepository = new FileLogRepository();
  const auditRepository   = new AuditRepository();

  // ---------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------
  // ONE shared SftpService instance - it caches the destination config and
  // the live connection, so every handler must receive THIS instance.
  const sftpService         = new SftpService();
  const masterCsvService    = new MasterCsvService();
  const masterUpsertService = new MasterUpsertService(masterRepository);
  const fileHashService     = new FileHashService(fileLogRepository);

  // ---------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------
  const errorFileHandler   = new ErrorFileHandler(sftpService);
  const successFileHandler = new SuccessFileHandler(sftpService);

  const masterFileHandler = new MasterFileHandler({
    sftpService,                       // <-- required by BaseFileHandler
    fileHashService,
    csvService: masterCsvService,
    masterUpsertService,
    masterRepository,
    fileLogRepository,
    auditRepository,
    successFileHandler,
    errorFileHandler,
    systemUser: Constants.SYSTEM_USERS.SFTP,
    batchSize: Number(process.env.BATCH_SIZE || Constants.BATCH_SIZE)
  });

  const unifiedIngestionHandler = new UnifiedIngestionHandler({
    sftpService,                         
    errorFileHandler,
    fileLogRepository,
    auditRepository,
    masterFileHandler,
    masterRepository,
    masterCsvService
  });

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  const actorOf = (req) =>
    req?.user?.id || req?.user?.attr?.email || req?.user?.attr?.user_name || 'UNKNOWN_USER';

  this.on('getStatus', () => 'Master ingestion service is up');

  this.on('triggerMasterIngestion', async (req) => {
    sftpService.clearTrace();
    const runId = uuid();
    const actor = actorOf(req);

    try {
      const result = await unifiedIngestionHandler.handle({ actor, runId });
      return {
        filesProcessed: Number(result?.filesProcessed || 0),
        message: 'Master batch ingestion cycle completed successfully.',
        logs: [...sftpService.getTrace(), ...(result?.logs || [])]
      };
    } catch (error) {
      console.error(`[IngestionMasterService] ${error.stack || error.message}`);
      return {
        filesProcessed: 0,
        message: `Master ingestion failed: ${error.message}`,
        logs: [...sftpService.getTrace(), `Master ingestion failed: ${error.message}`]
      };
    } finally {
      try { await sftpService.disconnect(); } catch (_) { /* ignore */ }
    }
  });
  // Add this inside the cds.service.impl block in IngestionMasterService.js

// this.on('replicateMasterStatusToAudit', async (req) => {
//     const data = req.data || {};
    
//     if (!data.ID) {
//         return req.error(400, "ID is required");
//     }

//     try {
//         // 1. Update Master Table
//         const masterUpdated = await masterRepository.updateMasterStatus(data);
        
//         // 2. Update Audit Table (Only if failure)
//         const auditUpdated = await auditRepository.updateRecordAuditFromMaster(data);

//         return {
//             updated: masterUpdated || 1,
//             message: `Master record ${data.ID} updated. Audit replication: ${auditUpdated ? 'Success' : 'Skipped/No Row'}`,
//             merchantId: data.ID,
//             BP_NUMBER: data.BP_NUMBER
//         };
//     } catch (err) {
//         console.error('[IngestionMasterService] Error:', err);
//         return req.error(500, `Failed to replicate: ${err.message}`);
//     }
// });
this.on('replicateMasterStatusToAudit', async (req) => {
    const items = req.data.items ;
    if (!items.length) return { updatedCount: 0, message: "No items provided" };

    try {
        // 1. Bulk Update Master Table
        const masterCount = await masterRepository.updateMasterStatusBatch(items);
        
        // 2. Bulk Update Audit Table (Failures only)
        const auditCount = await auditRepository.updateRecordAuditFromMasterBatch(items);

        return {
            updatedCount: masterCount,
            message: `Processed ${items.length} records. Master updated: ${masterCount}, Audit updated: ${auditCount}`
        };
    } catch (err) {
        console.error('[IngestionMasterService] Batch Error:', err);
        return req.error(500, `Batch update failed: ${err.message}`);
    }
});
  this.on('lookupMerchant', async (req) => {
    const { portalCode, companyCode, merchantId } = req.data || {};
    const row = await masterRepository.findActive(portalCode, companyCode, merchantId);
    if (!row) return { found: false, countryCode: null, merchantName: null, activeFlag: null };
    return {
      found: true,
      countryCode:  row.COUNTRY_CODE  || null,
      merchantName: row.MASTER_NAME   || null,
      activeFlag:   row.ACTIVE_FLAG   || null
    };
  });
});
