'use strict';
const express = require('express');
const { get } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { canManageBilling, normalizeBillingStatus } = require('../services/billingPolicy');
const { publicCatalog } = require('../services/pricingCatalog');
const router = express.Router();
router.use(requireAuth);

// Read-only setup/status. Stripe Checkout, webhooks and live subscriptions are
// intentionally disabled until plan prices and test-mode integration are approved.
router.get('/plans', (req, res) => {
  if (!canManageBilling(req.session.user)) return res.status(403).json({ error: 'Agency administrator access required' });
  res.json({ billing_model: 'agency_only', plans: publicCatalog(), checkout_enabled: false });
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
    checkout_enabled: false,
    subscription_status: normalizeBillingStatus(row && row.subscription_status),
    plan_code: row ? row.plan_code : null,
    current_period_end: row ? row.current_period_end : null
  });
});
module.exports = router;
