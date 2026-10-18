'use strict';
const express = require('express');
const { db, get } = require('../database/db');
const { config, sdk } = require('../services/stripeTest');
const { PLANS } = require('../services/pricingCatalog');
const router = express.Router();

// This route is mounted before express.json, preserving Stripe's raw signed body.
// Billing access is determined by the latest Stripe subscription, never by a
// Checkout success redirect or an unverified event payload.
router.post('/', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  if (!config().enabled) return res.status(503).send('Test webhooks disabled');
  const stripe = sdk();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config().webhookSecret);
  } catch (_) {
    return res.status(400).send('Invalid webhook signature');
  }
  if (event.livemode) return res.status(400).send('Live event rejected');
  if (!['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    return res.json({ received: true, ignored: true });
  }
  const subscriptionId = event.data.object && event.data.object.id;
  if (typeof subscriptionId !== 'string' || !subscriptionId.startsWith('sub_')) return res.status(422).send('Subscription missing');
  let subscription;
  try {
    // Retrieve the canonical current status to resist out-of-order notifications.
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (_) {
    return res.status(502).send('Unable to verify subscription');
  }
  if (subscription.livemode) return res.status(400).send('Live subscription rejected');
  const agencyId = subscription.metadata && subscription.metadata.agency_id;
  const plan = subscription.metadata && subscription.metadata.plan_code;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (typeof agencyId !== 'string' || !get('SELECT id FROM agencies WHERE id = ?', [agencyId])) {
    return res.status(422).send('Unrecognized agency');
  }
  if (!Object.hasOwn(PLANS, plan) || plan === 'enterprise') return res.status(422).send('Unrecognized plan');
  const states = ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'];
  const state = states.includes(subscription.status) ? subscription.status : 'not_configured';
  const periodSeconds = subscription.items?.data?.[0]?.current_period_end || subscription.current_period_end;
  const period = Number.isFinite(periodSeconds) ? new Date(periodSeconds * 1000).toISOString() : null;
  try {
    db.exec('BEGIN IMMEDIATE');
    const seen = get('SELECT event_id FROM billing_webhook_events WHERE event_id = ?', [event.id]);
    if (seen) {
      db.exec('COMMIT');
      return res.json({ received: true, duplicate: true });
    }
    // Never change agency ownership of an existing subscription.
    const owner = get('SELECT agency_id FROM agency_billing WHERE stripe_subscription_id = ?', [subscriptionId]);
    if (owner && owner.agency_id !== agencyId) throw Error('Subscription ownership mismatch');
    const agency = get('SELECT stripe_subscription_id FROM agency_billing WHERE agency_id = ?', [agencyId]);
    if (agency?.stripe_subscription_id && agency.stripe_subscription_id !== subscriptionId) {
      throw Error('Existing agency subscription differs; manual reconciliation required');
    }
    db.prepare('INSERT INTO billing_webhook_events(event_id,event_type) VALUES (?,?)').run(event.id, event.type);
    db.prepare(`INSERT INTO agency_billing(agency_id,stripe_customer_id,stripe_subscription_id,plan_code,subscription_status,current_period_end)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(agency_id) DO UPDATE SET
        stripe_customer_id=excluded.stripe_customer_id,
        stripe_subscription_id=excluded.stripe_subscription_id,
        plan_code=excluded.plan_code,
        subscription_status=excluded.subscription_status,
        current_period_end=excluded.current_period_end,
        updated_at=datetime('now')`).run(agencyId, customerId, subscriptionId, plan, state, period);
    db.exec('COMMIT');
    return res.json({ received: true });
  } catch (_) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    return res.status(409).send('Billing reconciliation required');
  }
});
module.exports = router;
