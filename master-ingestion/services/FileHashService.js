class FileHashService {
  constructor(fileLogRepository) { this.fileLogRepository = fileLogRepository; }

  async isDuplicateFile(hash) {
    const existing = await this.fileLogRepository.findByHash(hash);
    return !!existing && ['03', '04'].includes(existing.STATUS_CODE);   // COMPLETED/PARTIALLY_PROCESSED
  }
}

module.exports = FileHashService;
