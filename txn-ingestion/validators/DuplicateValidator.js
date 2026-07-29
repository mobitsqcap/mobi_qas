// class DuplicateValidator {
//   constructor(transactionRepository) { this.transactionRepository = transactionRepository; }
//   async validate(record) {
//     const exists = await this.transactionRepository.exists(record.COMPANY_CODE, record.MOBI_REFERENCE_ID, record.PAYMENT_TYPE);
//     if (exists) return { valid: false, code: 'DUPLICATE_TRANSACTION', message: `Duplicate ${record.MOBI_REFERENCE_ID}` };
//     return { valid: true };
//   }
// }
// module.exports = DuplicateValidator;
class DuplicateValidator {
  constructor(transactionRepository) { this.transactionRepository = transactionRepository; }
  async validate(record) {
    if (await this.transactionRepository.existsByMobiReferenceId(record.MOBI_REFERENCE_ID)) {
      return { valid: false, code: 'DUPLICATE_MOBI_REFERENCE_ID', message: `MOBI reference ID already exists: ${record.MOBI_REFERENCE_ID}` };
    }
    if (await this.transactionRepository.existsHostReferenceOnEitherDate(record.HOST_REFERENCE_ID, record.TXN_CREATED_DATE, record.TXN_PAID_DATE)) {
      return { valid: false, code: 'DUPLICATE_HOST_REFERENCE_ID', message: `Host reference ID already exists on the same transaction day: ${record.HOST_REFERENCE_ID}` };
    }
    return { valid: true };
  }
}
module.exports = DuplicateValidator;
