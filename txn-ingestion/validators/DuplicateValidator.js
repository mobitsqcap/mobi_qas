'use strict';

const StatusCodeUtil = require('../utils/StatusCodeUtil');

class DuplicateValidator {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async prepare(records) {
    const mobiReferences = records.map((record) => record.MOBI_REFERENCE_ID).filter(Boolean);

    const [existingMobi] = await Promise.all([
      this.transactionRepository.findExistingMobiReferenceIds(mobiReferences)
    ]);

    return { existingMobi, hostDays: new Set() };
  }

  validate(record, prepared) {
    const errors = [];

    if (record.MOBI_REFERENCE_ID && prepared.existingMobi.has(record.MOBI_REFERENCE_ID)) {
      errors.push({
        code: StatusCodeUtil.toCode('MOBI_REFERENCE_EXISTS'),
        message: StatusCodeUtil.FRIENDLY.duplicateMobiRefDb(record.MOBI_REFERENCE_ID)
      });
    }

    return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
  }

  _hostDay(reference, date) {
    return `${String(reference || '').trim()}|${String(date || '').slice(0, 10)}`;
  }
}

module.exports = DuplicateValidator;
