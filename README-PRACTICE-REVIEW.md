# Twanova practice preview review

Prepared October 23, 2026. Based on unchanged `prototype/practice.html` from workforce-comms-hub main 78c7d62. Preview-only: no production deployment or live data changes.

## Files
- `prototype/practice.html`: existing navy/orange layout retained, safe simulation notice, language selector, role controls, feedback and message examples.
- `prototype/practice-state.js`: dependency-free local state machine with role/action guards and valid ordering.
- `prototype/practice-ui.js`: three-role guided lessons, English/Spanish instructions, progress based on performed actions rather than Next clicks.
- `test/practice.test.js`: 19 Node state-machine and minimal DOM-harness checks.
- `evidence/practice-tests.txt`: actual test output.
- `practice-preview.html`: standalone bundled copy for review; generated from the three source files.

## Review
Open the standalone `practice-preview.html` in a browser, or serve the `prototype` folder in an isolated preview. Start with Agency → Create sample agency, add workers, prepare invitations, then switch Worker and Client to activate their sample roles. Return to Agency to create/assign the shift. Alternatively, Load ready practice assignment seeds only fictional in-memory data.

Finish the worker attendance sequence, then the separate replacement scenario and time-dispute sequence. Restart practice requires confirmation and resets only this page's memory. A refresh also resets this deliberately nonpersistent simulation.

CSV and photo actions are simulations, not imports/uploads. English/Spanish message translations are fixed examples, not a translation service. Changing roles is not authentication. The lesson alternative actions are optional; acceptance and cancellation are intentionally mutually exclusive.

## Verified
`node --test test/practice.test.js`: 19 passed, 0 failed, 0 skipped.
`node --check prototype/practice-state.js` and `node --check prototype/practice-ui.js`: passed.
State tests cover prerequisites, role action rejection, repeated CSV, arrival separate from clock-in, valid break/clock-out order, late ETA, fixed translation examples, repeated/cancelled replacement acceptance, time-dispute resolution, and full synthetic lifecycle. DOM-harness tests cover initial rendering, navigation, language switch, reset cancellation/confirmation, ready fixture, and file references.

## Not verified
No real browser rendering, visual/mobile layout, screen-reader/keyboard audit, production integration, role authentication, notification delivery, or actual translation has been tested here. The responsive CSS is retained, not a physical-phone pass. The DOM harness is not a browser E2E test.

## Safety
No network requests or persistent storage APIs. Content Security Policy blocks network connections and form submission. No real records, account credentials, email/SMS, payments, or photo files are used. Keep the visible simulation disclosure when incorporating this preview.
