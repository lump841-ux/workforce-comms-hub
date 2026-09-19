const express = require('express');
const { run, all, get } = require('../database/db');
const { id } = require('../services/ids');
const { requireRole } = require('../middleware/auth');
const { acceptReplacement, startReplacementSearch } = require('../services/replacement');
const { createEscalation } = require('../services/escalation');
const { notifyMany } = require('../services/notify');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(requireRole('temp'));

router.get('/shifts', (req, res) => {
  const u = req.session.user;
  const upcoming = all(
    `SELECT s.*, c.company_name, c.site_name FROM shifts s JOIN clients c ON c.id = s.client_id
     WHERE s.temp_id = ? AND s.status IN ('scheduled','confirmed','in_progress')
     ORDER BY s.shift_date ASC, s.start_time ASC`,
    [u.id]
  );
  const history = all(
    `SELECT s.*, c.company_name, c.site_name FROM shifts s JOIN clients c ON c.id = s.client_id
     WHERE s.temp_id = ? AND s.status IN ('completed','no_show','replaced','cancelled')
     ORDER BY s.shift_date DESC LIMIT 20`,
    [u.id]
  );
  res.json({ upcoming, history });
});

router.post('/shifts/:id/confirm', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  run(`UPDATE shifts SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?`, [req.params.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'shift_confirmed', entityType: 'shift', entityId: req.params.id });
  res.json({ ok: true });
});

router.post('/shifts/:id/clock-in', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  if (['no_show', 'replaced', 'cancelled'].includes(shift.status)) {
    return res.status(400).json({ error: 'This shift is no longer active' });
  }
  run(`UPDATE shifts SET status = 'in_progress', clock_in_at = datetime('now') WHERE id = ?`, [req.params.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'clock_in', entityType: 'shift', entityId: req.params.id });
  res.json({ ok: true });
});

router.post('/shifts/:id/clock-out', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  run(`UPDATE shifts SET status = 'completed', clock_out_at = datetime('now') WHERE id = ?`, [req.params.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'clock_out', entityType: 'shift', entityId: req.params.id });
  res.json({ ok: true });
});

// Open shifts this temp has been offered as a replacement candidate
router.get('/open-shifts', (req, res) => {
  const u = req.session.user;
  const rows = all(
    `SELECT rr.id as replacement_request_id, rr.status as request_status, s.*, c.company_name, c.site_name
     FROM replacement_candidates rc
     JOIN replacement_requests rr ON rr.id = rc.replacement_request_id
     JOIN shifts s ON s.id = rr.original_shift_id
     JOIN clients c ON c.id = s.client_id
     WHERE rc.temp_id = ? AND rc.response IS NULL AND rr.status = 'offered'
     ORDER BY s.shift_date ASC`,
    [u.id]
  );
  res.json({ openShifts: rows });
});

router.post('/open-shifts/:requestId/accept', (req, res) => {
  const u = req.session.user;
  try {
    const result = acceptReplacement(req.params.requestId, u.id);
    if (!result.ok) return res.status(409).json({ error: 'This shift has already been filled by another temp' });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/open-shifts/:requestId/decline', (req, res) => {
  const u = req.session.user;
  run(
    `UPDATE replacement_candidates SET response = 'declined', responded_at = datetime('now')
     WHERE replacement_request_id = ? AND temp_id = ?`,
    [req.params.requestId, u.id]
  );
  res.json({ ok: true });
});

// ============ SHIFT STATUS UPDATES (On My Way / Running Late / Arrived) ============
router.post('/shifts/:id/on-my-way', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  run(`UPDATE shifts SET en_route_at = datetime('now') WHERE id = ?`, [req.params.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_on_my_way', entityType: 'shift', entityId: req.params.id });
  res.json({ ok: true });
});

router.post('/shifts/:id/running-late', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT s.*, c.company_name, c.site_name FROM shifts s JOIN clients c ON c.id = s.client_id WHERE s.id = ? AND s.temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  const { minutesLate, reason } = req.body;
  run(`UPDATE shifts SET running_late_at = datetime('now') WHERE id = ?`, [req.params.id]);
  const managers = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [u.agency_id]);
  notifyMany(managers.map((m) => m.id), {
    type: 'shift_reminder',
    title: `${u.full_name} is running late`,
    body: `${shift.job_title} at ${shift.company_name}${minutesLate ? ` — about ${minutesLate} min late` : ''}${reason ? `: ${reason}` : ''}`,
    link: `/manager/dashboard.html#shifts`
  });
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_running_late', entityType: 'shift', entityId: req.params.id, meta: { minutesLate, reason } });
  res.json({ ok: true });
});

// ============ CAN'T MAKE SHIFT (cancel + trigger replacement search) ============
router.post('/shifts/:id/cant-make-it', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  if (['completed', 'no_show', 'replaced', 'cancelled'].includes(shift.status)) {
    return res.status(400).json({ error: 'This shift is no longer active' });
  }
  const { category, reason } = req.body;
  if (!category) return res.status(400).json({ error: 'A reason category is required' });

  run(
    `UPDATE shifts SET status = 'cancelled', cancel_reason_category = ?, cancel_reason = ? WHERE id = ?`,
    [category, reason || null, req.params.id]
  );

  const repId = startReplacementSearch({ shift, noShowEventId: null });

  const conv = get('SELECT id FROM conversations WHERE shift_id = ? AND type = \'escalation\' ORDER BY created_at DESC LIMIT 1', [req.params.id]);
  createEscalation({
    agencyId: u.agency_id,
    clientId: shift.client_id,
    shiftId: shift.id,
    conversationId: conv ? conv.id : null,
    triggeredBy: 'manual',
    tier: 1,
    summary: `${u.full_name} can't make ${shift.job_title} on ${shift.shift_date} (${category}${reason ? `: ${reason}` : ''})`
  });

  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_cant_make_shift', entityType: 'shift', entityId: req.params.id, meta: { category, reason } });
  res.json({ ok: true, replacementRequestId: repId });
});

// ============ BREAKS ============
router.get('/shifts/:id/breaks', (req, res) => {
  const u = req.session.user;
  const rows = all('SELECT * FROM shift_breaks WHERE shift_id = ? AND temp_id = ? ORDER BY started_at DESC', [req.params.id, u.id]);
  res.json({ breaks: rows });
});

router.post('/shifts/:id/breaks/start', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  const open = get(`SELECT * FROM shift_breaks WHERE shift_id = ? AND temp_id = ? AND ended_at IS NULL`, [req.params.id, u.id]);
  if (open) return res.status(400).json({ error: 'A break is already in progress' });

  const { breakType, paid } = req.body;
  const breakId = id('brk');
  run(
    `INSERT INTO shift_breaks (id, shift_id, temp_id, break_type, paid) VALUES (?,?,?,?,?)`,
    [breakId, req.params.id, u.id, breakType || 'short', paid === false ? 0 : 1]
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'break_started', entityType: 'shift_break', entityId: breakId });
  res.json({ ok: true, breakId });
});

router.post('/shifts/:id/breaks/end', (req, res) => {
  const u = req.session.user;
  const open = get(`SELECT * FROM shift_breaks WHERE shift_id = ? AND temp_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [req.params.id, u.id]);
  if (!open) return res.status(400).json({ error: 'No break in progress' });
  run(`UPDATE shift_breaks SET ended_at = datetime('now') WHERE id = ?`, [open.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'break_ended', entityType: 'shift_break', entityId: open.id });
  res.json({ ok: true });
});

// ============ PHOTO PROOF ============
router.get('/shifts/:id/photos', (req, res) => {
  const u = req.session.user;
  const rows = all('SELECT * FROM shift_photos WHERE shift_id = ? AND temp_id = ? ORDER BY created_at DESC', [req.params.id, u.id]);
  res.json({ photos: rows });
});

router.post('/shifts/:id/photos', (req, res) => {
  const u = req.session.user;
  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [req.params.id, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  const { dataUrl, caption } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'A photo is required' });
  const photoId = id('pho');
  run(`INSERT INTO shift_photos (id, shift_id, temp_id, data_url, caption) VALUES (?,?,?,?,?)`, [photoId, req.params.id, u.id, dataUrl, caption || null]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'photo_uploaded', entityType: 'shift_photo', entityId: photoId });
  res.json({ ok: true, photoId });
});

// ============ REPORT ISSUE ============
router.post('/issues', (req, res) => {
  const u = req.session.user;
  const { shiftId, category, description } = req.body;
  if (!description) return res.status(400).json({ error: 'A description is required' });

  const shift = shiftId ? get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [shiftId, u.id]) : null;

  const convId = id('cnv');
  const managers = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [u.agency_id]);
  run(
    `INSERT INTO conversations (id, agency_id, client_id, type, subject, shift_id, created_by, priority)
     VALUES (?,?,?,?,?,?,?,?)`,
    [convId, u.agency_id, shift ? shift.client_id : null, 'escalation', category || 'Issue reported', shiftId || null, u.id, 'urgent']
  );
  const allParticipants = [...new Set([u.id, ...managers.map((m) => m.id)])];
  for (const pid of allParticipants) {
    run(`INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?,?,?)`, [id('cvp'), convId, pid]);
  }
  run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [id('msg'), convId, u.id, description]);
  notifyMany(managers.map((m) => m.id), {
    type: 'message',
    title: `Issue reported by ${u.full_name}`,
    body: description.slice(0, 140),
    link: `/manager/dashboard.html#messages`
  });

  createEscalation({
    agencyId: u.agency_id,
    clientId: shift ? shift.client_id : null,
    shiftId: shiftId || null,
    conversationId: convId,
    triggeredBy: 'manual',
    tier: 1,
    summary: `${u.full_name}: ${category || 'Issue'} — ${description.slice(0, 140)}`
  });

  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_reported_issue', entityType: 'conversation', entityId: convId, meta: { category } });
  res.json({ ok: true, conversationId: convId });
});

// ============ PROFILE ============
router.get('/profile', (req, res) => {
  const u = req.session.user;
  const profile = get('SELECT id, full_name, email, phone, avatar_url, language_pref, created_at FROM users WHERE id = ?', [u.id]);
  res.json({ profile });
});

router.post('/profile', (req, res) => {
  const u = req.session.user;
  const { fullName, phone, languagePref, avatarUrl } = req.body;
  run(
    `UPDATE users SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone),
       language_pref = COALESCE(?, language_pref), avatar_url = COALESCE(?, avatar_url) WHERE id = ?`,
    [fullName || null, phone || null, languagePref || null, avatarUrl || null, u.id]
  );
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_updated_profile', entityType: 'user', entityId: u.id });
  res.json({ ok: true });
});

module.exports = router;
