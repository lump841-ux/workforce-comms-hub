'use strict';
const { quote, CONTRACTS } = require('./billingQuote');

function orderSummary(tier, term) {
  const q = quote(tier, term);
  return {
    version: 'agency-order-preview-v1',
    provider: 'Twanova LLC',
    customerType: 'staffing_agency',
    workerAccessFeeCents: 0,
    clientSupervisorAccessFeeCents: 0,
    tier: q.tier,
    capacity: { min: q.minActiveWorkers, max: q.maxActiveWorkers },
    contract: {
      code: term,
      name: CONTRACTS[term].label,
      minimumMonths: q.commitmentMonths,
      renewalAndCancellation: 'PENDING_LEGAL_APPROVAL'
    },
    charges: {
      dueOnSignupCents: q.setupFeeCents,
      dueOnSignupType: 'one_time_connection_and_onboarding',
      subscriptionMonthlyCents: q.monthlyCents,
      subscriptionFirstPayment: 'one_calendar_month_after_service_activation',
      firstPaymentDate: null,
      currency: 'usd',
      taxesAndAdditionalServices: 'EXCLUDED_FROM_PREVIEW'
    },
    minimumTermTotalCents: q.minimumTermTotalCents,
    status: 'PREVIEW_ONLY',
    canSign: false,
    canPay: false
  };
}
module.exports = { orderSummary };
