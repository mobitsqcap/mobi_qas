module.exports = {
  PAYIN:               require('./PayinConsolidationBuilder'),
  PAYOUT:              require('./PayoutConsolidationBuilder'),
  DOMESTIC_SETTLEMENT: require('./DomesticSettlementConsolidationBuilder')
};
