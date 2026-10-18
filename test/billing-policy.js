'use strict';
const assert = require('node:assert/strict');
const p = require('../services/billingPolicy');
assert.equal(p.isFreeAccessRole('temp'), true);
assert.equal(p.isFreeAccessRole('client_hr'), true);
assert.equal(p.isFreeAccessRole('owner'), false);
assert.equal(p.canManageBilling({ role: 'temp', agency_id: 'a1' }), false);
assert.equal(p.canManageBilling({ role: 'client_hr', agency_id: 'a1' }), false);
assert.equal(p.canManageBilling({ role: 'owner', agency_id: 'a1' }), true);
assert.equal(p.canManageBilling({ role: 'agency_admin', agency_id: 'a1' }), true);
assert.equal(p.canManageBilling({ role: 'agency_admin', agency_id: null }), false);
assert.equal(p.normalizeBillingStatus('active'), 'active');
assert.equal(p.normalizeBillingStatus('anything-else'), 'not_configured');
console.log('Billing policy assertions passed (no Stripe calls).');


const { PLANS, publicCatalog, SETUP_FEE_CENTS } = require('../services/pricingCatalog');
assert.equal(Object.keys(PLANS).length,6);
assert.equal(SETUP_FEE_CENTS,149900);
assert.equal(PLANS.tier_1.flexMonthlyCents,34900);
assert.equal(PLANS.tier_4.flexMonthlyCents,199900);
assert.equal(PLANS.tier_1.twelveMonthMonthlyCents,24900);
assert.equal(PLANS.tier_6.flexMonthlyCents,449900);
assert.equal(PLANS.tier_6.sixMonthMonthlyCents,399900);
assert.equal(PLANS.tier_6.twelveMonthMonthlyCents,349900);
assert.ok(publicCatalog().every(p=>p.checkoutEnabled===false));

const {quote}=require('../services/billingQuote');
assert.equal(quote('tier_1','flex').firstInvoiceCents,149900);
assert.equal(quote('tier_1','twelve_month').minimumTermTotalCents,448700);
assert.equal(quote('tier_4','flex').monthlyCents,199900);
assert.equal(quote('tier_6','six_month').monthlyCents,399900);
assert.equal(quote('tier_1','flex').checkoutEnabled,false);
assert.equal(quote('tier_1','flex').monthlyBillingStarts,'one_calendar_month_after_activation');
assert.throws(()=>quote('invalid','flex'));
