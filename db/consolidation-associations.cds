using { mobi.db as db } from './schema';

// Domain relationship for consolidation documents.
// No new database column is required because both tables already share CONSOL_REF_ID.
extend entity db.MOBI_DB_CONSOLIDATIONHEADER with {
  items : Association to many db.MOBI_DB_CONSOLIDATIONLINEITEM
    on items.CONSOL_REF_ID = CONSOL_REF_ID;
}

extend entity db.MOBI_DB_CONSOLIDATIONLINEITEM with {
  header : Association to db.MOBI_DB_CONSOLIDATIONHEADER
    on header.CONSOL_REF_ID = CONSOL_REF_ID;
}
