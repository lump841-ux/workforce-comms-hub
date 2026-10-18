'use strict';
// Agency-only billing policy. Workers and client supervisors are never billed.
// No Stripe API calls, product creation, checkout, or collection occurs here.
const BILLABLE_ROLES = Object.freeze(['owner', 'agency_admin']);
const FREE_ROLES = Object.freeze(['temp', 'client_hr']);
const SUBSCRIPTION_STATES = Object.freeze(['not_configured', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
function canManageBilling(user) {
  return !!user && BILLABLE_ROLES.includes(user.role) && !!user.agency_id;
}
function billingOwnerAgency(user) {
  if (!canManageBilling(user)) throw new Error('Billing is managed by staffing agency administrators only');
  return user.agency_id;
}
function isFreeAccessRole(role) {
  return FREE_ROLES.includes(role);
}
function normalizeBillingStatus(status) {
  return SUBSCRIPTION_STATES.includes(status) ? status : 'not_configured';
}
module.exports = { BILLABLE_ROLES, FREE_ROLES, SUBSCRIPTION_STATES, canManageBilling, billingOwnerAgency, isFreeAccessRole, normalizeBillingStatus };
