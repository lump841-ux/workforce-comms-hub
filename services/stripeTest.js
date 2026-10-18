'use strict';
const Stripe = require('stripe');
const { PLANS } = require('./pricingCatalog');

const ids = {
  starter: 'STRIPE_TEST_PRICE_STARTER',
  growth: 'STRIPE_TEST_PRICE_GROWTH',
  professional: 'STRIPE_TEST_PRICE_PROFESSIONAL'
};
function config() {
  const key = process.env.STRIPE_TEST_SECRET_KEY || '';
  const webhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET || '';
  const prices = Object.fromEntries(Object.entries(ids).map(([plan,env])=>[plan,process.env[env]||'']));
  // Strictly require a TEST secret, TEST price IDs and a webhook signing secret.
  // This module will never connect to live Stripe, even if a live key exists elsewhere.
  const enabled = process.env.ENABLE_STRIPE_TEST_CHECKOUT === 'true' &&
    key.startsWith('sk_test_') && webhookSecret.startsWith('whsec_') &&
    Object.values(prices).every(v=>v.startsWith('price_'));
  return { enabled, key, webhookSecret, prices };
}
function sdk() {
  const c=config();
  if(!c.enabled) throw Object.assign(new Error('Test checkout is not configured'),{status:503});
  return new Stripe(c.key);
}
function allowedPrice(plan) {
  const c=config();
  if(!c.enabled) throw Object.assign(new Error('Test checkout is not configured'),{status:503});
  if(!PLANS[plan] || !c.prices[plan]) throw Object.assign(new Error('Choose a supported agency plan'),{status:400});
  return c.prices[plan];
}
module.exports={ config,sdk,allowedPrice };
