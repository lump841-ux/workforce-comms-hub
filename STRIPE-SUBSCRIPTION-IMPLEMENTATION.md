# Twanova — Stripe Checkout and paid onboarding implementation

## Confirmed billing offer (not yet activated)
Six workforce tiers (count only active temp workers), three agreement lengths each, all billed monthly:
| Plan | Active workers | Flex | 6-month | 12-month |
| Essentials | 1–200 | $349 | $299 | $249 |
| Growth | 201–500 | $649 | $599 | $549 |
| Professional | 501–1,000 | $1099 | $999 | $899 |
| Business | 1001–2000 | $1999 | $1799 | $1599 |
| Business Plus | 2001–3000 | $2799 | $2499 | $2199 |
| Enterprise | 3001–5000 | $4499 | $3999 | $3499 |

One-time setup: $1,999, assessed only on initial paid onboarding; custom enterprise setup by order form. Trial: invite-only 7 days; trial conversion should reuse agency and worker data. Terms, usage caps, and refunds remain subject to legal/order-form review.

## Desired flow
1. Customer selects exact plan + term on /pricing. Website posts plan IDs (not amounts) to authenticated server; server looks up trusted catalog and pending agency invitation.
2. Server creates a *pending purchase* row with unique opaque token and selected plan, linking an existing trial agency or creating a pending reservation, then creates Stripe-hosted Checkout Session mode=subscription with recurring price and one-time setup price. Attach pending_id metadata to subscription and checkout; enable promotion code only if approved.
3. Browser redirects to Stripe Checkout URL. No passwords are collected by Stripe; no raw card data touches Twanova servers.
4. Stripe webhook verifies its raw-body signature, persists event idempotently, and on paid invoice confirmation (or subscription active with payment confirmed) activates that agency's entitlement, term, worker limit, and subscription state. Never activate on success_url or client-supplied query alone.
5. Customer returns to /welcome?session_id=..., which polls backend for verified paid activation. It then presents an expiring, single-use account-claim invitation to create the first owner login, or signs in an already authenticated trial agency owner. Owner password should be set in Twanova, not entered in public redirect URL.
6. Owner sets up agencies/workers/clients, with import instructions; existing trial agency data remains intact.
7. Handle invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted, and checkout.session.completed asynchronously, with signature check and idempotent processing. Grace periods protect active worker shifts.
8. Contract terms are NOT enforced by a recurring monthly Stripe price alone: add signed order-form acknowledgement, commitment_start/end, cancellation/renewal rules, and a service-side permission guard. Customers on six- or twelve-month agreements pay monthly but cannot use automatic month-to-month cancellation terms contrary to signed contract.
9. Secure billing portal or agency billing UI permits updating payment methods, invoices and plan changes while preventing unauthorized cancellation or worker-limit downgrades.
10. Test with Stripe testmode account and webhook signing secret, run repeated/replayed webhook tests, failed checkout, payment failures, trials, and multi-tenant isolation. Only after explicit production go-live approval configure live API key and webhook secret through Railway secret variables.

## Operational blockers today
- Stripe connection returned **TWANOVA live mode** only. Do not issue live charges or create live paid objects while testing.
- No Stripe API key or webhook secret found in Railway backend variable names at last review.
- Backend currently permits agency self-signup without paid entitlement verification, and has no subscription middleware.
- Backend uses SQLite; persistence volume just installed but backups, session store, security and restart test require completion.
- $1999 onboarding costs and contract fulfillment are business terms to disclose clearly. Taxes and optional usage-based messaging not included in the listed subscription price.
- Do not offer 5,000-worker production accounts without a concurrency/load test and tested recovery plan.

**Deployment note:** This document is implementation planning, not a functioning checkout or charged subscription. Code and secret configuration must be completed in a test environment before deployment.
