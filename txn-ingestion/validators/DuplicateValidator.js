'use strict';

const StatusCodeUtil = require('../utils/StatusCodeUtil');

class DuplicateValidator {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async prepare(records) {
    const mobiReferences = records.map((record) => record.MOBI_REFERENCE_ID).filter(Boolean);
    const hostReferences = records.map((record) => record.HOST_REFERENCE_ID).filter(Boolean);

    const [existingMobi, existingHostRows] = await Promise.all([
      this.transactionRepository.findExistingMobiReferenceIds(mobiReferences),
      this.transactionRepository.findHostReferenceDates(hostReferences)
    ]);

    const hostDays = new Set();
    for (const row of existingHostRows) {
      for (const date of [row.TXN_CREATED_DATE, row.TXN_PAID_DATE].filter(Boolean)) {
        hostDays.add(this._hostDay(row.HOST_REFERENCE_ID, date));
      }
    }

    return { existingMobi, hostDays };
  }

  validate(record, prepared) {
    const errors = [];

    if (record.MOBI_REFERENCE_ID && prepared.existingMobi.has(record.MOBI_REFERENCE_ID)) {
      errors.push({
        code: StatusCodeUtil.toCode('MOBI_REFERENCE_EXISTS'),
        message: StatusCodeUtil.FRIENDLY.duplicateMobiRefDb(record.MOBI_REFERENCE_ID)
      });
    }

    if (record.HOST_REFERENCE_ID) {
      const days = [record.TXN_CREATED_DATE, record.TXN_PAID_DATE].filter(Boolean);
      if (days.some((date) => prepared.hostDays.has(this._hostDay(record.HOST_REFERENCE_ID, date)))) {
        errors.push({
          code: StatusCodeUtil.toCode('HOST_REFERENCE_EXISTS'),
          message: StatusCodeUtil.FRIENDLY.duplicateHostRefDb(record.HOST_REFERENCE_ID)
        });
      }
    }

    return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
  }

  _hostDay(reference, date) {
    return `${String(reference || '').trim()}|${String(date || '').slice(0, 10)}`;
  }
}

module.exports = DuplicateValidator;
