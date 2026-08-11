// 'use strict';

// const BaseScenarioBuilder = require('./BaseScenarioBuilder');
// const AmountUtil = require('../utils/AmountUtil');
// const Constants = require('../constants/ConsolidationConstants');

// class DomesticSettlementConsolidationBuilder extends BaseScenarioBuilder {
//   async buildDocuments(records, options, context) {
//     const documents = [];
//     const unbalanced = [];

//     for (const record of records) {
//       const companyCode = this.getCompanyCode(record);
//       const postingDate = this.getPostingDate(record, options);

//       const consolRefId = await context.referenceNumberService.nextConsolRefId(this.scenario, companyCode, postingDate);
//       const sapRefDocument = '';

//       const amount = AmountUtil.isNonZero(record[this.scenario.amountField])
//         ? AmountUtil.round2(record[this.scenario.amountField])
//         : AmountUtil.round2(record.TXN_AMOUNT);

//       const merchant = context.resolveMerchantBp(record, this.scenario);
//       const supplierNumber = (merchant && typeof merchant === 'object') ? merchant.bpNumber : merchant;

//       const lineItems = [];
//       const clearingGl = context.resolveGlAccount(record, 'TXN_AMOUNT');

//       // SAMPLE ordering kept for backwards compatibility; default is GL-debit first.
//       if (this.scenario.domesticLineOrder === 'SAMPLE') {
//         lineItems.push(this.createLineItem({
//           consolRefId, sapRefDocument, docRefItem: 1, baseRecord: record, amount,
//           amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
//           glAccount: clearingGl, merchantId: '', hostName: '', options
//         }));
//         lineItems.push(this.createLineItem({
//           consolRefId, sapRefDocument, docRefItem: 2, baseRecord: record, amount,
//           amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
//           supplierNumber, merchantId: record.MERCHANT_ID, hostName: '', options
//         }));
//       } else {
//         lineItems.push(this.createLineItem({
//           consolRefId, sapRefDocument, docRefItem: 1, baseRecord: record, amount,
//           amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
//           supplierNumber, merchantId: record.MERCHANT_ID, hostName: '', options
//         }));
//         lineItems.push(this.createLineItem({
//           consolRefId, sapRefDocument, docRefItem: 2, baseRecord: record, amount,
//           amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
//           glAccount: clearingGl, merchantId: '', hostName: '', options
//         }));
//       }

//       const totals = this.totalsFromLineItems(lineItems);
//       const header = this.createHeader({ consolRefId, sapRefDocument, groupRows: [record], totals, options });
//       const document = { header, lineItems, sourceTransactions: [record] };

//       this.validateBalanced(document);
//       documents.push(document);
//     }

//     return documents;
//   }
// }

// module.exports = DomesticSettlementConsolidationBuilder;

'use strict';

const BaseScenarioBuilder = require('./BaseScenarioBuilder');
const AmountUtil = require('../utils/AmountUtil');
const Constants = require('../constants/ConsolidationConstants');

class DomesticSettlementConsolidationBuilder extends BaseScenarioBuilder {
  async buildDocuments(records, options, context) {
    const documents = [];
    const unbalanced = [];

    for (const record of records) {
      const companyCode = this.getCompanyCode(record);
      const postingDate = this.getPostingDate(record, options);

      const consolRefId = await context.referenceNumberService.nextConsolRefId(this.scenario, companyCode, postingDate);
      const sapRefDocument = '';

      const amount = AmountUtil.isNonZero(record[this.scenario.amountField])
        ? AmountUtil.round2(record[this.scenario.amountField])
        : AmountUtil.round2(record.TXN_AMOUNT);

      const merchant = context.resolveMerchantBp(record, this.scenario);
      const supplierNumber = (merchant && typeof merchant === 'object') ? merchant.bpNumber : merchant;

      const lineItems = [];
      const clearingGl = context.resolveGlAccount(record, 'TXN_AMOUNT');

      if (this.scenario.domesticLineOrder === 'SAMPLE') {
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: 1, baseRecord: record, amount,
          amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
          glAccount: clearingGl, merchantId: '', hostName: '', options
        }));
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: 2, baseRecord: record, amount,
          amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
          supplierNumber, merchantId: record.MERCHANT_ID, hostName: '', options
        }));
      } else {
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: 1, baseRecord: record, amount,
          amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
          supplierNumber, merchantId: record.MERCHANT_ID, hostName: '', options
        }));
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: 2, baseRecord: record, amount,
          amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
          glAccount: clearingGl, merchantId: '', hostName: '', options
        }));
      }

      const totals = this.totalsFromLineItems(lineItems);
      const header = this.createHeader({ consolRefId, sapRefDocument, groupRows: [record], totals, options });
      const document = { header, lineItems, sourceTransactions: [record] };

      if (this.isBalanced(document)) {
        documents.push(document);
      } else {
        unbalanced.push(document);
      }
    }

    return { documents, unbalanced };
  }
}

module.exports = DomesticSettlementConsolidationBuilder;
