'use strict';
// October 15 approved agency size / contract price schedule.
// Quoted USD cents, per month; contract duration in months.
const SETUP_FEE_CENTS = 149900;
const PLANS = Object.freeze({
  "tier_1": {
    "code": "tier_1",
    "minActiveWorkers": 1,
    "maxActiveWorkers": 200,
    "flexMonthlyCents": 34900,
    "sixMonthMonthlyCents": 29900,
    "twelveMonthMonthlyCents": 24900
  },
  "tier_2": {
    "code": "tier_2",
    "minActiveWorkers": 201,
    "maxActiveWorkers": 500,
    "flexMonthlyCents": 64900,
    "sixMonthMonthlyCents": 59900,
    "twelveMonthMonthlyCents": 54900
  },
  "tier_3": {
    "code": "tier_3",
    "minActiveWorkers": 501,
    "maxActiveWorkers": 1000,
    "flexMonthlyCents": 109900,
    "sixMonthMonthlyCents": 99900,
    "twelveMonthMonthlyCents": 89900
  },
  "tier_4": {
    "code": "tier_4",
    "minActiveWorkers": 1001,
    "maxActiveWorkers": 2000,
    "flexMonthlyCents": 199900,
    "sixMonthMonthlyCents": 179900,
    "twelveMonthMonthlyCents": 159900
  },
  "tier_5": {
    "code": "tier_5",
    "minActiveWorkers": 2001,
    "maxActiveWorkers": 3000,
    "flexMonthlyCents": 279900,
    "sixMonthMonthlyCents": 249900,
    "twelveMonthMonthlyCents": 219900
  },
  "tier_6": {
    "code": "tier_6",
    "minActiveWorkers": 3001,
    "maxActiveWorkers": 5000,
    "flexMonthlyCents": 449900,
    "sixMonthMonthlyCents": 399900,
    "twelveMonthMonthlyCents": 349900
  }
});
function publicCatalog() { return Object.values(PLANS).map(p=>({...p,setupFeeCents:SETUP_FEE_CENTS,currency:'usd',checkoutEnabled:false})); }
module.exports={PLANS,SETUP_FEE_CENTS,publicCatalog};
