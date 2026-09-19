const express = require('express');
const { run, all, get } = require('../database/db');
const { requireRole } = require('../middleware/auth');
const { acceptReplacement } = require('../services/replacement');
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

module.exports = router;
