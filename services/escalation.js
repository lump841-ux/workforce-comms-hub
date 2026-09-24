const { run, all, get } = require('../database/db');
const { id } = require('./ids');
const { notifyMany } = require('./notify');
const { logAudit } = require('./audit');
const { getSupervisorsForClient, isAfterHours } = require('./supervisors');

// Tier 1 = agency managers on the shift's agency
// Tier 2 = agency managers + agency admins (escalated after time threshold or repeat issue)
// Tier 3 = agency admins + client HR contacts on that client account (critical — this is
// how EMERGENCY and other "everyone needs to know right now" events reach the supervisor
// immediately, per the three-way communication model)
function createEscalation({ agencyId, clientId, shiftId, conversationId, triggeredBy, tier = 1, summary }) {
  const escId = id('esc');
  const afterHours = isAfterHours() ? 1 : 0;
  run(
    `INSERT INTO escalations (id, agency_id, client_id, shift_id, conversation_id, triggered_by, tier, summary, after_hours)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [escId, agencyId, clientId || null, shiftId || null, conversationId || null, triggeredBy, tier, summary || null, afterHours]
  );

  const recipients = resolveRecipients({ agencyId, clientId, tier });
  const afterHoursNote = afterHours ? ' (after hours)' : '';
  notifyMany(recipients.map((r) => r.id), {
    type: 'escalation',
    title: `Escalation (Tier ${tier}): ${triggeredBy.replace(/_/g, ' ')}${afterHoursNote}`,
    body: summary || 'A new escalation requires your attention.',
    link: `/manager/dashboard.html#escalations`
  });

  logAudit({ agencyId, action: 'escalation_created', entityType: 'escalation', entityId: escId, meta: { tier, triggeredBy, afterHours: !!afterHours } });
  return escId;
}

function resolveRecipients({ agencyId, clientId, tier }) {
  if (tier >= 3 && clientId) {
    const admins = all(`SELECT id FROM users WHERE agency_id = ? AND role = 'agency_admin'`, [agencyId]);
    const supervisors = getSupervisorsForClient(clientId);
    return [...admins, ...supervisors];
  }
  if (tier === 2) {
    return all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [agencyId]);
  }
  return all(`SELECT id FROM users WHERE agency_id = ? AND role = 'agency_manager'`, [agencyId]);
}

function acknowledgeEscalation(escId, userId) {
  run(`UPDATE escalations SET status = 'acknowledged', acknowledged_at = datetime('now'), assigned_to = ? WHERE id = ?`, [userId, escId]);
}

function resolveEscalation(escId, userId) {
  run(`UPDATE escalations SET status = 'resolved', resolved_at = datetime('now'), assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`, [userId, escId]);
}

// Auto bump: escalations open too long without acknowledgment move up a tier
function autoBumpStaleEscalations() {
  const stale = all(
    `SELECT * FROM escalations WHERE status = 'open' AND tier < 3 AND created_at <= datetime('now', '-30 minutes')`
  );
  for (const e of stale) {
    const newTier = e.tier + 1;
    run(`UPDATE escalations SET tier = ? WHERE id = ?`, [newTier, e.id]);
    const recipients = resolveRecipients({ agencyId: e.agency_id, clientId: e.client_id, tier: newTier });
    notifyMany(recipients.map((r) => r.id), {
      type: 'escalation',
      title: `Escalation bumped to Tier ${newTier}`,
      body: e.summary || 'Unacknowledged escalation automatically escalated.',
      link: `/manager/dashboard.html#escalations`
    });
  }
  return stale.length;
}

module.exports = { createEscalation, acknowledgeEscalation, resolveEscalation, autoBumpStaleEscalations };
