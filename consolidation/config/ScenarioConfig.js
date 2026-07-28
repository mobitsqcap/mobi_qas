const Constants = require('../constants/ConsolidationConstants');

const aliases = (...values) => {
  const result = new Set();
  for (const v of values.flat()) {
    const t = String(v||'').trim(); if (!t) continue;
    result.add(t); result.add(t.toUpperCase()); result.add(t.toLowerCase());
  }
  return [...result];
};

const PAYIN_TYPE_ALIASES    = aliases('PAYIN','PAYINS','Payin','Payins');
const PAYOUT_TYPE_ALIASES   = aliases('PAYOUT','PAYOUTS','Payout','Payouts');
const PAYOUT_SUBTYPE_ALIASES= aliases('NORMAL','Normal');
const DS_SUBTYPE_ALIASES    = aliases(
  'DOMESTIC SETTLEMENT','Domestic Settlement','domestic settlement',
  'DOMESTIC_SETTLEMENT','Domestic_Settlement','DOMESTICSETTLEMENT','DomesticSettlement','DS'
);

module.exports = Object.freeze({
  PAYIN: {
    code:'PAYIN', displayName:'Payin', systemUser: Constants.SYSTEM_USERS.PAYIN,
    paymentTypeAliases: PAYIN_TYPE_ALIASES,
    paymentSubTypeAliases: PAYIN_TYPE_ALIASES,
    outputPaymentType:'PAYINS', outputPaymentSubType:'PAYINS',
    allowedCompanyCodes:['2000','3000'],
    retryableConsolStatuses:['01','04','05','06'],   // PENDING, GL_MISSING, BP_MISSING, FAILED
    groupMode: Constants.GROUP_MODE.DAILY,
    refToken:'PAYIN', documentType:'Z1',
    costCenterByCompany:  { '2000':'2014','3000':'3014' },
    profitCenterByCompany:{ '2000':'2000','3000':'3000' },
    postingStatus: Constants.POSTING_STATUS.POSTING_PENDING,
    requireMerchantBusinessPartner:true,
    requireHostCustomerNumber:true,
    requiredGlAccountFields:[
      { glFlagField:'HOST_MDR_AMOUNT', amountField:'HOST_MDR_AMOUNT' },
      { glFlagField:'MDR_REVENUE',    amountField:'MDR_REVENUE' }
    ]
  },
  PAYOUT: {
    code:'PAYOUT', displayName:'Payout', systemUser: Constants.SYSTEM_USERS.PAYOUT,
    paymentTypeAliases: PAYOUT_TYPE_ALIASES,
    paymentSubTypeAliases: PAYOUT_SUBTYPE_ALIASES,
    outputPaymentType:'PAYOUT', outputPaymentSubType:'NORMAL',
    allowedCompanyCodes:['2000','3000'],
    retryableConsolStatuses:['01','04','05','06'],
    groupMode: Constants.GROUP_MODE.DAILY,
    refToken:'PAYOUT', documentType:'Z2',
    costCenterByCompany:  { '2000':'2015','3000':'3015' },
    profitCenterByCompany:{ '2000':'2000','3000':'3000' },
    postingStatus: Constants.POSTING_STATUS.POSTING_PENDING,
    requireMerchantBusinessPartner:true,
    requireHostCustomerNumber:true,
    glPaymentSubTypeAliases: PAYOUT_SUBTYPE_ALIASES,
    requiredGlAccountFields:[
      { glFlagField:'HOST_MDR_AMOUNT',  amountField:'HOST_MDR_AMOUNT' },
      { glFlagField:'MDR_REVENUE',      amountField:'MDR_REVENUE' },
      { glFlagField:'TXN_AMOUNT',       amountField:'TXN_AMOUNT' },
      { glFlagField:'HOST_FEE_PAYABLE', amountField:'HOST_FEE_PAYABLE', fallbackAmountField:'HOST_MDR_AMOUNT' }
    ],
    lineBlockOrder:['HOST_COST','HOST_MDR_REVENUE','CLEAR_PAYOUT','MERCHANT_AP_PAYOUT','HOST_FEE_PAYABLE']
  },
  DOMESTIC_SETTLEMENT: {
    code:'DOMESTIC_SETTLEMENT', displayName:'Domestic Settlement',
    systemUser: Constants.SYSTEM_USERS.DOMESTIC_SETTLEMENT,
    paymentTypeAliases: PAYOUT_TYPE_ALIASES,
    paymentSubTypeAliases: DS_SUBTYPE_ALIASES,
    outputPaymentType:'PAYOUT', outputPaymentSubType:'DOMESTIC SETTLEMENT',
    allowedCompanyCodes:['2000'],
    retryableConsolStatuses:['01','04','05','06'],
    groupMode: Constants.GROUP_MODE.PER_TRANSACTION,
    refToken:'DOMESTICSETTLEMENT', documentType:'Z5',
    costCenterByCompany:  { '2000':'2016' },
    profitCenterByCompany:{ '2000':'2000' },
    postingStatus: Constants.POSTING_STATUS.POSTING_PENDING,
    requireMerchantBusinessPartner:true,
    requireHostCustomerNumber:false,
    amountField:'AP_PAYOUT',
    domesticLineOrder:'LOGIC_TEXT',
    requiredGlAccountFields:[
      { glFlagField:'TXN_AMOUNT', amountField:'AP_PAYOUT' }
    ]
  }
});
