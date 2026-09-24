const express = require('express');
const { run, all, get } = require('../database/db');
const { id } = require('../services/ids');
const { requireAuth } = require('../middleware/auth');
const { notifyMany } = require('../services/notify');
const { createEscalation } = require('../services/escalation');
const { logAudit } = require('../services/audit');
const { getSupervisorsForClient } = require('../services/supervisors');

const router = express.Router();
router.use(requireAuth);

// Finds (or starts) a direct conversation between this temp and the client
// supervisor(s) assigned to a given shift — powers the "Message Supervisor"
// button so a worker never has to know a supervisor's name/email, just tap
// the shift and send.
router.post('/message-supervisor', (req, res) => {
  const u = req.session.user;
  if (u.role !== 'temp') return res.status(403).json({ error: 'Only temps can use this shortcut' });
  const { shiftId, firstMessage } = req.body;
  if (!shiftId) return res.status(400).json({ error: 'shiftId is required' });

  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ?', [shiftId, u.id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  const supervisors = getSupervisorsForClient(shift.client_id);
  if (supervisors.length === 0) return res.status(404).json({ error: 'No supervisor is assigned to this client yet' });

  // Reuse an existing open direct conversation for this shift if one exists,
  // so repeated taps don't fragment the thread.
  const existing = get(
    `SELECT c.id FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE c.shift_id = ? AND c.type = 'direct' AND cp.user_id = ? LIMIT 1`,
    [shiftId, u.id]
  );
  if (existing) {
    if (firstMessage) {
      run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [id('msg'), existing.id, u.id, firstMessage]);
      run(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`, [existing.id]);
      const others = all('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?', [existing.id, u.id]).map((r) => r.user_id);
      notifyMany(others, { type: 'message', title: `New message from ${u.full_name}`, body: firstMessage.slice(0, 140), link: `/#/conversation/${existing.id}` });
    }
    return res.json({ ok: true, conversationId: existing.id });
  }

  const convId = id('cnv');
  run(
    `INSERT INTO conversations (id, agency_id, client_id, type, subject, shift_id, created_by, priority)
     VALUES (?,?,?, 'direct', 'Message to Supervisor', ?, ?, 'normal')`,
    [convId, u.agency_id, shift.client_id, shiftId, u.id]
  );
  const allParticipants = [...new Set([u.id, ...supervisors.map((s) => s.id)])];
  for (const pid of allParticipants) {
    run(`INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?,?,?)`, [id('cvp'), convId, pid]);
  }
  if (firstMessage) {
    run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [id('msg'), convId, u.id, firstMessage]);
    notifyMany(supervisors.map((s) => s.id), { type: 'message', title: `New message from ${u.full_name}`, body: firstMessage.slice(0, 140), link: `/#/conversation/${convId}` });
  }
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'temp_messaged_supervisor', entityType: 'conversation', entityId: convId });
  res.json({ ok: true, conversationId: convId });
});

// List conversations for current user
router.get('/conversations', (req, res) => {
  const u = req.session.user;
  const rows = all(
    `SELECT c.*,
       (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
       (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
          AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) as unread_count
     FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.user_id = ?
     ORDER BY COALESCE(last_message_at, c.created_at) DESC`,
    [u.id]
  );
  res.json({ conversations: rows });
});

// Get one conversation with messages + participants
router.get('/conversations/:id', (req, res) => {
  const u = req.session.user;
  const participant = get('SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [req.params.id, u.id]);
  if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

  const conversation = get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  const messages = all(
    `SELECT m.*, u.full_name as sender_name, u.role as sender_role FROM messages m
     JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.created_at ASC`,
    [req.params.id]
  );
  const participants = all(
    `SELECT u.id, u.full_name, u.role FROM conversation_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = ?`,
    [req.params.id]
  );

  run(`UPDATE conversation_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?`, [req.params.id, u.id]);

  res.json({ conversation, messages, participants });
});

// Start a new conversation. body: { participantIds: [], subject, priority, shiftId, clientId }
router.post('/conversations', (req, res) => {
  const u = req.session.user;
  let { participantIds = [], subject, priority = 'normal', shiftId, clientId, firstMessage } = req.body;

  // Temps and client HR contacts don't pick recipients explicitly — route to agency managers by default.
  if ((!Array.isArray(participantIds) || participantIds.length === 0) && (u.role === 'temp' || u.role === 'client_hr')) {
    participantIds = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [u.agency_id]).map((r) => r.id);
  }
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'At least one other participant is required' });
  }

  const convId = id('cnv');
  run(
    `INSERT INTO conversations (id, agency_id, client_id, type, subject, shift_id, created_by, priority)
     VALUES (?,?,?,?,?,?,?,?)`,
    [convId, u.agency_id, clientId || u.client_id || null, 'direct', subject || null, shiftId || null, u.id, priority]
  );

  const allParticipants = [...new Set([u.id, ...participantIds])];
  for (const pid of allParticipants) {
    run(`INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?,?,?)`, [id('cvp'), convId, pid]);
  }

  if (firstMessage) {
    run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [id('msg'), convId, u.id, firstMessage]);
    notifyMany(
      allParticipants.filter((p) => p !== u.id),
      { type: 'message', title: `New message from ${u.full_name}`, body: firstMessage.slice(0, 140), link: `/#/conversation/${convId}` }
    );
  }

  if (priority === 'critical') {
    createEscalation({
      agencyId: u.agency_id,
      clientId: clientId || u.client_id,
      shiftId,
      conversationId: convId,
      triggeredBy: 'client_complaint',
      tier: 2,
      summary: subject || 'Critical priority conversation opened'
    });
  }

  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'conversation_started', entityType: 'conversation', entityId: convId });
  res.json({ ok: true, conversationId: convId });
});

// Post a message to an existing conversation
router.post('/conversations/:id/messages', (req, res) => {
  const u = req.session.user;
  const participant = get('SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [req.params.id, u.id]);
  if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required' });

  const msgId = id('msg');
  run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [msgId, req.params.id, u.id, body.trim()]);
  run(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
  run(`UPDATE conversation_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?`, [req.params.id, u.id]);

  const others = all('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?', [req.params.id, u.id]).map((r) => r.user_id);
  notifyMany(others, { type: 'message', title: `New message from ${u.full_name}`, body: body.slice(0, 140), link: `/#/conversation/${req.params.id}` });

  res.json({ ok: true, messageId: msgId });
});

router.post('/conversations/:id/resolve', (req, res) => {
  const u = req.session.user;
  run(`UPDATE conversations SET status = 'resolved', updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
  logAudit({ agencyId: u.agency_id, actorId: u.id, action: 'conversation_resolved', entityType: 'conversation', entityId: req.params.id });
  res.json({ ok: true });
});

// Notifications
router.get('/notifications', (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.user.id]);
  res.json({ notifications: rows });
});

router.post('/notifications/:id/read', (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  res.json({ ok: true });
});

router.post('/notifications/read-all', (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.session.user.id]);
  res.json({ ok: true });
});

module.exports = router;
