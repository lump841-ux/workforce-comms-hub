'use strict';
const PLANS = Object.freeze({
  starter: Object.freeze({ code: 'starter', name: 'Starter', monthlyCents: 14900, activeWorkers: 25 }),
  growth: Object.freeze({ code: 'growth', name: 'Growth', monthlyCents: 39900, activeWorkers: 100 }),
  professional: Object.freeze({ code: 'professional', name: 'Professional', monthlyCents: 79900, activeWorkers: 250 }),
  enterprise: Object.freeze({ code: 'enterprise', name: 'Enterprise', monthlyCents: null, activeWorkers: null })
});
// Informational proposed prices, not Stripe Price IDs. No checkout in this module.
function publicCatalog() {
  return Object.values(PLANS).map(p => ({ ...p, currency: 'usd', interval: 'month', checkoutEnabled: false }));
}
module.exports = { PLANS, publicCatalog };
