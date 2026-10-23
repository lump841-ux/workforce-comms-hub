# Pricing demo-path repair — review only

Base: integrated review commit `703b0ea`. Independent real Git worktree at `/workspace/shared/hub-pricing-repair`, branch `review/pricing-demo`. No production deploy, payment configuration, remote push or account creation performed.

## Repaired
- `prototype/pricing.html` contained an unterminated JavaScript string and raw JavaScript after the closing document. Replaced only its broken script with a single valid selection handler.
- Monthly Flex / 6 Months / 12 Months now update all six proposed prices, savings, selected state and accessible pressed state.
- All six checkout-demo links now carry the plan index and selected term. Static fallback links carry the correct plan and default monthly term even without JavaScript.
- Existing `signup-demo.html` already validates allowed plan/term indices and displays the corresponding illustrative summary using `textContent`; no change needed. Invalid query strings fall back to Essentials/Monthly Flex. Terms acknowledgement remains required to progress.

## Preserved / release gates
All displayed numeric copy, worker limits, price arrays, setup fee and discounts were preserved exactly (automated comparison against base). This does NOT approve pricing or resolve conflicting proposals elsewhere. User pricing decision and test-mode Stripe verification remain required. Existing DEMO ONLY / no charge / no agency creation / no activation warnings remain. This fix creates no checkout session, charge or state-changing API request.

## Tests
- `node test/pricing-demo.js`: source numeric preservation, single parsed script, all 18 plan/term pairs plus 6 return-to-monthly journeys, selected/aria state, displayed prices/savings/first invoice, six no-JS links, four missing/invalid parameter cases and unchecked-form prevention; no network mutation calls.
- `BUN_BIN=/path/to/bun node test/pricing-demo-http.mjs`: five actual Bun routes serve exact expected HTML with correct content type; query strings do not inject HTML.
- Recorded output: `evidence/pricing-demo/dom-vm.txt`, `evidence/pricing-demo/http.txt`.

DOM/VM is a minimal controlled DOM harness, not a browser or visual QA claim. Browser rendering, mobile layout, production repair and real payment journeys remain unverified. Previous supported cloud-browser localhost access returned `net::ERR_CONNECTION_REFUSED`; no alternative browser or forwarding was used.

Integration portability: the numeric baseline extracted from `703b0ea:prototype/pricing.html` is included in `test/fixtures/pricing-numeric-baseline.json`; the test no longer requires private local Git history. Full prior1245 checks plus the pricing suite and26 Bun HTTP routes/checks passed on the integrated branch. No numeric pricing or checkout policy change.
