const express = require('express');
const { db, run, all, get } = require('../database/db');
const { id } = require('../services/ids');
const { requireAuth } = require('../middleware/auth');
const { notifyMany } = require('../services/notify');
const { createEscalation } = require('../services/escalation');
const { logAudit } = require('../services/audit');
const { getSupervisorsForClient } = require('../services/supervisors');
const { activeUser, actorForSession, assignedToClient, canReceive, canAccessConversation } = require('../services/conversationAccess');

const router = express.Router();
router.use(requireAuth);
router.use(['/message-supervisor', '/conversations', '/notifications'], (req, res, next) => {
  req.messageUser = activeUser(req.session.user.id);
  if (!req.messageUser) return res.status(403).json({ error: 'This account is no longer active' });
  next();
});

function participantConversation(user, conversationId) {
  const conversation = get(`SELECT c.* FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE c.id = ? AND cp.user_id = ?`, [conversationId, user.id]);
  return canAccessConversation(user, conversation) ? conversation : null;
}

function atomicMessageWrite(fn) {
  db.exec('SAVEPOINT message_write');
  try {
    const result = fn();
    db.exec('RELEASE message_write');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO message_write');
    db.exec('RELEASE message_write');
    throw error;
  }
}

const validMessage = (text) => typeof text === 'string' && text.trim().length > 0 && text.length <= 5000;
function currentRecipients(conversationId, senderId) {
  const conversation = get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  return all('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?', [conversationId, senderId])
    .filter((participant) => canAccessConversation({ id: participant.user_id }, conversation))
    .map((participant) => participant.user_id);
}

// Finds (or starts) a direct conversation between this temp and the client
// supervisor(s) assigned to a given shift — powers the "Message Supervisor"
// button so a worker never has to know a supervisor's name/email, just tap
// the shift and send.
router.post('/message-supervisor', (req, res) => {
  const u = req.messageUser;
  if (u.role !== 'temp') return res.status(403).json({ error: 'Only temps can use this shortcut' });
  const { shiftId, firstMessage } = req.body;
  if (typeof shiftId !== 'string' || !shiftId) return res.status(400).json({ error: 'shiftId is required' });
  if (firstMessage != null && !validMessage(firstMessage)) return res.status(400).json({ error: 'Message must be text between 1 and 5000 characters' });

  const shift = get('SELECT * FROM shifts WHERE id = ? AND temp_id = ? AND agency_id = ? AND archived_at IS NULL', [shiftId, u.id, u.agency_id]);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  const client = get('SELECT id FROM clients WHERE id = ? AND agency_id = ? AND archived_at IS NULL', [shift.client_id, u.agency_id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const supervisors = getSupervisorsForClient(shift.client_id)
    .filter((supervisor) => canReceive(u, activeUser(supervisor.id), shift.client_id, shift));
  if (supervisors.length === 0) return res.status(404).json({ error: 'No supervisor is assigned to this client yet' });

  // Reuse only the exact current audience. A replacement supervisor gets a
  // fresh thread, never automatic access to another supervisor's history.
  const audience = [...new Set([u.id, ...supervisors.map((s) => s.id)])].sort();
  const existing = all(
    `SELECT c.id FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE c.shift_id = ? AND c.type = 'direct' AND cp.user_id = ? AND c.agency_id = ? AND c.client_id = ? ORDER BY c.created_at DESC`,
    [shiftId, u.id, u.agency_id, shift.client_id]
  ).find((conversation) => {
    const members = all('SELECT user_id FROM conversation_participants WHERE conversation_id = ? ORDER BY user_id', [conversation.id]);
    return JSON.stringify([...new Set(members.map((member) => member.user_id))]) === JSON.stringify(audience);
  });
  const conversationId = atomicMessageWrite(() => {
    if (existing) {
      if (firstMessage) {
        run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [id('msg'), existing.id, u.id, firstMessage]);
        run(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`, [existing.id]);
        const others = currentRecipients(existing.id, u.id);
        notifyMany(others, { type: 'message', title: `New message from ${u.full_name}`, body: firstMessage.slice(0, 140), link: `/#/conversation/${existing.id}` });
      }
      return existing.id;
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
    return convId;
  });
  res.json({ ok: true, conversationId });
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
  res.json({ conversations: rows.filter((conversation) => canAccessConversation(u, conversation)) });
});

// Get one conversation with messages + participants
router.get('/conversations/:id', (req, res) => {
  const u = req.session.user;
  const conversation = participantConversation(u, req.params.id);
  if (!conversation) return res.status(403).json({ error: 'Conversation access denied' });
  const messages = all(
    `SELECT m.*, u.full_name as sender_name, u.role as sender_role FROM messages m
     JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.created_at ASC`,
    [req.params.id]
  );
  const participants = all(
    `SELECT u.id, u.full_name, u.role FROM conversation_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = ?`,
    [req.params.id]
  );


  res.json({ conversation, messages, participants });
});

router.post('/conversations/:id/read', (req, res) => {
  const u = req.session.user;
  if (!participantConversation(u, req.params.id)) return res.status(403).json({error:'Conversation access denied'});
  run(`UPDATE conversation_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?`, [req.params.id,u.id]);
  res.json({ok:true});
});

// Start a new conversation. body: { participantIds: [], subject, priority, shiftId, clientId }
router.post('/conversations', (req, res) => {
  const u = actorForSession(req.session.user);
  if (!u) return res.status(403).json({ error: 'An active agency connection is required' });
  let { participantIds = [], subject, priority = 'normal', shiftId, clientId, firstMessage } = req.body;

  if (!Array.isArray(participantIds) || participantIds.length > 50 || participantIds.some((pid) => typeof pid !== 'string' || !pid)) {
    return res.status(400).json({ error: 'Choose valid conversation participants' });
  }
  if (!['normal', 'urgent', 'critical'].includes(priority) ||
      (subject != null && (typeof subject !== 'string' || subject.length > 200)) ||
      (firstMessage != null && (typeof firstMessage !== 'string' || firstMessage.length > 5000)) ||
      (clientId != null && (typeof clientId !== 'string' || !clientId)) ||
      (shiftId != null && (typeof shiftId !== 'string' || !shiftId))) {
    return res.status(400).json({ error: 'Invalid conversation details' });
  }
  const shift = shiftId ? get('SELECT * FROM shifts WHERE id = ? AND agency_id = ? AND archived_at IS NULL', [shiftId, u.agency_id]) : null;
  if (shiftId && (!shift || (u.role === 'temp' && shift.temp_id !== u.id) ||
      (u.role === 'client_hr' && shift.client_id !== u.client_id))) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (shift && clientId && shift.client_id !== clientId) return res.status(400).json({ error: 'Shift and client do not match' });
  clientId = clientId || (shift && shift.client_id) || (u.role === 'client_hr' ? u.client_id : null);
  if (clientId) {
    const client = get('SELECT id FROM clients WHERE id = ? AND agency_id = ? AND archived_at IS NULL', [clientId, u.agency_id]);
    if (!client || (u.role === 'client_hr' && clientId !== u.client_id) ||
        (u.role === 'temp' && !assignedToClient(u.id, u.agency_id, clientId))) {
      return res.status(404).json({ error: 'Client not found' });
    }
  }

  // Temps and client HR contacts don't pick recipients explicitly — route to agency managers by default.
  if ((!Array.isArray(participantIds) || participantIds.length === 0) && (u.role === 'temp' || u.role === 'client_hr')) {
    participantIds = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin','owner') AND active = 1 AND archived_at IS NULL`, [u.agency_id]).map((r) => r.id);
  }
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'At least one other participant is required' });
  }

  participantIds = [...new Set(participantIds)].filter((pid) => pid !== u.id);
  if (!participantIds.length || participantIds.some((pid) => !canReceive(u, activeUser(pid), clientId, shift))) {
    return res.status(403).json({ error: 'A selected participant is not available for this conversation' });
  }

  db.exec('SAVEPOINT create_conversation');
  try {
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
    db.exec('RELEASE create_conversation');
    res.json({ ok: true, conversationId: convId });
  } catch (error) {
    db.exec('ROLLBACK TO create_conversation');
    db.exec('RELEASE create_conversation');
    throw error;
  }
});

// Post a message to an existing conversation
router.post('/conversations/:id/messages', (req, res) => {
  const u = req.session.user;
  if (!participantConversation(u, req.params.id)) return res.status(403).json({ error: 'Conversation access denied' });

  const { body } = req.body;
  if (!validMessage(body)) return res.status(400).json({ error: 'Message must be text between 1 and 5000 characters' });

  const msgId = atomicMessageWrite(() => {
    const msgId = id('msg');
    run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?,?,?,?)`, [msgId, req.params.id, u.id, body.trim()]);
    run(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
    run(`UPDATE conversation_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?`, [req.params.id,u.id]);

    const others = currentRecipients(req.params.id, u.id);
    notifyMany(others, { type: 'message', title: `New message from ${u.full_name}`, body: body.slice(0, 140), link: `/#/conversation/${req.params.id}` });

    return msgId;
  });
  res.json({ ok: true, messageId: msgId });
});

router.post('/conversations/:id/resolve', (req, res) => {
  const u = req.session.user;
  const conversation = participantConversation(u, req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  run(`UPDATE conversations SET status = 'resolved', updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
  logAudit({ agencyId: conversation.agency_id, actorId: u.id, action: 'conversation_resolved', entityType: 'conversation', entityId: req.params.id });
  res.json({ ok: true });
});

// Notifications
router.get('/notifications', (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.user.id]);
  const u = req.messageUser;
  // Old generic notifications have no agency/client metadata. For a client
  // whose relationship was revoked/archived, fail closed rather than expose
  // an unscoped historical body. Thread-linked notifications can be checked.
  const links = u.role === 'client_hr' ? all(`SELECT l.status, c.archived_at FROM client_org_agency_links l
    JOIN clients c ON c.id = l.client_id WHERE l.client_org_id = ?`, [u.client_org_id]) : [];
  const canReadUnscoped = u.role !== 'client_hr' || (links.length > 0 && links.every((link) => link.status === 'active' && !link.archived_at));
  const notifications = rows.filter((notification) => {
    const match = /^\/#\/conversation\/([^/?#]+)$/.exec(notification.link || '');
    if (match) return !!participantConversation(u, match[1]);
    if ((notification.link || '').includes('/conversation/')) return false;
    return canReadUnscoped;
  });
  res.json({ notifications });
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
