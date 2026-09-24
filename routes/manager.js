const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { run, all, get } = require('../database/db');
const { id } = require('../services/ids');
const { requireRole } = require('../middleware/auth');
const { manualFlagNoShow, scanForNoShows } = require('../services/noshow');
const { acknowledgeEscalation, resolveEscalation } = require('../services/escalation');
const { generateManagerBriefing, answerQuestion } = require('../services/ai');
const { logAudit } = require('../services/audit');
const { buildShiftTimeline } = require('../services/timeline');

const router = express.Router();
router.use(requireRole('agency_manager', 'agency_admin'));

// A shift has no single "is it late yet" column — status only flips to
// no_show once the background scan (or a manual flag) catches it. For the
// live dashboard we want a same-second read, so this derives a display
// status from status + how far past start_time we are, purely for
// rendering (never written back to the DB).
const LATE_GRACE_MINUTES = 10;
function deriveDisplayStatus(shift, now = new Date()) {
  if (['in_progress', 'completed'].includes(shift.status)) return 'on_site';
  if (['no_show', 'replaced', 'cancelled'].includes(shift.status)) return shift.status;
  const startAt = new Date(`${shift.shift_date}T${shift.start_time}:00`);
  const minutesPastStart = (now - startAt) / 60000;
  if (minutesPastStart > LATE_GRACE_MINUTES) return 'running_late';
  if (shift.status === 'confirmed') return 'on_the_way';
  return shift.status; // scheduled
}

// ===== Command Center overview =====
router.get('/overview', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const today = new Date().toISOString().slice(0, 10);
  const todayShifts = all(`SELECT * FROM shifts WHERE agency_id = ? AND shift_date = ?`, [agencyId, today]);
  const now = new Date();
  const displayStatuses = todayShifts.map((s) => deriveDisplayStatus(s, now));
  const count = (status) => displayStatuses.filter((s) => s === status).length;

  const noShowsToday = count('no_show');
  const onTheWay = count('on_the_way');
  const arrivedOnSite = count('on_site');
  const runningLate = count('running_late');
  const calledOff = count('cancelled');
  const openEscalations = get(`SELECT COUNT(*) c FROM escalations WHERE agency_id = ? AND status != 'resolved'`, [agencyId]).c;
  const openReplacements = get(`SELECT COUNT(*) c FROM replacement_requests WHERE agency_id = ? AND status IN ('searching','offered')`, [agencyId]).c;
  const activeTemps = get(`SELECT COUNT(*) c FROM users WHERE agency_id = ? AND role = 'temp' AND active = 1`, [agencyId]).c;
  const clients = get(`SELECT COUNT(*) c FROM clients WHERE agency_id = ?`, [agencyId]).c;
  const todayShiftIds = todayShifts.map((s) => s.id);
  const onBreak = todayShiftIds.length
    ? get(`SELECT COUNT(DISTINCT shift_id) c FROM shift_breaks WHERE ended_at IS NULL AND shift_id IN (${todayShiftIds.map(() => '?').join(',')})`, todayShiftIds).c
    : 0;

  res.json({
    todayShiftCount: todayShifts.length,
    onTheWay,
    arrivedOnSite,
    runningLate,
    onBreak,
    calledOff,
    noShowsToday,
    openEscalations,
    openReplacements,
    activeTemps,
    clients
  });
});

// Top few of today's shifts for the dashboard's "Quick Shift Summary" —
// same derived status as /overview so the badges and the counts they
// summarize always agree.
router.get('/shifts/today-summary', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const today = new Date().toISOString().slice(0, 10);
  const rows = all(
    `SELECT s.*, c.company_name, u.full_name as temp_name, u.email as temp_email
     FROM shifts s JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.temp_id
     WHERE s.agency_id = ? AND s.shift_date = ? ORDER BY s.start_time ASC LIMIT 4`,
    [agencyId, today]
  );
  const now = new Date();
  res.json({ shifts: rows.map((s) => ({ ...s, displayStatus: deriveDisplayStatus(s, now) })) });
});

// Annotates shifts with onBreak / needsAttention flags that deriveDisplayStatus
// can't compute on its own (they depend on other tables) — kept as separate
// booleans alongside the existing displayStatus values so nothing that
// already filters on 'on_the_way' / 'running_late' / etc. breaks.
function annotateOpsFlags(shifts, agencyId) {
  if (shifts.length === 0) return shifts;
  const shiftIds = shifts.map((s) => s.id);
  const placeholders = shiftIds.map(() => '?').join(',');
  const onBreakIds = new Set(
    all(`SELECT DISTINCT shift_id FROM shift_breaks WHERE shift_id IN (${placeholders}) AND ended_at IS NULL`, shiftIds).map((r) => r.shift_id)
  );
  const attentionIds = new Set(
    all(`SELECT DISTINCT shift_id FROM escalations WHERE agency_id = ? AND status != 'resolved' AND shift_id IN (${placeholders})`, [agencyId, ...shiftIds]).map((r) => r.shift_id)
  );
  return shifts.map((s) => ({ ...s, onBreak: onBreakIds.has(s.id), needsAttention: attentionIds.has(s.id) }));
}

// ===== Shifts =====
router.get('/shifts', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const { date, status, clientId, tempId } = req.query;
  let sql = `SELECT s.*, c.company_name, c.site_name, u.full_name as temp_name FROM shifts s
             JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.temp_id
             WHERE s.agency_id = ?`;
  const params = [agencyId];
  if (date) { sql += ` AND s.shift_date = ?`; params.push(date); }
  if (status) { sql += ` AND s.status = ?`; params.push(status); }
  if (clientId) { sql += ` AND s.client_id = ?`; params.push(clientId); }
  if (tempId) { sql += ` AND s.temp_id = ?`; params.push(tempId); }
  sql += ` ORDER BY s.shift_date DESC, s.start_time ASC LIMIT 200`;
  const now = new Date();
  const shifts = annotateOpsFlags(all(sql, params), agencyId).map((s) => ({ ...s, displayStatus: deriveDisplayStatus(s, now) }));
  res.json({ shifts });
});

router.get('/shifts/:id/timeline', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const shift = get('SELECT id FROM shifts WHERE id = ? AND agency_id = ?', [req.params.id, agencyId]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  res.json(buildShiftTimeline(req.params.id));
});

router.post('/shifts', (req, res) => {
  const u = req.session.user;
  const { clientId, tempId, jobTitle, shiftDate, startTime, endTime, notes } = req.body;
  if (!clientId || !jobTitle || !shiftDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing required shift fields' });
  }
  const shiftId = id('sft');
  run(
    `INSERT INTO shifts (id, agency_id, client_id, temp_id, job_title, shift_date, start_time, end_time, notes, status)
     VALUES (?,?,?,?,?,?,?,?,?, ?)`,
    [shiftId, u.agency_id, clientId, tempId || null, jobTitle, shiftDate, startTime, endTime, notes || null, tempId ? 'scheduled' : 'scheduled']
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'shift_created', entityType: 'shift', entityId: shiftId });
  res.json({ ok: true, shiftId });
});

router.post('/shifts/:id/flag-no-show', (req, res) => {
  const u = req.session.user;
  try {
    const eventId = manualFlagNoShow(req.params.id, u.id);
    res.json({ ok: true, noShowEventId: eventId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Manually trigger a no-show scan (also runs automatically on an interval — see server.js)
router.post('/no-shows/scan', (req, res) => {
  const flagged = scanForNoShows();
  res.json({ ok: true, flagged });
});

// ===== Replacement requests =====
router.get('/replacements', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const rows = all(
    `SELECT rr.*, s.job_title, s.shift_date, s.start_time, s.end_time, c.company_name
     FROM replacement_requests rr
     JOIN shifts s ON s.id = rr.original_shift_id
     JOIN clients c ON c.id = s.client_id
     WHERE rr.agency_id = ? ORDER BY rr.created_at DESC LIMIT 100`,
    [agencyId]
  );
  res.json({ replacements: rows });
});

// ===== Escalations =====
router.get('/escalations', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const rows = all(
    `SELECT e.*, c.company_name, s.job_title, s.shift_date FROM escalations e
     LEFT JOIN clients c ON c.id = e.client_id LEFT JOIN shifts s ON s.id = e.shift_id
     WHERE e.agency_id = ? ORDER BY e.tier DESC, e.created_at DESC LIMIT 100`,
    [agencyId]
  );
  res.json({ escalations: rows });
});

router.post('/escalations/:id/acknowledge', (req, res) => {
  acknowledgeEscalation(req.params.id, req.session.user.id);
  res.json({ ok: true });
});

router.post('/escalations/:id/resolve', (req, res) => {
  resolveEscalation(req.params.id, req.session.user.id);
  res.json({ ok: true });
});

// ===== Temps roster =====
router.get('/temps', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const rows = all(`SELECT id, full_name, email, phone, active, created_at FROM users WHERE agency_id = ? AND role = 'temp' ORDER BY full_name ASC`, [agencyId]);
  const pendingInvites = all(`SELECT id, full_name, email, phone, created_at FROM temp_invites WHERE agency_id = ? AND status = 'pending' ORDER BY created_at DESC`, [agencyId]);
  res.json({ temps: rows, pendingInvites });
});

// Removing a temp is just flipping them inactive — instant, no cleanup, and
// login is blocked immediately (see routes/auth.js login query).
router.post('/temps/:id/deactivate', (req, res) => {
  const u = req.session.user;
  const temp = get(`SELECT * FROM users WHERE id = ? AND agency_id = ? AND role = 'temp'`, [req.params.id, u.agency_id]);
  if (!temp) return res.status(404).json({ error: 'Temp not found' });
  run(`UPDATE users SET active = 0 WHERE id = ?`, [temp.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_deactivated', entityType: 'user', entityId: temp.id });
  res.json({ ok: true });
});

router.post('/temps/:id/reactivate', (req, res) => {
  const u = req.session.user;
  const temp = get(`SELECT * FROM users WHERE id = ? AND agency_id = ? AND role = 'temp'`, [req.params.id, u.agency_id]);
  if (!temp) return res.status(404).json({ error: 'Temp not found' });
  run(`UPDATE users SET active = 1 WHERE id = ?`, [temp.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_reactivated', entityType: 'user', entityId: temp.id });
  res.json({ ok: true });
});

router.post('/temps/invites/:id/revoke', (req, res) => {
  const u = req.session.user;
  const invite = get(`SELECT * FROM temp_invites WHERE id = ? AND agency_id = ? AND status = 'pending'`, [req.params.id, u.agency_id]);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  run(`UPDATE temp_invites SET status = 'revoked' WHERE id = ?`, [invite.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_invite_revoked', entityType: 'temp_invite', entityId: invite.id });
  res.json({ ok: true });
});

// Workers Management roster — merges active/inactive temps and pending
// invites into one list with computed attendance rate + next shift, purely
// for the richer Workers Management screen (no new columns/tables).
router.get('/temps/roster', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const temps = all(`SELECT id, full_name, email, phone, active, created_at FROM users WHERE agency_id = ? AND role = 'temp' ORDER BY full_name ASC`, [agencyId]);
  const pendingInvites = all(`SELECT id, full_name, email, phone, created_at FROM temp_invites WHERE agency_id = ? AND status = 'pending' ORDER BY created_at DESC`, [agencyId]);
  const now = new Date();
  const nowDate = now.toISOString().slice(0, 10);
  const nowTime = now.toISOString().slice(11, 16);

  const workers = temps.map((t) => {
    const attendance = get(
      `SELECT COUNT(*) total, SUM(CASE WHEN status IN ('completed','in_progress') THEN 1 ELSE 0 END) attended
       FROM shifts WHERE temp_id = ? AND status IN ('completed','in_progress','no_show','replaced')`,
      [t.id]
    );
    const shiftsCompleted = get(`SELECT COUNT(*) c FROM shifts WHERE temp_id = ? AND status IN ('completed','in_progress')`, [t.id]).c;
    const nextShift = get(
      `SELECT s.shift_date, s.start_time, c.company_name FROM shifts s JOIN clients c ON c.id = s.client_id
       WHERE s.temp_id = ? AND s.status IN ('scheduled','confirmed')
       AND (s.shift_date > ? OR (s.shift_date = ? AND s.start_time >= ?))
       ORDER BY s.shift_date ASC, s.start_time ASC LIMIT 1`,
      [t.id, nowDate, nowDate, nowTime]
    );
    return {
      id: t.id,
      full_name: t.full_name,
      email: t.email,
      phone: t.phone,
      status: t.active ? 'active' : 'inactive',
      client_name: nextShift ? nextShift.company_name : null,
      next_shift_date: nextShift ? nextShift.shift_date : null,
      next_shift_time: nextShift ? nextShift.start_time : null,
      attendanceRate: attendance.total > 0 ? Math.round((attendance.attended / attendance.total) * 100) : null,
      shiftsCompleted,
      activeSince: t.created_at,
      isInvite: false
    };
  });

  const inviteRows = pendingInvites.map((i) => ({
    id: i.id,
    full_name: i.full_name,
    email: i.email,
    phone: i.phone,
    status: 'pending',
    client_name: null,
    next_shift_date: null,
    next_shift_time: null,
    attendanceRate: null,
    shiftsCompleted: 0,
    activeSince: i.created_at,
    isInvite: true
  }));

  res.json({ workers: [...workers, ...inviteRows] });
});

// ===== Clients =====
router.get('/clients', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const rows = all(`SELECT * FROM clients WHERE agency_id = ? ORDER BY company_name ASC`, [agencyId]);
  const pendingRequests = all(
    `SELECT l.id as linkId, l.created_at, c.id as clientId, c.company_name, c.site_name, co.company_name as client_org_name
     FROM client_org_agency_links l
     JOIN clients c ON c.id = l.client_id
     JOIN client_orgs co ON co.id = l.client_org_id
     WHERE l.agency_id = ? AND l.status = 'pending'
     ORDER BY l.created_at DESC`,
    [agencyId]
  );
  res.json({ clients: rows, pendingRequests });
});

// Clients Management roster — groups this agency's client rows by company
// name (a company can have several site rows) and rolls up sites,
// supervisors, active workers, open issues, open replacements, and unread
// chats per company, purely for the richer Clients Management screen.
router.get('/clients/roster', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const managerId = req.session.user.id;
  const clients = all(`SELECT * FROM clients WHERE agency_id = ? ORDER BY company_name ASC`, [agencyId]);

  const byCompany = new Map();
  for (const c of clients) {
    if (!byCompany.has(c.company_name)) byCompany.set(c.company_name, []);
    byCompany.get(c.company_name).push(c);
  }

  const companies = [...byCompany.entries()].map(([companyName, rows]) => {
    const clientIds = rows.map((r) => r.id);
    const placeholders = clientIds.map(() => '?').join(',');

    const supervisors = get(
      `SELECT COUNT(DISTINCT l.client_org_id) c FROM client_org_agency_links l
       WHERE l.agency_id = ? AND l.status = 'active' AND l.client_id IN (${placeholders})`,
      [agencyId, ...clientIds]
    ).c;
    const activeWorkers = get(
      `SELECT COUNT(DISTINCT temp_id) c FROM shifts
       WHERE client_id IN (${placeholders}) AND temp_id IS NOT NULL AND status IN ('scheduled','confirmed','in_progress')`,
      clientIds
    ).c;
    const issues = get(
      `SELECT COUNT(*) c FROM escalations WHERE agency_id = ? AND status = 'open' AND client_id IN (${placeholders})`,
      [agencyId, ...clientIds]
    ).c;
    const replacements = get(
      `SELECT COUNT(*) c FROM replacement_requests rr JOIN shifts s ON s.id = rr.original_shift_id
       WHERE rr.agency_id = ? AND rr.status IN ('searching','offered') AND s.client_id IN (${placeholders})`,
      [agencyId, ...clientIds]
    ).c;
    const unreadChats = get(
      `SELECT COUNT(*) c FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN conversation_participants cp ON cp.conversation_id = cv.id AND cp.user_id = ?
       WHERE cv.client_id IN (${placeholders}) AND m.sender_id != ?
       AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`,
      [managerId, ...clientIds, managerId]
    ).c;
    const shiftsEverCount = get(`SELECT COUNT(*) c FROM shifts WHERE client_id IN (${placeholders})`, clientIds).c;
    const pendingLink = get(
      `SELECT id FROM client_org_agency_links WHERE agency_id = ? AND status = 'pending' AND client_id IN (${placeholders})`,
      [agencyId, ...clientIds]
    );

    let status = 'active';
    if (pendingLink) status = 'pending';
    else if (activeWorkers === 0 && shiftsEverCount === 0) status = 'inactive';

    return {
      companyName,
      clientIds,
      primaryClientId: rows[0].id,
      sites: rows.length,
      supervisors,
      activeWorkers,
      issues,
      replacements,
      unreadChats,
      status
    };
  });

  res.json({ companies });
});

router.post('/clients', (req, res) => {
  const u = req.session.user;
  const { companyName, siteName, address } = req.body;
  if (!companyName) return res.status(400).json({ error: 'companyName required' });
  const clientId = id('cli');
  run(`INSERT INTO clients (id, agency_id, company_name, site_name, address) VALUES (?,?,?,?,?)`, [clientId, u.agency_id, companyName, siteName || null, address || null]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'client_created', entityType: 'client', entityId: clientId });
  res.json({ ok: true, clientId });
});

// A client self-connected to this agency (see POST /client/connect-agency)
// and it's sitting here awaiting a human decision before they show up
// anywhere in the roster or can message the agency.
router.post('/clients/connection-requests/:linkId/approve', (req, res) => {
  const u = req.session.user;
  const link = get(`SELECT * FROM client_org_agency_links WHERE id = ? AND agency_id = ? AND status = 'pending'`, [req.params.linkId, u.agency_id]);
  if (!link) return res.status(404).json({ error: 'Request not found' });
  run(`UPDATE client_org_agency_links SET status = 'active', approved_at = datetime('now') WHERE id = ?`, [link.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'client_connection_approved', entityType: 'client_org_agency_link', entityId: link.id });
  res.json({ ok: true });
});

router.post('/clients/connection-requests/:linkId/decline', (req, res) => {
  const u = req.session.user;
  const link = get(`SELECT * FROM client_org_agency_links WHERE id = ? AND agency_id = ? AND status = 'pending'`, [req.params.linkId, u.agency_id]);
  if (!link) return res.status(404).json({ error: 'Request not found' });
  run(`UPDATE client_org_agency_links SET status = 'declined' WHERE id = ?`, [link.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'client_connection_declined', entityType: 'client_org_agency_link', entityId: link.id });
  res.json({ ok: true });
});

// ===== Team management (invite temps + client HR contacts) =====
// A temp is never handed a password directly — the manager sends an invite
// link and the temp sets their own password when they accept it. Removing
// someone is a single click (see /temps/:id/deactivate above), no separate
// cleanup, because until accepted the invite is the only record that exists.
router.post('/temps/invite', (req, res) => {
  const u = req.session.user;
  const { fullName, email, phone } = req.body;
  if (!fullName || !email) return res.status(400).json({ error: 'fullName and email are required' });
  const normalizedEmail = email.toLowerCase().trim();
  const existingUser = get('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existingUser) return res.status(409).json({ error: 'A user with that email already exists' });
  const existingInvite = get(`SELECT id FROM temp_invites WHERE email = ? AND agency_id = ? AND status = 'pending'`, [normalizedEmail, u.agency_id]);
  if (existingInvite) return res.status(409).json({ error: 'There is already a pending invite for that email' });

  const inviteId = id('inv');
  const token = crypto.randomBytes(24).toString('hex');
  run(
    `INSERT INTO temp_invites (id, agency_id, full_name, email, phone, token, invited_by) VALUES (?,?,?,?,?,?,?)`,
    [inviteId, u.agency_id, fullName, normalizedEmail, phone || null, token, u.id]
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_invited', entityType: 'temp_invite', entityId: inviteId });
  const inviteUrl = `${req.protocol}://${req.get('host')}/temp-invite.html?token=${token}`;
  res.json({ ok: true, inviteId, inviteUrl });
});

// Agency invites a client HR contact directly. If that email already has a
// client_hr login (they signed up themselves, or an earlier agency invited
// them), this just adds a new active link for THIS agency to their existing
// client_org — no second login. Otherwise it creates the client_org + login
// from scratch, same as before.
router.post('/clients/:id/hr-contacts', (req, res) => {
  const u = req.session.user;
  const client = get('SELECT * FROM clients WHERE id = ? AND agency_id = ?', [req.params.id, u.agency_id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const { fullName, email, tempPassword } = req.body;
  if (!fullName || !email) return res.status(400).json({ error: 'fullName and email are required' });
  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

  if (existingUser) {
    if (existingUser.role !== 'client_hr') return res.status(409).json({ error: 'That email belongs to a different kind of account' });
    const existingLink = get(`SELECT id FROM client_org_agency_links WHERE client_org_id = ? AND agency_id = ?`, [existingUser.client_org_id, u.agency_id]);
    if (existingLink) return res.status(409).json({ error: 'That client is already connected to your agency' });
    const linkId = id('col');
    run(
      `INSERT INTO client_org_agency_links (id, client_org_id, agency_id, client_id, status, initiated_by, approved_at) VALUES (?,?,?,?, 'active', 'agency', datetime('now'))`,
      [linkId, existingUser.client_org_id, u.agency_id, client.id]
    );
    logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'client_hr_linked_existing', entityType: 'user', entityId: existingUser.id });
    return res.json({ ok: true, userId: existingUser.id, linkedExisting: true });
  }

  if (!tempPassword) return res.status(400).json({ error: 'tempPassword is required for a brand-new client contact' });
  const clientOrgId = id('corg');
  run(`INSERT INTO client_orgs (id, company_name) VALUES (?,?)`, [clientOrgId, client.company_name]);
  const hrId = id('usr');
  run(
    `INSERT INTO users (id, client_org_id, role, full_name, email, password_hash) VALUES (?,?, 'client_hr',?,?,?)`,
    [hrId, clientOrgId, fullName, normalizedEmail, bcrypt.hashSync(tempPassword, 10)]
  );
  const linkId = id('col');
  run(
    `INSERT INTO client_org_agency_links (id, client_org_id, agency_id, client_id, status, initiated_by, approved_at) VALUES (?,?,?,?, 'active', 'agency', datetime('now'))`,
    [linkId, clientOrgId, u.agency_id, client.id]
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'client_hr_invited', entityType: 'user', entityId: hrId });
  res.json({ ok: true, userId: hrId });
});

// ===== AI assistant =====
router.get('/ai/briefing', (req, res) => {
  const u = req.session.user;
  res.json(generateManagerBriefing(u.agency_id, u.id));
});

router.post('/ai/ask', (req, res) => {
  const u = req.session.user;
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  res.json({ answer: answerQuestion(u.agency_id, u.id, question) });
});

// ===== Analytics =====
router.get('/analytics', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const totalShifts = get(`SELECT COUNT(*) c FROM shifts WHERE agency_id = ?`, [agencyId]).c;
  const noShowCount = get(`SELECT COUNT(*) c FROM shifts WHERE agency_id = ? AND status IN ('no_show','replaced')`, [agencyId]).c;
  const filledCount = get(`SELECT COUNT(*) c FROM replacement_requests WHERE agency_id = ? AND status = 'filled'`, [agencyId]).c;
  const totalReplacementReqs = get(`SELECT COUNT(*) c FROM replacement_requests WHERE agency_id = ?`, [agencyId]).c;
  const avgFillMinutes = get(
    `SELECT AVG((julianday(filled_at) - julianday(created_at)) * 24 * 60) as m
     FROM replacement_requests WHERE agency_id = ? AND status = 'filled'`,
    [agencyId]
  ).m;
  const escalationsByTier = all(`SELECT tier, COUNT(*) c FROM escalations WHERE agency_id = ? GROUP BY tier`, [agencyId]);
  const messagesLast7d = get(
    `SELECT COUNT(*) c FROM messages m JOIN conversations c2 ON c2.id = m.conversation_id
     WHERE c2.agency_id = ? AND m.created_at >= datetime('now','-7 days')`,
    [agencyId]
  ).c;

  res.json({
    totalShifts,
    noShowRate: totalShifts > 0 ? +(noShowCount / totalShifts * 100).toFixed(1) : 0,
    replacementFillRate: totalReplacementReqs > 0 ? +(filledCount / totalReplacementReqs * 100).toFixed(1) : 0,
    avgReplacementFillMinutes: avgFillMinutes ? Math.round(avgFillMinutes) : null,
    escalationsByTier,
    messagesLast7d
  });
});

// ===== Sites (flattened client site rows for this agency) =====
router.get('/sites', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const rows = all(
    `SELECT c.*,
       (SELECT COUNT(DISTINCT temp_id) FROM shifts WHERE client_id = c.id AND temp_id IS NOT NULL AND status IN ('scheduled','confirmed','in_progress')) as active_workers
     FROM clients c WHERE c.agency_id = ? ORDER BY c.company_name ASC, c.site_name ASC`,
    [agencyId]
  );
  res.json({ sites: rows });
});

// ===== Attendance (derived from shifts' clock_in_at/clock_out_at) =====
router.get('/attendance', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const { from, to, status } = req.query;
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || today;
  const toDate = to || today;
  const rows = all(
    `SELECT s.*, u.full_name as temp_name, c.company_name
     FROM shifts s LEFT JOIN users u ON u.id = s.temp_id JOIN clients c ON c.id = s.client_id
     WHERE s.agency_id = ? AND s.shift_date >= ? AND s.shift_date <= ?
     ORDER BY s.shift_date DESC, s.start_time ASC LIMIT 300`,
    [agencyId, fromDate, toDate]
  );
  const now = new Date();
  const withStatus = rows.map((s) => ({ ...s, displayStatus: deriveDisplayStatus(s, now) }));
  const filtered = status ? withStatus.filter((s) => s.displayStatus === status) : withStatus;

  const total = withStatus.length;
  const onTime = withStatus.filter((s) => ['on_site', 'on_the_way'].includes(s.displayStatus)).length;
  const late = withStatus.filter((s) => s.displayStatus === 'running_late').length;
  const noShow = withStatus.filter((s) => s.displayStatus === 'no_show').length;

  res.json({
    shifts: filtered,
    stats: {
      totalShifts: total,
      onTimePct: total ? +((onTime / total) * 100).toFixed(1) : 0,
      latePct: total ? +((late / total) * 100).toFixed(1) : 0,
      noShowPct: total ? +((noShow / total) * 100).toFixed(1) : 0
    }
  });
});

// ===== Team (internal agency_manager / agency_admin users) =====
router.get('/team', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const rows = all(`SELECT id, full_name, email, phone, role, active, created_at FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin') ORDER BY full_name ASC`, [agencyId]);
  res.json({ team: rows });
});

router.post('/team/invite', (req, res) => {
  const u = req.session.user;
  if (u.role !== 'agency_admin') return res.status(403).json({ error: 'Only an agency admin can add internal team members' });
  const { fullName, email, role } = req.body;
  if (!fullName || !email) return res.status(400).json({ error: 'fullName and email are required' });
  const normalizedEmail = email.toLowerCase().trim();
  if (get('SELECT id FROM users WHERE email = ?', [normalizedEmail])) return res.status(409).json({ error: 'A user with that email already exists' });
  const memberRole = role === 'agency_admin' ? 'agency_admin' : 'agency_manager';
  const memberId = id('usr');
  const tempPassword = crypto.randomBytes(6).toString('hex');
  run(
    `INSERT INTO users (id, agency_id, role, full_name, email, password_hash) VALUES (?,?,?,?,?,?)`,
    [memberId, u.agency_id, memberRole, fullName, normalizedEmail, bcrypt.hashSync(tempPassword, 10)]
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'team_member_added', entityType: 'user', entityId: memberId });
  res.json({ ok: true, userId: memberId, tempPassword });
});

router.post('/team/:id/deactivate', (req, res) => {
  const u = req.session.user;
  if (u.role !== 'agency_admin') return res.status(403).json({ error: 'Only an agency admin can deactivate team members' });
  const member = get(`SELECT * FROM users WHERE id = ? AND agency_id = ? AND role IN ('agency_manager','agency_admin')`, [req.params.id, u.agency_id]);
  if (!member) return res.status(404).json({ error: 'Team member not found' });
  if (member.id === u.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  run(`UPDATE users SET active = 0 WHERE id = ?`, [member.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'team_member_deactivated', entityType: 'user', entityId: member.id });
  res.json({ ok: true });
});

// ===== Offices / branches =====
router.get('/offices', (req, res) => {
  const agencyId = req.session.user.agency_id;
  res.json({ offices: all(`SELECT * FROM agency_offices WHERE agency_id = ? ORDER BY is_hq DESC, name ASC`, [agencyId]) });
});

router.post('/offices', (req, res) => {
  const u = req.session.user;
  const { name, address, phone, isHq } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const officeId = id('ofc');
  run(`INSERT INTO agency_offices (id, agency_id, name, address, phone, is_hq) VALUES (?,?,?,?,?,?)`, [officeId, u.agency_id, name, address || null, phone || null, isHq ? 1 : 0]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'office_added', entityType: 'agency_office', entityId: officeId });
  res.json({ ok: true, officeId });
});

router.post('/offices/:id/delete', (req, res) => {
  const u = req.session.user;
  const office = get(`SELECT * FROM agency_offices WHERE id = ? AND agency_id = ?`, [req.params.id, u.agency_id]);
  if (!office) return res.status(404).json({ error: 'Office not found' });
  run(`DELETE FROM agency_offices WHERE id = ?`, [office.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'office_removed', entityType: 'agency_office', entityId: office.id });
  res.json({ ok: true });
});

// ===== Settings =====
router.get('/settings', (req, res) => {
  const agency = get(`SELECT id, name, slug, plan, created_at FROM agencies WHERE id = ?`, [req.session.user.agency_id]);
  res.json({ agency });
});

router.post('/settings', (req, res) => {
  const u = req.session.user;
  if (u.role !== 'agency_admin') return res.status(403).json({ error: 'Only an agency admin can change agency settings' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  run(`UPDATE agencies SET name = ? WHERE id = ?`, [name.trim(), u.agency_id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'agency_settings_updated', entityType: 'agency', entityId: u.agency_id });
  res.json({ ok: true });
});

// ===== Time disputes =====
// Surfaced inside the Issues Center. A dispute references a specific shift's
// recorded hours (clock_in_at/clock_out_at) alongside what the worker and
// client each say happened; resolving picks whose hours become authoritative.
router.get('/time-disputes', (req, res) => {
  const agencyId = req.session.user.agency_id;
  const rows = all(
    `SELECT td.*, s.job_title, s.shift_date, s.start_time, s.end_time, u.full_name as temp_name, c.company_name
     FROM time_disputes td
     JOIN shifts s ON s.id = td.shift_id
     LEFT JOIN users u ON u.id = s.temp_id
     JOIN clients c ON c.id = s.client_id
     WHERE td.agency_id = ? ORDER BY td.status ASC, td.created_at DESC`,
    [agencyId]
  );
  res.json({ disputes: rows });
});

router.post('/time-disputes', (req, res) => {
  const u = req.session.user;
  const { shiftId, reportedHours, clientClaimHours, workerClaim, clientClaim } = req.body;
  const shift = get(`SELECT * FROM shifts WHERE id = ? AND agency_id = ?`, [shiftId, u.agency_id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  if (!reportedHours) return res.status(400).json({ error: 'reportedHours required' });
  const disputeId = id('dsp');
  run(
    `INSERT INTO time_disputes (id, agency_id, shift_id, reported_hours, client_claim_hours, worker_claim, client_claim) VALUES (?,?,?,?,?,?,?)`,
    [disputeId, u.agency_id, shiftId, reportedHours, clientClaimHours || null, workerClaim || null, clientClaim || null]
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'time_dispute_opened', entityType: 'time_dispute', entityId: disputeId });
  res.json({ ok: true, disputeId });
});

router.post('/time-disputes/:id/resolve', (req, res) => {
  const u = req.session.user;
  const { resolution, resolvedHours } = req.body; // resolution: worker_approved | client_approved
  const dispute = get(`SELECT * FROM time_disputes WHERE id = ? AND agency_id = ?`, [req.params.id, u.agency_id]);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  const hours = resolvedHours != null ? resolvedHours : (resolution === 'client_approved' ? dispute.client_claim_hours : dispute.reported_hours);
  run(
    `UPDATE time_disputes SET status = 'resolved', resolution = ?, resolved_hours = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`,
    [resolution || 'manual', hours, u.id, dispute.id]
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'time_dispute_resolved', entityType: 'time_dispute', entityId: dispute.id });
  res.json({ ok: true });
});

// ===== Live alerts feed =====
// Combines open escalations and this manager's unread notifications into a
// single chronological feed for the header bell / live-alerts view.
router.get('/live-alerts', (req, res) => {
  const u = req.session.user;
  const escalations = all(
    `SELECT e.*, c.company_name FROM escalations e LEFT JOIN clients c ON c.id = e.client_id
     WHERE e.agency_id = ? AND e.status != 'resolved' ORDER BY e.created_at DESC LIMIT 20`,
    [u.agency_id]
  );
  const notifications = all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`, [u.id]);
  res.json({ escalations, notifications });
});

module.exports = router;
