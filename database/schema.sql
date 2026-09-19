-- Twanova — Workforce Communications Hub
-- Standalone multi-tenant schema (SQLite via node:sqlite)

-- ============ TENANCY ============
CREATE TABLE IF NOT EXISTS agencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  company_name TEXT NOT NULL,
  site_name TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ CLIENT ORGS (platform-level client identity) ============
-- A client_org is the company's own account on Twanova — independent of any
-- one agency. A client_hr user belongs to a client_org, and the client_org
-- can be linked to more than one agency (see client_org_agency_links below).
-- This is what lets a client keep one login while working with Agency A
-- today and connecting to Agency B later, without losing their history.
CREATE TABLE IF NOT EXISTS client_orgs (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  notification_prefs TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ USERS (all roles) ============
-- role: temp | agency_manager | agency_admin | client_hr | platform_admin
-- For client_hr users, agency_id/client_id are session-time conveniences that
-- track the *currently selected* agency relationship (see client_org_agency_links);
-- client_org_id is the durable identity. For temp/manager roles agency_id is
-- the permanent home agency as before.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  agency_id TEXT REFERENCES agencies(id),
  client_id TEXT REFERENCES clients(id),
  client_org_id TEXT REFERENCES client_orgs(id),
  role TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Links a client_org to one agency's view of that client (a row in `clients`
-- — company/site name as that agency knows it). Either side can initiate:
-- an agency invites a client HR contact directly (status starts 'active'),
-- or a client_hr user connects themselves to a new agency by its invite
-- slug (status starts 'pending' until the agency approves it in their
-- Clients tab). A client_org can have many of these, one per agency.
CREATE TABLE IF NOT EXISTS client_org_agency_links (
  id TEXT PRIMARY KEY,
  client_org_id TEXT NOT NULL REFERENCES client_orgs(id),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL DEFAULT 'active', -- pending | active | declined
  initiated_by TEXT NOT NULL DEFAULT 'agency', -- agency | client
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

-- ============ TEMP INVITES ============
-- Agency-issued invite for a temp to create their own login. Nothing is
-- provisioned in `users` until the temp opens the link and sets their own
-- password — so an agency can freely revoke a pending invite, and once a
-- temp is on staff, removing them is just flipping users.active off.
CREATE TABLE IF NOT EXISTS temp_invites (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | revoked
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT
);

-- ============ SHIFTS / ASSIGNMENTS ============
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  temp_id TEXT REFERENCES users(id),
  job_title TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
    -- scheduled | confirmed | in_progress | completed | no_show | replaced | cancelled
  clock_in_at TEXT,
  clock_out_at TEXT,
  confirmed_at TEXT,
  no_show_flagged_at TEXT,
  replacement_shift_id TEXT REFERENCES shifts(id),
  original_shift_id TEXT REFERENCES shifts(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ MESSAGING ============
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  client_id TEXT REFERENCES clients(id),
  type TEXT NOT NULL DEFAULT 'direct', -- direct | broadcast | escalation
  subject TEXT,
  shift_id TEXT REFERENCES shifts(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved | archived
  priority TEXT NOT NULL DEFAULT 'normal', -- normal | urgent | critical
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  last_read_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ NO-SHOW DETECTION ============
CREATE TABLE IF NOT EXISTS no_show_events (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  detection_method TEXT NOT NULL DEFAULT 'auto', -- auto | manual
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolution TEXT, -- replaced | temp_late_confirmed | cancelled | false_alarm
  resolved_at TEXT
);

-- ============ REPLACEMENT WORKFLOW ============
CREATE TABLE IF NOT EXISTS replacement_requests (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  original_shift_id TEXT NOT NULL REFERENCES shifts(id),
  no_show_event_id TEXT REFERENCES no_show_events(id),
  status TEXT NOT NULL DEFAULT 'searching', -- searching | offered | filled | unfilled | cancelled
  candidates_notified INTEGER NOT NULL DEFAULT 0,
  filled_by_temp_id TEXT REFERENCES users(id),
  filled_shift_id TEXT REFERENCES shifts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  filled_at TEXT
);

CREATE TABLE IF NOT EXISTS replacement_candidates (
  id TEXT PRIMARY KEY,
  replacement_request_id TEXT NOT NULL REFERENCES replacement_requests(id),
  temp_id TEXT NOT NULL REFERENCES users(id),
  notified_at TEXT NOT NULL DEFAULT (datetime('now')),
  response TEXT, -- accepted | declined | no_response
  responded_at TEXT
);

-- ============ ESCALATIONS ============
CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  client_id TEXT REFERENCES clients(id),
  shift_id TEXT REFERENCES shifts(id),
  conversation_id TEXT REFERENCES conversations(id),
  triggered_by TEXT NOT NULL, -- no_show | unresolved_message | client_complaint | manual
  tier INTEGER NOT NULL DEFAULT 1, -- 1=manager, 2=agency_admin, 3=client_hr+agency_admin
  status TEXT NOT NULL DEFAULT 'open', -- open | acknowledged | resolved
  summary TEXT,
  assigned_to TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  resolved_at TEXT
);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, -- message | no_show | replacement | escalation | shift_reminder
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ AI ASSISTANT LOG ============
CREATE TABLE IF NOT EXISTS ai_interactions (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL, -- briefing | qa | summary | draft_message
  input TEXT,
  output TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ AUDIT LOG ============
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  agency_id TEXT REFERENCES agencies(id),
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ AGENCY OFFICES / BRANCHES ============
CREATE TABLE IF NOT EXISTS agency_offices (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_hq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ TIME DISPUTES ============
-- A worker or client disputes the hours recorded on a shift (clock_in_at/
-- clock_out_at vs. what actually happened on site). Reported/approved hours
-- are stored as decimal hours; resolving picks which side's hours become
-- the shift's hours-of-record.
CREATE TABLE IF NOT EXISTS time_disputes (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  reported_hours REAL NOT NULL,
  client_claim_hours REAL,
  worker_claim TEXT,
  client_claim TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | resolved
  resolution TEXT, -- worker_approved | client_approved | manual
  resolved_hours REAL,
  resolved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_shifts_agency ON shifts(agency_id);
CREATE INDEX IF NOT EXISTS idx_shifts_temp ON shifts(temp_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_escalations_agency ON escalations(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_users_agency ON users(agency_id);
CREATE INDEX IF NOT EXISTS idx_col_org ON client_org_agency_links(client_org_id);
CREATE INDEX IF NOT EXISTS idx_col_agency ON client_org_agency_links(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_temp_invites_token ON temp_invites(token);
CREATE INDEX IF NOT EXISTS idx_temp_invites_agency ON temp_invites(agency_id, status);
