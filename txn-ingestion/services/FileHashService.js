class FileHashService {
  constructor(fileLogRepository) { this.fileLogRepository = fileLogRepository; }
  async isDuplicateFile(hash) {
    const existing = await this.fileLogRepository.findByHash(hash);
    return !!existing && ['COMPLETED', 'PARTIALLY_PROCESSED'].includes(existing.STATUS);
  }
}
module.exports = FileHashService;
