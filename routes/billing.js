'use strict';
const express = require('express');
const { get } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { canManageBilling, normalizeBillingStatus } = require('../services/billingPolicy');
const { publicCatalog } = require('../services/pricingCatalog');
const { config, sdk, allowedPrice } = require('../services/stripeTest');
const router = express.Router();
router.use(requireAuth);

// Read-only setup/status. Stripe Checkout, webhooks and live subscriptions are
// intentionally disabled until plan prices and test-mode integration are approved.
router.get('/plans', (req, res) => {
  if (!canManageBilling(req.session.user)) return res.status(403).json({ error: 'Agency administrator access required' });
  res.json({ billing_model: 'agency_only', plans: publicCatalog(), checkout_enabled: config().enabled });
});

router.get('/status', (req, res) => {
  const user = req.session.user;
  if (!canManageBilling(user)) return res.status(403).json({ error: 'Agency administrator access required' });
  const row = get('SELECT plan_code, subscription_status, current_period_end FROM agency_billing WHERE agency_id = ?', [user.agency_id]);
  res.json({
    billing_model: 'agency_only',
    agency_id: user.agency_id,
    worker_access: 'free',
    client_supervisor_access: 'free',
    checkout_enabled: config().enabled,
    subscription_status: normalizeBillingStatus(row && row.subscription_status),
    plan_code: row ? row.plan_code : null,
    current_period_end: row ? row.current_period_end : null
  });
});

// Test-mode-only hosted checkout. Never trust an agency ID or Stripe price from the browser.
router.post('/test-checkout', async (req, res) => {
  if (!canManageBilling(req.session.user)) return res.status(403).json({ error: 'Agency administrator access required' });
  if (!config().enabled) return res.status(503).json({ error: 'Stripe test checkout is disabled' });
  const agencyId = req.session.user.agency_id;
  try {
    const price = allowedPrice(req.body.plan);
    const origin = process.env.BILLING_TEST_RETURN_ORIGIN || '';
    if (!/^https:\/\/[^/]+$/.test(origin)) return res.status(503).json({ error: 'Test return origin is not configured' });
    const stripe = sdk();
    const row = get('SELECT stripe_subscription_id, subscription_status FROM agency_billing WHERE agency_id = ?', [agencyId]);
    if (row?.stripe_subscription_id) return res.status(409).json({ error: 'An agency subscription already exists. Contact support to change plans.' });
    const params = {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: agencyId,
      metadata: { agency_id: agencyId, plan_code: req.body.plan },
      subscription_data: { metadata: { agency_id: agencyId, plan_code: req.body.plan } },
      success_url: origin + '/manager/billing-preview.html?test_checkout=success',
      cancel_url: origin + '/manager/billing-preview.html?test_checkout=cancel'
    };
    params.customer_email = req.session.user.email;
    const checkout = await stripe.checkout.sessions.create(params,{ idempotencyKey: 'test-checkout-'+agencyId+'-'+req.body.plan+'-'+Date.now() });
    res.json({ url: checkout.url, test_mode: true });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.status ? err.message : 'Unable to create test checkout' });
  }
});
module.exports = router;
