# Twanova — Workforce Communications Hub

A standalone multi-tenant platform for staffing agencies to manage temp communication, no-show detection, replacement coverage, and client escalations. This is a **separate app** from the Twanova staffing-agency product (staffing-ai-manager) — its own codebase, its own database, its own logins. It shares only the Twanova brand.

## Stack

- Node.js + Express
- SQLite via Node's built-in `node:sqlite` (no native compilation, no external DB to provision)
- Server-rendered sessions (`express-session`) — no external auth provider
- Vanilla HTML/CSS/JS frontend (no build step)

## Run it

```bash
cd workforce-comms-hub
npm install
npm start
```

Requires **Node 22.5+** (for the built-in `node:sqlite` module). The server listens on `http://localhost:4400` by default (override with `PORT`). The SQLite file is created automatically at `database/hub.db` on first boot.

## Roles

- **temp** — confirms shifts, clocks in/out, sees and accepts open replacement shifts, messages the agency
- **agency_manager** / **agency_admin** — the Command Center: shifts, no-shows, replacements, escalations, client & temp rosters, AI briefing, analytics. Admins can additionally invite other staff (same routes, both roles allowed today)
- **client_hr** — sees temps on-site for their company, can raise an issue directly (opens a Tier 2/3 escalation), messages the agency

## Getting started

1. Go to `/agency-signup.html` and create an agency workspace (this creates the agency tenant + your `agency_admin` login).
2. From the Command Center, add a **Client** and invite a **Temp**. Temps can also self-register at `/temp-signup.html` using your agency's invite code (its slug, shown after signup).
3. Add an **HR Contact** for a client from the Clients tab so that company can log in and see their own shifts.
4. Create a shift and assign a temp.

## How the core workflow works

**No-show detection** (`services/noshow.js`): a background job runs every minute and flags any shift that started more than 15 minutes ago with no clock-in as a no-show. Managers can also flag a no-show manually.

**Replacement workflow** (`services/replacement.js`): the moment a no-show is flagged, the system finds available temps in the same agency (not already booked that day), notifies up to 5 of them, and lets the first to accept claim the shift. This is race-safe — once filled, later accepts are rejected.

**Escalation system** (`services/escalation.js`): a no-show opens a Tier 1 escalation (notifies managers). A critical client complaint opens Tier 2/3 directly (adds agency admins and/or the client's HR contact). Any escalation left unacknowledged for 30+ minutes is automatically bumped up a tier by the same background job.

**AI assistant** (`services/ai.js`): a lightweight rules-based layer (no external API key needed) that generates a manager's daily briefing and answers natural-language questions like "any open escalations?" by querying live data. Swappable for a real LLM later without touching the callers.

**Messaging**: threaded conversations scoped to an agency/client, with unread counts, priority levels, and automatic escalation when a conversation is marked critical.

## Multi-tenancy

Every table that holds tenant data carries `agency_id`, and `client_id` where relevant. All routes filter by `req.session.user.agency_id` server-side — the smoke test explicitly verifies a second agency sees zero of the first agency's clients.

## Testing

```bash
npm test
```

Runs `test/smoke.js`, a 26-assertion end-to-end test against an in-process server and a throwaway SQLite file: agency signup, client creation, temp self-registration, shift creation, no-show flagging, replacement offer + accept, client HR escalation, messaging round-trip, AI briefing/Q&A, analytics, tenant isolation, and role/auth enforcement.

## Deploying

Any Node host works (Render, Railway, Fly.io, a VPS). Set `SESSION_SECRET` to a real random value in production, and make sure the host's Node version supports `node:sqlite` (22.5+) or swap `database/db.js` for a hosted Postgres client if you outgrow SQLite.
