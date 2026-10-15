# Twanova checkout/onboarding demo — QA checklist

This demo does **not** charge cards or create accounts. Do not enter real passwords or card numbers.

## Contract and checkout paths
- Open `/pricing` and check every workforce tier (1–200, 201–500, 501–1000, 1001–2000, 2001–3000, 3001–5000).
- For every tier choose Monthly Flex, six-month, and twelve-month; open Get Started and verify the plan and term are preserved.
- Check all 18 combinations: monthly price is correct, initial total equals monthly amount + $1,999, and recurring monthly amount excludes onboarding.
- Check that demo blocks proceeding without name, valid email and acknowledgement.
- Confirm no card details or passwords are requested and no network call initiates real checkout.
- Simulate successful payment, enter agency admin name, finish setup and inspect Practice Mode; verify no actual account is created.
- Verify refresh and deep links, browser back and keyboard navigation.

## Devices/browsers to check manually before client demonstration
- iPhone Safari (small screen), iPhone Chrome.
- Android Chrome (small screen).
- Desktop Chrome (Mac/Windows), Safari (Mac), Firefox or Edge.
- Tablet portrait and landscape.
- Test accessibility including labels, keyboard focus, contrast, and zoom at 200%.

## Production launch gates (NOT finished by this demo)
- Stripe test-mode Checkout sessions with 18 trusted server-side prices and $1,999 one-time setup price.
- Signed contract or recorded electronic acceptance; renewal/cancellation disclosures and actual document reviewed by attorney.
- Stripe webhook signature validation, idempotency, replay tests, failed payment handling and delayed-event handling.
- Secure trial-to-paid agency mapping and single-use account-claim flow; never trust URL success alone.
- Server-enforced active worker caps, role permissions, tenant isolation and contract term enforcement.
- Secure session store, backups/restore drill, persistent storage restart test, load and concurrent-user tests, privacy and retention policy.
- Genuine simultaneous worker ↔ agency ↔ supervisor tests with separate physical devices.
- Explicit merchant approval before any live payment link is exposed.
