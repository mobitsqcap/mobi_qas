const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const Constants = require('../utils/Constants');

class MasterRepository {
  async findActiveByIds(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return [];
    const db = await cds.connect.to('db');
    return db.run(SELECT.from('mobi.db.MOBI_DB_MASTER').where({
      ID: { in: unique },
      ACTIVE_FLAG: Constants.ACTIVE_FLAG
    }));
  }

  async findActiveForValidation() {
    const db = await cds.connect.to('db');
    return db.run(SELECT.from('mobi.db.MOBI_DB_MASTER').where({
      ACTIVE_FLAG: Constants.ACTIVE_FLAG
    }));
  }
}

module.exports = MasterRepository;
