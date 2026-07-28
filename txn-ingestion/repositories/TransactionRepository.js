const cds = require('@sap/cds');
const { SELECT, INSERT } = cds.ql;

class TransactionRepository {
  async existsByMobiReferenceId(mobiReferenceId) {
    const db = await cds.connect.to('db');
    return !!(await db.run(
      SELECT.one.from('mobi.db.MOBI_DB_TRANSACTION')
        .columns('MOBI_REFERENCE_ID')
        .where({ MOBI_REFERENCE_ID: mobiReferenceId })
    ));
  }

  async existsHostReferenceOnEitherDate(hostReferenceId, createdDate, paidDate) {
    if (!hostReferenceId) return false;
    const days = new Set([createdDate, paidDate].filter(Boolean).map((v) => String(v).slice(0, 10)));
    if (!days.size) return false;

    const db = await cds.connect.to('db');
    const rows = await db.run(
      SELECT.from('mobi.db.MOBI_DB_TRANSACTION')
        .columns('TXN_CREATED_DATE', 'TXN_PAID_DATE')
        .where({ HOST_REFERENCE_ID: hostReferenceId })
    );

    return (rows || []).some((row) =>
      [row.TXN_CREATED_DATE, row.TXN_PAID_DATE].filter(Boolean)
        .some((v) => days.has(String(v).slice(0, 10)))
    );
  }

  async insertBatch(records, { chunkSize = Number(process.env.DB_CHUNK_SIZE || 2000) } = {}) {
    if (!records.length) return;
    const db = await cds.connect.to('db');
    for (let i = 0; i < records.length; i += chunkSize) {
      await db.run(INSERT.into('mobi.db.MOBI_DB_TRANSACTION').entries(records.slice(i, i + chunkSize)));
    }
  }
}

module.exports = TransactionRepository;
