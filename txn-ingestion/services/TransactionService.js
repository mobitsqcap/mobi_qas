const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');

class TransactionService {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  _toDbRecord(record) {
    const { _ROW_NUMBER, _RAW_ROW, ...dbRecord } = record;
    for (const key of Object.keys(dbRecord)) {
      if (dbRecord[key] === undefined) delete dbRecord[key];
    }
    return dbRecord;
  }

  async insertBatch(records) {
    if (!records.length) return;

    const now = DateUtil.nowTimestamp();
    const enriched = records.map((record) => ({
      ...this._toDbRecord(record),
      CREATED_BY: Constants.SYSTEM_USERS.SFTP,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: Constants.SYSTEM_USERS.SFTP,
      CHANGED_TIMESTAMP: now
    }));

    await this.transactionRepository.insertBatch(enriched);
  }
}

module.exports = TransactionService;
