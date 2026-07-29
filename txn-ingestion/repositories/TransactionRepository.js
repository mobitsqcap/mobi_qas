// const cds = require('@sap/cds');
// const { SELECT, INSERT } = cds.ql;

// class TransactionRepository {
//   async exists(companyCode, mobiReferenceId, paymentType) {
//     const db = await cds.connect.to('db');
//     const existing = await db.run(SELECT.one.from('mobi.db.MOBI_DB_TRANSACTION').columns('MOBI_REFERENCE_ID').where({ COMPANY_CODE: companyCode, MOBI_REFERENCE_ID: mobiReferenceId, PAYMENT_TYPE: paymentType }));
//     return !!existing;
//   }
//   async insertBatch(records) {
//     if (!records.length) return;
//     const db = await cds.connect.to('db');
//     await db.run(INSERT.into('mobi.db.MOBI_DB_TRANSACTION').entries(records));
//   }
// }
// module.exports = TransactionRepository;




// const cds = require('@sap/cds');
// const { SELECT, INSERT } = cds.ql;
// class TransactionRepository {
//   async existsByMobiReferenceId(mobiReferenceId) {
//     const db = await cds.connect.to('db');
//     return !!(await db.run(SELECT.one.from('mobi.db.MOBI_DB_TRANSACTION').columns('MOBI_REFERENCE_ID').where({ MOBI_REFERENCE_ID: mobiReferenceId })));
//   }
//   async existsHostReferenceOnEitherDate(hostReferenceId, createdDate, paidDate) {
//     if (!hostReferenceId) return false;
//     const db = await cds.connect.to('db');
//     const dates = [...new Set([createdDate, paidDate].filter(Boolean))];
//     if (!dates.length) return false;
//     // A duplicate is rejected if either its created date or paid date is one of this row's two dates.
//     const row = await db.run(SELECT.one.from('mobi.db.MOBI_DB_TRANSACTION').columns('HOST_REFERENCE_ID').where({
//       HOST_REFERENCE_ID: hostReferenceId,
//       or: [{ TXN_CREATED_DATE: { in: dates } }, { TXN_PAID_DATE: { in: dates } }]
//     }));
//     return !!row;
//   }
//   async insertBatch(records) {
//     if (!records.length) return;
//     const db = await cds.connect.to('db');
//     await db.run(INSERT.into('mobi.db.MOBI_DB_TRANSACTION').entries(records));
//   }
// }
// module.exports = TransactionRepository;




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
    const days = new Set([createdDate, paidDate].filter(Boolean).map((value) => String(value).slice(0, 10)));
    if (!days.size) return false;

    const db = await cds.connect.to('db');
    // Do not build an object-CQN `or` condition here. Some CAP/HANA versions render it
    // as invalid SQL (the source of the syntax error near '"'). Fetch only the matching
    // host reference rows, then safely compare the two dates in JavaScript.
    const rows = await db.run(
      SELECT.from('mobi.db.MOBI_DB_TRANSACTION')
        .columns('TXN_CREATED_DATE', 'TXN_PAID_DATE')
        .where({ HOST_REFERENCE_ID: hostReferenceId })
    );

    return (rows || []).some((row) =>
      [row.TXN_CREATED_DATE, row.TXN_PAID_DATE]
        .filter(Boolean)
        .some((value) => days.has(String(value).slice(0, 10)))
    );
  }

  async insertBatch(records) {
    if (!records.length) return;
    const db = await cds.connect.to('db');
    await db.run(INSERT.into('mobi.db.MOBI_DB_TRANSACTION').entries(records));
  }
}
module.exports = TransactionRepository;
