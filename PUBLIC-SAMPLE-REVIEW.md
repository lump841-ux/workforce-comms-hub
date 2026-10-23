# Public sample navigation and honesty — review only

Base `394a596`; isolated real worktree `/workspace/shared/hub-public-sample-repair`. No production publishing or operational data changes.

## Changes
- Consistent fictional-sample notices on 11 illustration-bearing routes: agencies, workers, clients, app, dashboard, worker-management, client-management, job-sites, shift-details, messages and reports. Navy/orange styling and primary signup/login retained.
- Dead Invite Worker / CSV buttons now explicitly route to the existing operational login; no invitation or import occurs on the marketing service. Login's existing role routing remains untouched.
- Worker/client mock action glyphs and apparent action text now read as illustrations. Client notice offers the existing client login. Practice and authenticated-workspace links replace fake messaging composers.
- Mock shift replacement/archive buttons route to existing practice/login. Browser-local sample dashboard shift creation remains labeled sample; no local data cleared.
- Worker-phone illustration retains local status feedback, explicitly `Sample status: ... — not sent`. No claim of delivery.
- Removed `/app` purchase-unlock and automatic activation promises without selecting a replacement price. Existing proposed pricing and signup-demo files remain byte-for-byte unchanged.
- Header Login / Get Started share 44px height, nowrap and centered inline-flex alignment; existing responsive header wrapping retained. Hero CTA base styling untouched.

## Exact removed stale offer (evidence, not sales copy)
Original `/app` source at base: `choose your plan, pay the one-time $2,000 implementation fee plus your first month, and your 7-day onboarding begins.`
This conflicts with the separate demo's $1,999 setup fee. Neither is approved by this repair. Original retained in Git history and this note; removed from customer-facing /app, not replaced with a new price.

## Anonymous mock messaging inspection
`prototype/index.ts` used a process-memory `shiftMessages` array seeded with two fictional messages. Anonymous POST accepted arbitrary thread, senderRole, senderName and user text, appended to that shared array, and GET exposed matching messages without authentication. No database/file write was present. Callers were dashboard, phone (/workers and /app), /clients and /messages.

Removed public composers/pollers. `/api/messages` and its trailing slash now return HTTP 410 for all methods, with a clear unavailable/practice/login response and no-store cache header, without reading, returning, mutating or clearing any prior message array. Seed array is unchanged. No protected operational messaging (`server.js`) was changed. Existing live service is NOT fixed until an approved deployment; do not enter real information there.

## Verification
`BUN_BIN=/path/to/bun node test/public-sample-navigation.mjs` passes:
- 11 actual Bun HTML routes with fictional banners, real login/practice links, no obsolete composers or action glyphs, compilation of each emitted script.
- 12 local phone status-handler cases explicitly say not sent.
- 8 retired mock API method/path cases (GET/POST/PUT/DELETE × canonical/trailing-slash), including refusal of a synthetic POST, no returned prior/user-entered messages.
- 3 existing practice/pricing/signup-demo routes, unchanged primary account CTA.
- Source invariance: pricing.html, signup-demo.html, server.js and mock seed array unchanged; header height/nowrap/wrap assertions; hero button style unchanged.

Also reran homepage-media tests (21/21) and pricing DOM/VM tests (24 journeys plus failure cases): passed. Evidence in `evidence/public-sample/`.

Limits: no browser visual or mobile viewport pass claimed (supported browser localhost previously refused); no live deployment, payment, invitations, protected-role journey or customer release certification. Other marketing claims and the contact sample form remain outside this narrow patch and require further review. Remaining static examples are not product feature verification.

## Contact follow-on
Removed the contact form's false `Demo message sent successfully.` state and the remaining contact-page 7-day onboarding promise. Added four explicit labels, described form/disabled submit, visible delivery-unavailable notice, and defensive submit prevention with an honest not-sent status. An attempted action leaves entered values on the page; no email, storage, fetch, ticket or provider integration was added. The preview does not save entries; the browser may retain or autofill them, as stated. No personal contact address is exposed. Test: `BUN_BIN=/path/to/bun node test/contact-preview.mjs`; evidence `evidence/public-sample/contact-preview.txt`.

## Remaining marketing claim inventory (not release-verified)
- `/features`: featureCards still names “Bilingual Support”; this does not establish tested bidirectional English/Spanish translation. `/agencies` also has an “English / Spanish” capability tag. Qualify or substantiate before advertising/release.
- `/app`: “AI Workforce Assistant” and other capabilities are now explicitly Preview, not enabled/paid-unlocked functionality. Provider and real-role journey validation remain required.
- `/pricing` is served by `pricing.html`, with proposed pricing and payments-not-live warnings. `signup-demo.html` explicitly performs no charge/account activation. Other unused/alternate pricing branches in index.ts retain differing historic proposals; do not select one without user pricing decision. Test-mode Stripe end-to-end verification is not established by any preview click.
- Homepage, `/features`, `/agencies`, `/workers`, `/clients` still describe real-time status, replacements, photo proof and communication as product value. Marketing text is not verification of production behavior, permissions, notification delivery or measurable business outcomes. The sample-route notices do not replace real release testing.
- `/reports` counts/charts are fictional examples, not analytics evidence; stock people/photos are illustrative, not actual customer records.
- Request-a-demo links now lead to an explicitly unavailable contact preview. A verified delivery channel is still a release blocker, not a completed lead-capture journey.

Integration note: unchanged-file SHA256 values, preserved seed slice and button CSS are extracted from baseline394a596 into test/fixtures/public-sample-baseline.json, so the tests also run from the review ZIP without private Git history. Original live audit is included separately from local test evidence.
