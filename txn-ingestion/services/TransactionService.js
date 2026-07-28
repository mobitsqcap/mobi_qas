const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');

class TransactionService {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  /** Strip internal helper fields before writing to the DB. */
  _toDbRecord(record) {
    const { _ROW_NUMBER, RAW_ROW, ...dbRecord } = record;
    for (const k of Object.keys(dbRecord)) {
      if (dbRecord[k] === undefined) delete dbRecord[k];
    }
    return dbRecord;
  }

  async insertBatch(records) {
    if (!records.length) return;
    const now = DateUtil.nowTimestamp();
    const enriched = records.map((r) => ({
      ...this._toDbRecord(r),
      CREATED_BY: Constants.SYSTEM_USERS.SFTP,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: '',
      CHANGED_TIMESTAMP: ''
    }));
    await this.transactionRepository.insertBatch(enriched);
  }
}

module.exports = TransactionService;
