const express = require('express');
const bcrypt = require('bcryptjs');
const { run, all, get } = require('../database/db');
const { id } = require('../services/ids');
const { requireRole } = require('../middleware/auth');
const { createEscalation } = require('../services/escalation');
const { logAudit } = require('../services/audit');
const { startReplacementSearch } = require('../services/replacement');

const router = express.Router();
router.use(requireRole('client_hr'));

// ===== Multi-agency identity =====
// One client login, connected to as many agencies as the company actually
// works with — this lists them so the dashboard can offer a switcher, and
// switch-agency below re-points the session at whichever one is picked.
router.get('/agencies', (req, res) => {
  const u = req.session.user;
  const links = all(
    `SELECT l.id as linkId, l.status, a.id as agencyId, a.name as agencyName, c.id as clientId, c.site_name
     FROM client_org_agency_links l
     JOIN agencies a ON a.id = l.agency_id
     JOIN clients c ON c.id = l.client_id
     WHERE l.client_org_id = ?
     ORDER BY l.created_at ASC`,
    [u.client_org_id]
  );
  res.json({ agencies: links, currentAgencyId: u.agency_id });
});

router.post('/switch-agency', (req, res) => {
  const u = req.session.user;
  const { linkId } = req.body;
  const link = get(
    `SELECT * FROM client_org_agency_links WHERE id = ? AND client_org_id = ? AND status = 'active'`,
    [linkId, u.client_org_id]
  );
  if (!link) return res.status(404).json({ error: 'Agency connection not found' });
  req.session.user.agency_id = link.agency_id;
  req.session.user.client_id = link.client_id;
  res.json({ ok: true, user: req.session.user });
});

// A client_hr user connects themselves to a new agency by its invite slug —
// covers "the client heard about Twanova before this particular agency
// did." A `clients` row is created under that agency so shifts/messages
// still work exactly as they do for an agency-invited client, but the link
// starts pending: the agency has to approve it in their Clients tab before
// it goes live, same as any other new business relationship.
router.post('/connect-agency', (req, res) => {
  const u = req.session.user;
  const { agencySlug } = req.body;
  if (!agencySlug) return res.status(400).json({ error: 'agencySlug is required' });
  const agency = get('SELECT * FROM agencies WHERE slug = ?', [agencySlug.toLowerCase().trim()]);
  if (!agency) return res.status(404).json({ error: 'No agency found with that connect code' });

  const existingLink = get(`SELECT id FROM client_org_agency_links WHERE client_org_id = ? AND agency_id = ?`, [u.client_org_id, agency.id]);
  if (existingLink) return res.status(409).json({ error: 'You are already connected (or pending) with that agency' });

  const clientOrg = get('SELECT * FROM client_orgs WHERE id = ?', [u.client_org_id]);
  const clientId = id('cli');
  run(`INSERT INTO clients (id, agency_id, company_name) VALUES (?,?,?)`, [clientId, agency.id, clientOrg.company_name]);
  const linkId = id('col');
  run(
    `INSERT INTO client_org_agency_links (id, client_org_id, agency_id, client_id, status, initiated_by) VALUES (?,?,?,?, 'pending', 'client')`,
    [linkId, u.client_org_id, agency.id, clientId]
  );
  logAudit({ agencyId: agency.id, actorId: u.id, action: 'client_connection_requested', entityType: 'client_org_agency_link', entityId: linkId });
  res.json({ ok: true, linkId, agencyName: agency.name });
});

router.get('/overview', (req, res) => {
  const u = req.session.user;
  if (!u.client_id) return res.json({ noAgencyConnected: true, todayShiftCount: 0, tempsOnSiteToday: 0, noShowsToday: 0, openEscalations: 0 });
  const today = new Date().toISOString().slice(0, 10);
  const todayShifts = all(`SELECT * FROM shifts WHERE client_id = ? AND shift_date = ?`, [u.client_id, today]);
  const noShowsToday = todayShifts.filter((s) => s.status === 'no_show').length;
  const openEscalations = get(`SELECT COUNT(*) c FROM escalations WHERE client_id = ? AND status != 'resolved'`, [u.client_id]).c;
  res.json({
    todayShiftCount: todayShifts.length,
    tempsOnSiteToday: todayShifts.filter((s) => s.status === 'in_progress').length,
    noShowsToday,
    openEscalations
  });
});

router.get('/shifts', (req, res) => {
  const u = req.session.user;
  if (!u.client_id) return res.json({ shifts: [] });
  const { date } = req.query;
  let sql = `SELECT s.*, w.full_name as temp_name FROM shifts s LEFT JOIN users w ON w.id = s.temp_id WHERE s.client_id = ?`;
  const params = [u.client_id];
  if (date) { sql += ` AND s.shift_date = ?`; params.push(date); }
  sql += ` ORDER BY s.shift_date DESC, s.start_time ASC LIMIT 100`;
  res.json({ shifts: all(sql, params) });
});

// Client HR raises an issue directly to the agency — opens Tier 2 escalation + conversation
router.post('/raise-issue', (req, res) => {
  const u = req.session.user;
  const { shiftId, subject, message, priority = 'urgent' } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message are required' });

  const client = get('SELECT * FROM clients WHERE id = ?', [u.client_id]);
  if (!client) return res.status(400).json({ error: 'No client account linked to this user' });

  const convId = id('cnv');
  run(
    `INSERT INTO conversations (id, agency_id, client_id, type, subject, shift_id, created_by, priority)
     VALUES (?,?,?, 'escalation', ?, ?, ?, ?)`,
    [convId, client.agency_id, client.id, subject, shiftId || null, u.id, priority]
  );
  run(`INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?,?,?)`, [id('cvp'), convId, u.id]);

  const managers = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [client.agency_id]);
  for (const m of managers) {
    run(`INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?,?,?)`, [id('cvp'), convId, m.id]);
  }
  run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [id('msg'), convId, u.id, message]);

  createEscalation({
    agencyId: client.agency_id,
    clientId: client.id,
    shiftId: shiftId || null,
    conversationId: convId,
    triggeredBy: 'client_complaint',
    tier: priority === 'critical' ? 3 : 2,
    summary: subject
  });

  logAudit({ agencyId: client.agency_id, actorId: u.id, action: 'client_raised_issue', entityType: 'conversation', entityId: convId });
  res.json({ ok: true, conversationId: convId });
});

// ===== Assigned Workers directory =====
router.get('/workers', (req, res) => {
  const u = req.session.user;
  if (!u.client_id) return res.json({ workers: [] });
  const rows = all(
    `SELECT w.id, w.full_name, w.phone, w.email, w.avatar_url,
            MAX(s.shift_date) as last_shift_date,
            (SELECT s2.status FROM shifts s2 WHERE s2.temp_id = w.id AND s2.client_id = ? ORDER BY s2.shift_date DESC, s2.start_time DESC LIMIT 1) as last_status,
            COUNT(s.id) as total_shifts
     FROM shifts s
     JOIN users w ON w.id = s.temp_id
     WHERE s.client_id = ?
     GROUP BY w.id
     ORDER BY last_shift_date DESC`,
    [u.client_id, u.client_id]
  );
  res.json({ workers: rows });
});

// ===== Time & Attendance =====
router.get('/attendance', (req, res) => {
  const u = req.session.user;
  if (!u.client_id) return res.json({ shifts: [], stats: {} });
  const { from, to, status } = req.query;
  let sql = `SELECT s.*, w.full_name as temp_name FROM shifts s LEFT JOIN users w ON w.id = s.temp_id WHERE s.client_id = ?`;
  const params = [u.client_id];
  if (from) { sql += ` AND s.shift_date >= ?`; params.push(from); }
  if (to) { sql += ` AND s.shift_date <= ?`; params.push(to); }
  if (status) { sql += ` AND s.status = ?`; params.push(status); }
  sql += ` ORDER BY s.shift_date DESC, s.start_time ASC LIMIT 200`;
  const shifts = all(sql, params);
  const stats = {
    total: shifts.length,
    completed: shifts.filter((s) => s.status === 'completed').length,
    noShow: shifts.filter((s) => s.status === 'no_show').length,
    inProgress: shifts.filter((s) => s.status === 'in_progress').length
  };
  res.json({ shifts, stats });
});

// ===== Replacement Requests =====
router.get('/replacement-requests', (req, res) => {
  const u = req.session.user;
  if (!u.client_id) return res.json({ requests: [] });
  const rows = all(
    `SELECT r.*, s.shift_date, s.start_time, s.job_title, w.full_name as original_temp_name
     FROM replacement_requests r
     JOIN shifts s ON s.id = r.original_shift_id
     LEFT JOIN users w ON w.id = s.temp_id
     WHERE s.client_id = ?
     ORDER BY r.created_at DESC LIMIT 100`,
    [u.client_id]
  );
  res.json({ requests: rows });
});

router.post('/replacement-requests', async (req, res) => {
  const u = req.session.user;
  const { shiftId, reason } = req.body;
  if (!shiftId) return res.status(400).json({ error: 'shiftId is required' });
  const shift = get(`SELECT * FROM shifts WHERE id = ? AND client_id = ?`, [shiftId, u.client_id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found for your organization' });

  try {
    const result = await startReplacementSearch({ shift, noShowEventId: null });
    logAudit({ agencyId: shift.agency_id, actorId: u.id, action: 'client_initiated_replacement', entityType: 'shift', entityId: shiftId });
    if (reason) {
      createEscalation({
        agencyId: shift.agency_id,
        clientId: u.client_id,
        shiftId,
        triggeredBy: 'client_replacement_request',
        tier: 2,
        summary: reason
      });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to start replacement search' });
  }
});

// ===== Reports (aggregate metrics) =====
router.get('/reports', (req, res) => {
  const u = req.session.user;
  if (!u.client_id) return res.json({});
  const { from, to } = req.query;
  let sql = `SELECT * FROM shifts WHERE client_id = ?`;
  const params = [u.client_id];
  if (from) { sql += ` AND shift_date >= ?`; params.push(from); }
  if (to) { sql += ` AND shift_date <= ?`; params.push(to); }
  const shifts = all(sql, params);
  const totalShifts = shifts.length;
  const completed = shifts.filter((s) => s.status === 'completed').length;
  const noShows = shifts.filter((s) => s.status === 'no_show').length;
  const fillRate = totalShifts ? Math.round(((totalShifts - noShows) / totalShifts) * 100) : 100;
  const escalationCount = get(`SELECT COUNT(*) c FROM escalations WHERE client_id = ?`, [u.client_id]).c;
  res.json({
    totalShifts,
    completed,
    noShows,
    fillRate,
    escalationCount,
    reliabilityScore: fillRate
  });
});

// ===== Settings =====
const DEFAULT_NOTIFICATION_PREFS = { noShowWarning: true, lateArrivalAlerts: true, replacementsMatched: true, dailyHoursSummary: false };

router.get('/settings', (req, res) => {
  const u = req.session.user;
  const org = get(`SELECT id, company_name, contact_email, contact_phone, notification_prefs, created_at FROM client_orgs WHERE id = ?`, [u.client_org_id]);
  let notificationPrefs = DEFAULT_NOTIFICATION_PREFS;
  if (org && org.notification_prefs) {
    try { notificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(org.notification_prefs) }; } catch (e) { /* fall back to defaults */ }
  }
  res.json({ org, notificationPrefs });
});

router.post('/settings', (req, res) => {
  const u = req.session.user;
  const { companyName, contactEmail, contactPhone, notificationPrefs } = req.body;
  run(
    `UPDATE client_orgs SET company_name = COALESCE(?, company_name), contact_email = COALESCE(?, contact_email), contact_phone = COALESCE(?, contact_phone), notification_prefs = COALESCE(?, notification_prefs) WHERE id = ?`,
    [companyName || null, contactEmail || null, contactPhone || null, notificationPrefs ? JSON.stringify(notificationPrefs) : null, u.client_org_id]
  );
  logAudit({ actorId: u.id, action: 'client_updated_settings', entityType: 'client_org', entityId: u.client_org_id });
  res.json({ ok: true });
});

// ===== Supervisors Management =====
// Additional client_hr logins under the same client_org_id — mirrors the
// Agency "Team" invite pattern.
router.get('/supervisors', (req, res) => {
  const u = req.session.user;
  const rows = all(
    `SELECT id, full_name, email, phone, active, created_at FROM users WHERE client_org_id = ? AND role = 'client_hr' ORDER BY created_at ASC`,
    [u.client_org_id]
  );
  res.json({ supervisors: rows });
});

router.post('/supervisors/invite', async (req, res) => {
  const u = req.session.user;
  const { fullName, email, phone } = req.body;
  if (!fullName || !email) return res.status(400).json({ error: 'fullName and email are required' });

  const existing = get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase().trim()]);
  if (existing) return res.status(409).json({ error: 'A user with that email already exists' });

  const tempPassword = Math.random().toString(36).slice(-10);
  const hash = await bcrypt.hash(tempPassword, 10);
  const newId = id('usr');
  run(
    `INSERT INTO users (id, client_id, client_org_id, role, full_name, email, phone, password_hash, active)
     VALUES (?,?,?, 'client_hr', ?,?,?,?, 1)`,
    [newId, u.client_id || null, u.client_org_id, fullName, email.toLowerCase().trim(), phone || null, hash]
  );
  logAudit({ actorId: u.id, action: 'client_invited_supervisor', entityType: 'user', entityId: newId });
  res.json({ ok: true, tempPassword, userId: newId });
});

router.post('/supervisors/:id/deactivate', (req, res) => {
  const u = req.session.user;
  const supervisor = get(`SELECT * FROM users WHERE id = ? AND client_org_id = ?`, [req.params.id, u.client_org_id]);
  if (!supervisor) return res.status(404).json({ error: 'Supervisor not found' });
  run(`UPDATE users SET active = 0 WHERE id = ?`, [req.params.id]);
  logAudit({ actorId: u.id, action: 'client_deactivated_supervisor', entityType: 'user', entityId: req.params.id });
  res.json({ ok: true });
});

// ===== Locations (site connections across agencies) =====
router.get('/locations', (req, res) => {
  const u = req.session.user;
  const rows = all(
    `SELECT c.id as clientId, c.site_name, c.agency_id, a.name as agencyName, l.status
     FROM client_org_agency_links l
     JOIN clients c ON c.id = l.client_id
     JOIN agencies a ON a.id = l.agency_id
     WHERE l.client_org_id = ?
     ORDER BY a.name ASC`,
    [u.client_org_id]
  );
  res.json({ locations: rows });
});

module.exports = router;
