// Lightweight rules-based "AI assistant" layer — no external API key required.
// Generates manager briefings, answers simple natural-language questions over
// the agency's live data, and drafts suggested messages. Swap generateText()
// for a real LLM call later without touching the callers.

const { all, get } = require('../database/db');
const { run } = require('../database/db');
const { id } = require('./ids');

function logInteraction({ agencyId, userId, kind, input, output }) {
  run(
    `INSERT INTO ai_interactions (id, agency_id, user_id, kind, input, output) VALUES (?,?,?,?,?,?)`,
    [id('ai'), agencyId, userId, kind, input || null, output]
  );
}

// Daily briefing for a manager: today's shifts, open no-shows, unresolved escalations, open replacement requests
function generateManagerBriefing(agencyId, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const todayShifts = all(`SELECT * FROM shifts WHERE agency_id = ? AND shift_date = ?`, [agencyId, today]);
  const noShows = todayShifts.filter((s) => s.status === 'no_show');
  const inProgress = todayShifts.filter((s) => ['confirmed', 'in_progress'].includes(s.status));
  const openEscalations = all(`SELECT * FROM escalations WHERE agency_id = ? AND status != 'resolved'`, [agencyId]);
  const openReplacements = all(`SELECT * FROM replacement_requests WHERE agency_id = ? AND status IN ('searching','offered')`, [agencyId]);
  const unread = all(
    `SELECT COUNT(*) c FROM messages m
     JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
     WHERE cp.user_id = ? AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`,
    [userId]
  )[0]?.c || 0;

  const lines = [];
  lines.push(`Good morning. Here's your briefing for ${today}.`);
  lines.push(`${todayShifts.length} shift(s) scheduled today, ${inProgress.length} confirmed/in progress.`);
  if (noShows.length > 0) {
    lines.push(`⚠ ${noShows.length} no-show(s) today — replacement search ${openReplacements.length > 0 ? 'in progress' : 'not yet started'}.`);
  } else {
    lines.push(`No no-shows flagged today.`);
  }
  if (openEscalations.length > 0) {
    const critical = openEscalations.filter((e) => e.tier >= 3).length;
    lines.push(`${openEscalations.length} open escalation(s)${critical ? `, ${critical} critical` : ''}.`);
  } else {
    lines.push(`No open escalations.`);
  }
  if (unread > 0) lines.push(`You have ${unread} unread message(s).`);

  const output = lines.join(' ');
  logInteraction({ agencyId, userId, kind: 'briefing', output });
  return {
    summary: output,
    stats: {
      shiftsToday: todayShifts.length,
      inProgress: inProgress.length,
      noShows: noShows.length,
      openEscalations: openEscalations.length,
      openReplacements: openReplacements.length,
      unreadMessages: unread
    }
  };
}

// Simple Q&A over agency data — pattern-matches common manager questions
function answerQuestion(agencyId, userId, question) {
  const q = question.toLowerCase();
  let answer;

  if (q.includes('no-show') || q.includes('no show')) {
    const count = get(`SELECT COUNT(*) c FROM no_show_events WHERE agency_id = ? AND resolved = 0`, [agencyId]).c;
    answer = `There are currently ${count} unresolved no-show event(s) for your agency.`;
  } else if (q.includes('escalation')) {
    const rows = all(`SELECT * FROM escalations WHERE agency_id = ? AND status != 'resolved' ORDER BY tier DESC LIMIT 5`, [agencyId]);
    answer = rows.length
      ? `Open escalations (highest tier first): ${rows.map((r) => `Tier ${r.tier} — ${r.summary || r.triggered_by}`).join('; ')}`
      : `No open escalations right now.`;
  } else if (q.includes('replace')) {
    const rows = all(`SELECT * FROM replacement_requests WHERE agency_id = ? AND status IN ('searching','offered')`, [agencyId]);
    answer = rows.length
      ? `${rows.length} replacement request(s) still open, awaiting a temp to accept.`
      : `No open replacement requests.`;
  } else if (q.includes('unread') || q.includes('message')) {
    const c = all(
      `SELECT COUNT(*) c FROM messages m
       JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
       WHERE cp.user_id = ? AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`,
      [userId]
    )[0]?.c || 0;
    answer = `You have ${c} unread message(s).`;
  } else {
    const b = generateManagerBriefing(agencyId, userId);
    answer = `Here's a quick overview: ${b.summary}`;
  }

  logInteraction({ agencyId, userId, kind: 'qa', input: question, output: answer });
  return answer;
}

// Drafts a suggested reply for a conversation, based on its subject/priority
function draftMessage({ agencyId, userId, conversationSubject, priority }) {
  let draft;
  if (priority === 'critical') {
    draft = `Thanks for flagging this — treating it as urgent. I'm on it now and will update you within 15 minutes.`;
  } else if (priority === 'urgent') {
    draft = `Got it, looking into this right away. Will follow up shortly with next steps.`;
  } else {
    draft = `Thanks for the update — noted. Let me know if anything changes before the shift.`;
  }
  logInteraction({ agencyId, userId, kind: 'draft_message', input: conversationSubject, output: draft });
  return draft;
}

module.exports = { generateManagerBriefing, answerQuestion, draftMessage };
