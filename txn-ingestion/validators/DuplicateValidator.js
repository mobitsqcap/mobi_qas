const Constants = require('../utils/Constants');
const F = require('../utils/StatusCodeUtil').FRIENDLY;

class DuplicateValidator {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async validate(record) {
    const errors = [];

    if (await this.transactionRepository.existsByMobiReferenceId(record.MOBI_REFERENCE_ID)) {
      errors.push({
        code: Constants.ERROR_CODES.DUPLICATE_MOBI_REF,
        message: F.duplicateMobiRefDb(record.MOBI_REFERENCE_ID)
      });
    }

    if (await this.transactionRepository.existsHostReferenceOnEitherDate(
      record.HOST_REFERENCE_ID, record.TXN_CREATED_DATE, record.TXN_PAID_DATE)) {
      errors.push({
        code: Constants.ERROR_CODES.DUPLICATE_HOST_REF,
        message: F.duplicateHostRefDb(record.HOST_REFERENCE_ID)
      });
    }

    if (errors.length === 0) return { valid: true, errors: [] };
    return { valid: false, errors };
  }
}

module.exports = DuplicateValidator;
