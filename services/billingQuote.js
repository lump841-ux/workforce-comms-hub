'use strict';
const { PLANS, SETUP_FEE_CENTS } = require('./pricingCatalog');
const CONTRACTS = Object.freeze({
  flex: Object.freeze({ months: null, rateField: 'flexMonthlyCents', label: 'Monthly Flex' }),
  six_month: Object.freeze({ months: 6, rateField: 'sixMonthMonthlyCents', label: '6-month commitment' }),
  twelve_month: Object.freeze({ months: 12, rateField: 'twelveMonthMonthlyCents', label: '12-month commitment' })
});
function quote(tier, term) {
  const plan=PLANS[tier], option=CONTRACTS[term];
  if (!plan || !option) throw new Error('Select a valid agency tier and contract option');
  const monthlyCents=plan[option.rateField];
  return {
    tier, term, minActiveWorkers:plan.minActiveWorkers,maxActiveWorkers:plan.maxActiveWorkers,
    monthlyCents,setupFeeCents:SETUP_FEE_CENTS,
    firstInvoiceCents:monthlyCents+SETUP_FEE_CENTS,
    commitmentMonths:option.months,
    minimumTermTotalCents:option.months===null?null:SETUP_FEE_CENTS+monthlyCents*option.months,
    currency:'usd', quoteOnly:true, checkoutEnabled:false
  };
}
module.exports={CONTRACTS,quote};
