const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');

class SuccessFileHandler {
  constructor(sftpService) { this.sftpService = sftpService; }

  async handle(file, context) {
    const { processingPath, completedPath, case: c, validRecords } = context;
    if (!completedPath) {
      throw new Error(`Completed path missing for file ${file.name}. Please check SFTP folder configuration.`);
    }

    if (c === 'FULL') {
      await this.sftpService.moveFile(processingPath, completedPath);
      file.path = completedPath;
    } else if (c === 'PARTIAL') {
      const buffer = this._buildValidRecordsCsv(validRecords);
      await this.sftpService.uploadFile(completedPath, buffer);
    } else {
      throw new Error(`SuccessFileHandler: unknown case '${c}'`);
    }
  }

  _toSourceCsvRow(record) {
    const raw = record.RAW_ROW || {};
    return {
      mobi_portal_code:   raw.mobi_portal_code   ?? record.MOBI_PORTAL_CODE  ?? '',
      sap_company_code:   raw.sap_company_code   ?? record.COMPANY_CODE      ?? '',
      payment_type:       raw.payment_type       ?? record.PAYMENT_TYPE      ?? '',
      payment_sub_type:   raw.payment_sub_type   ?? record.PAYMENT_SUB_TYPE  ?? '',
      mobi_reference_id:  raw.mobi_reference_id  ?? record.MOBI_REFERENCE_ID ?? '',
      merchant_id:        raw.merchant_id        ?? record.MERCHANT_ID       ?? '',
      merchant_type:      raw.merchant_type      ?? record.MERCHANT_TYPE     ?? '',
      merchant_name:      raw.merchant_name      ?? record.MERCHANT_NAME     ?? '',
      txn_created_date:   raw.txn_created_date   ?? record.TXN_CREATED_DATE  ?? '',
      txn_paid_date:      raw.txn_paid_date      ?? record.TXN_PAID_DATE     ?? '',
      txn_time_created:   raw.txn_time_created   ?? record.TXN_CREATED_TIME  ?? '',
      txn_time_paid:      raw.txn_time_paid      ?? record.TXN_PAID_TIME     ?? '',
      payment_method:     raw.payment_method     ?? record.PAYMENT_METHOD    ?? '',
      host_name:          raw.host_name          ?? record.HOST_NAME         ?? '',
      transaction_amount: raw.transaction_amount ?? record.TXN_AMOUNT        ?? '',
      host_mdr_amount:    raw.host_mdr_amount    ?? record.HOST_MDR_AMOUNT   ?? '',
      host_fee_payable:   raw.host_fee_payable   ?? record.HOST_FEE_PAYABLE  ?? '',
      mobi_mdr_amount:    raw.mobi_mdr_amount    ?? record.MOBI_MDR_AMOUNT   ?? '',
      mdr_revenue:        raw.mdr_revenue        ?? record.MDR_REVENUE       ?? '',
      ar_payin:           raw.ar_payin           ?? record.AR_PAYIN          ?? '',
      ap_payin:           raw.ap_payin           ?? record.AP_PAYIN          ?? '',
      ap_payout:          raw.ap_payout          ?? record.AP_PAYOUT         ?? '',
      host_reference_id:  raw.host_reference_id  ?? record.HOST_REFERENCE_ID ?? '',
      merchant_reference_id: raw.merchant_reference_id ?? record.MERCHANT_REFERENCE_ID ?? '',
      transaction_status: raw.transaction_status ?? record.TXN_STATUS_TEXT   ?? '',
      original_amount:    raw.original_amount    ?? record.ORIGINAL_AMOUNT   ?? '',
      transaction_currency: raw.transaction_currency ?? record.TXN_CURRENCY ?? '',
      settled_in_currency: raw.settled_in_currency ?? record.SETTLED_IN_CURRENCY ?? '',
      time_zone:          raw.time_zone          ?? record.TIME_ZONE         ?? '',
      conversion_rate:    raw.conversion_rate    ?? record.CONVERSION_RATE   ?? ''
    };
  }

  _buildValidRecordsCsv(valid) {
    const headers = Constants.TRANSACTION_CSV_COLUMNS;
    return Buffer.from(CsvUtil.serialize(headers, valid.map((r) => this._toSourceCsvRow(r))), 'utf-8');
  }
}

module.exports = SuccessFileHandler;
