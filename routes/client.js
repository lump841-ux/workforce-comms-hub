const express = require('express');
const { run, all, get } = require('../database/db');
const { id } = require('../services/ids');
const { requireRole } = require('../middleware/auth');
const { createEscalation } = require('../services/escalation');
const { logAudit } = require('../services/audit');

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

module.exports = router;
