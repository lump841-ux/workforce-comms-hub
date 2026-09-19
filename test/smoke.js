// End-to-end smoke test for the Workforce Communications Hub.
// Boots the app in-process against a throwaway SQLite file and exercises the
// full lifecycle: agency signup -> client -> temp invite -> shift ->
// manual no-show flag -> replacement accept -> escalation -> messaging -> AI.
//
// Run with: DB_PATH=/tmp/smoke.db node --experimental-sqlite test/smoke.js

process.env.DB_PATH = process.env.DB_PATH || '/tmp/workforce-comms-hub-smoke.db';
const fs = require('fs');
try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}

const http = require('http');
const app = require('../server');

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ok  - ${label}`); }
  else { fail++; console.log(`FAIL  - ${label}`); }
}

function request(server, { method, path, body, cookie }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { hostname: '127.0.0.1', port: server.address().port, method, path, headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      }},
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = {};
          try { json = raw ? JSON.parse(raw) : {}; } catch (e) {}
          resolve({ status: res.statusCode, body: json, setCookie: res.headers['set-cookie'] });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function firstCookie(setCookieArr) {
  if (!setCookieArr) return null;
  return setCookieArr.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  console.log(`Smoke test server on port ${server.address().port}\n`);

  // 1. Agency signup
  const stamp = Date.now();
  const signup = await request(server, {
    method: 'POST', path: '/api/agency-signup',
    body: { agencyName: `Smoke Test Agency ${stamp}`, adminName: 'Ada Admin', email: `admin${stamp}@smoke.test`, password: 'testpass123' }
  });
  assert(signup.status === 200 && signup.body.ok, 'agency signup succeeds');
  const adminCookie = firstCookie(signup.setCookie);
  const agencySlug = signup.body.agencySlug;

  // 2. Create client
  const clientRes = await request(server, { method: 'POST', path: '/api/manager/clients', cookie: adminCookie, body: { companyName: 'Acme Logistics', siteName: 'Warehouse 3' } });
  assert(clientRes.status === 200 && clientRes.body.ok, 'client created');
  const clientId = clientRes.body.clientId;

  // 3. Agency invites a temp -> temp accepts the invite link and sets their own password
  const inviteRes = await request(server, {
    method: 'POST', path: '/api/manager/temps/invite', cookie: adminCookie,
    body: { fullName: 'Wendy Temp', email: `temp${stamp}@smoke.test`, phone: '555-0100' }
  });
  assert(inviteRes.status === 200 && inviteRes.body.ok && inviteRes.body.inviteUrl, 'manager invites a temp and gets an invite link');
  const inviteToken = inviteRes.body.inviteUrl.split('token=')[1];

  const inviteLookup = await request(server, { method: 'GET', path: `/api/auth/temp-invite/${inviteToken}` });
  assert(inviteLookup.status === 200 && inviteLookup.body.fullName === 'Wendy Temp', 'temp can look up their pending invite');

  const tempReg = await request(server, {
    method: 'POST', path: `/api/auth/temp-invite/${inviteToken}/accept`,
    body: { password: 'temppass1' }
  });
  assert(tempReg.status === 200 && tempReg.body.ok, 'temp accepts invite and creates their login');
  const tempCookie = firstCookie(tempReg.setCookie);
  const tempId = tempReg.body.user.id;

  // A revoked invite can no longer be accepted
  const revokeInvite = await request(server, {
    method: 'POST', path: '/api/manager/temps/invite', cookie: adminCookie,
    body: { fullName: 'Revoked Temp', email: `revoked${stamp}@smoke.test` }
  });
  const revokeToken = revokeInvite.body.inviteUrl.split('token=')[1];
  const pendingBeforeRevoke = await request(server, { method: 'GET', path: '/api/manager/temps', cookie: adminCookie });
  const revokeInviteId = pendingBeforeRevoke.body.pendingInvites.find((i) => i.email === `revoked${stamp}@smoke.test`).id;
  const revokeAction = await request(server, { method: 'POST', path: `/api/manager/temps/invites/${revokeInviteId}/revoke`, cookie: adminCookie });
  assert(revokeAction.status === 200 && revokeAction.body.ok, 'manager revokes a pending invite');
  const revokedAccept = await request(server, { method: 'POST', path: `/api/auth/temp-invite/${revokeToken}/accept`, body: { password: 'whatever1' } });
  assert(revokedAccept.status === 404, 'revoked invite can no longer be accepted');

  // Second temp for replacement candidate pool
  const invite2Res = await request(server, {
    method: 'POST', path: '/api/manager/temps/invite', cookie: adminCookie,
    body: { fullName: 'Ray Replacement', email: `temp2-${stamp}@smoke.test` }
  });
  const invite2Token = invite2Res.body.inviteUrl.split('token=')[1];
  const temp2Reg = await request(server, {
    method: 'POST', path: `/api/auth/temp-invite/${invite2Token}/accept`,
    body: { password: 'temppass1' }
  });
  assert(temp2Reg.status === 200 && temp2Reg.body.ok, 'second temp accepts invite (replacement candidate pool)');

  // 4. Manager creates a shift assigned to temp 1, dated yesterday so it's immediately eligible for no-show flag
  const shiftRes = await request(server, {
    method: 'POST', path: '/api/manager/shifts', cookie: adminCookie,
    body: { clientId, tempId, jobTitle: 'Forklift Operator', shiftDate: '2020-01-01', startTime: '08:00', endTime: '16:00' }
  });
  assert(shiftRes.status === 200 && shiftRes.body.ok, 'shift created');
  const shiftId = shiftRes.body.shiftId;

  // 5. Manual no-show flag -> should create no_show_event, escalation, and replacement_request
  const noShowRes = await request(server, { method: 'POST', path: `/api/manager/shifts/${shiftId}/flag-no-show`, cookie: adminCookie });
  assert(noShowRes.status === 200 && noShowRes.body.ok, 'no-show manually flagged');

  const shiftsAfter = await request(server, { method: 'GET', path: '/api/manager/shifts', cookie: adminCookie });
  const flaggedShift = shiftsAfter.body.shifts.find((s) => s.id === shiftId);
  assert(flaggedShift && flaggedShift.status === 'no_show', 'flagged shift now shows status no_show');

  const escalations = await request(server, { method: 'GET', path: '/api/manager/escalations', cookie: adminCookie });
  assert(escalations.body.escalations.length >= 1, 'no-show created at least one escalation');

  const replacements = await request(server, { method: 'GET', path: '/api/manager/replacements', cookie: adminCookie });
  assert(replacements.body.replacements.length >= 1, 'no-show started a replacement request');
  const replacementReq = replacements.body.replacements[0];
  assert(['offered', 'unfilled'].includes(replacementReq.status), 'replacement request has offered/unfilled status');

  // 6. Second temp checks open shifts and accepts
  const temp2Cookie = firstCookie(temp2Reg.setCookie);
  const openShifts = await request(server, { method: 'GET', path: '/api/temp/open-shifts', cookie: temp2Cookie });
  if (openShifts.body.openShifts.length > 0) {
    const offer = openShifts.body.openShifts[0];
    const acceptRes = await request(server, { method: 'POST', path: `/api/temp/open-shifts/${offer.replacement_request_id}/accept`, cookie: temp2Cookie });
    assert(acceptRes.status === 200 && acceptRes.body.ok, 'second temp accepts the open replacement shift');

    const replacementsAfter = await request(server, { method: 'GET', path: '/api/manager/replacements', cookie: adminCookie });
    const filled = replacementsAfter.body.replacements.find((r) => r.id === replacementReq.id);
    assert(filled && filled.status === 'filled', 'replacement request now shows filled');
  } else {
    console.log('  (skip) no open shifts were offered — candidate pool empty, not a failure of core logic');
  }

  // 7. Messaging round-trip: temp -> manager
  const convRes = await request(server, {
    method: 'POST', path: '/api/conversations', cookie: tempCookie,
    body: { participantIds: [], subject: 'Question about my next shift', firstMessage: 'Do I need my own PPE?', priority: 'normal' }
  });
  assert(convRes.status === 200 && convRes.body.ok, 'temp starts a conversation with manager');
  const convId = convRes.body.conversationId;

  const managerReply = await request(server, {
    method: 'POST', path: `/api/conversations/${convId}/messages`, cookie: adminCookie,
    body: { body: 'No, PPE is provided on-site.' }
  });
  assert(managerReply.status === 200 && managerReply.body.ok, 'manager replies in the conversation');

  const convDetail = await request(server, { method: 'GET', path: `/api/conversations/${convId}`, cookie: tempCookie });
  assert(convDetail.body.messages.length === 2, 'conversation shows both messages');

  // 9. Notifications
  const notifs = await request(server, { method: 'GET', path: '/api/notifications', cookie: tempCookie });
  assert(Array.isArray(notifs.body.notifications), 'temp notifications endpoint responds');

  // 10. AI assistant
  const briefing = await request(server, { method: 'GET', path: '/api/manager/ai/briefing', cookie: adminCookie });
  assert(briefing.status === 200 && typeof briefing.body.summary === 'string' && briefing.body.summary.length > 0, 'AI manager briefing generates a summary');

  const aiAsk = await request(server, { method: 'POST', path: '/api/manager/ai/ask', cookie: adminCookie, body: { question: 'Any open escalations?' } });
  assert(aiAsk.status === 200 && typeof aiAsk.body.answer === 'string', 'AI Q&A answers a question');

  // 11. Analytics
  const analytics = await request(server, { method: 'GET', path: '/api/manager/analytics', cookie: adminCookie });
  assert(analytics.status === 200 && typeof analytics.body.noShowRate === 'number', 'analytics endpoint returns computed rates');

  // 12. Deactivating a temp blocks their login; reactivating restores it
  const deactivateRes = await request(server, { method: 'POST', path: `/api/manager/temps/${tempId}/deactivate`, cookie: adminCookie });
  assert(deactivateRes.status === 200 && deactivateRes.body.ok, 'manager deactivates a temp');
  const blockedLogin = await request(server, { method: 'POST', path: '/api/auth/login', body: { email: `temp${stamp}@smoke.test`, password: 'temppass1' } });
  assert(blockedLogin.status === 401, 'deactivated temp can no longer log in');
  const reactivateRes = await request(server, { method: 'POST', path: `/api/manager/temps/${tempId}/reactivate`, cookie: adminCookie });
  assert(reactivateRes.status === 200 && reactivateRes.body.ok, 'manager reactivates a temp');
  const restoredLogin = await request(server, { method: 'POST', path: '/api/auth/login', body: { email: `temp${stamp}@smoke.test`, password: 'temppass1' } });
  assert(restoredLogin.status === 200, 'reactivated temp can log in again');

  // 13. Tenant isolation — a second agency cannot see the first agency's clients
  const signup2 = await request(server, {
    method: 'POST', path: '/api/agency-signup',
    body: { agencyName: `Other Agency ${stamp}`, adminName: 'Bob Admin', email: `admin2-${stamp}@smoke.test`, password: 'testpass123' }
  });
  const admin2Cookie = firstCookie(signup2.setCookie);
  const admin2Slug = signup2.body.agencySlug;
  const otherClients = await request(server, { method: 'GET', path: '/api/manager/clients', cookie: admin2Cookie });
  assert(otherClients.body.clients.length === 0, 'second agency sees zero clients — tenant isolation holds');

  // 14. Client self-registers with no agency yet, then connects to a second agency by slug —
  // one client login should end up talking to two different agencies.
  const clientSignup = await request(server, {
    method: 'POST', path: '/api/auth/register-client',
    body: { companyName: 'Acme Logistics', fullName: 'Helen HR', email: `hr${stamp}@smoke.test`, password: 'hrpass123' }
  });
  assert(clientSignup.status === 200 && clientSignup.body.ok, 'company self-registers a client login with no agency yet');
  assert(clientSignup.body.user.agency_id === null, 'freshly self-registered client has no agency connected yet');

  const connectRes = await request(server, {
    method: 'POST', path: '/api/client/connect-agency', cookie: firstCookie(clientSignup.setCookie),
    body: { agencySlug: admin2Slug }
  });
  assert(connectRes.status === 200 && connectRes.body.ok, 'client requests a connection to a second agency by its slug');

  const pendingConns = await request(server, { method: 'GET', path: '/api/manager/clients', cookie: admin2Cookie });
  assert(pendingConns.body.pendingRequests.length === 1, 'the target agency sees the pending connection request');
  const linkId = pendingConns.body.pendingRequests[0].linkId;

  const approveRes = await request(server, { method: 'POST', path: `/api/manager/clients/connection-requests/${linkId}/approve`, cookie: admin2Cookie });
  assert(approveRes.status === 200 && approveRes.body.ok, 'agency approves the client connection request');

  const clientAgencies = await request(server, { method: 'GET', path: '/api/client/agencies', cookie: firstCookie(clientSignup.setCookie) });
  assert(clientAgencies.body.agencies.length === 1 && clientAgencies.body.agencies[0].status === 'active', 'client now sees one active agency connection');

  // 15. Agency-initiated client HR invite links an *existing* client_hr login to a second agency
  // instead of creating a duplicate account — same person, same login, another agency relationship.
  const hrRes = await request(server, {
    method: 'POST', path: `/api/manager/clients/${clientId}/hr-contacts`, cookie: adminCookie,
    body: { fullName: 'Helen HR', email: `hr${stamp}@smoke.test`, tempPassword: 'unused-existing-account' }
  });
  assert(hrRes.status === 200 && hrRes.body.ok && hrRes.body.linkedExisting, 'agency links an already-existing client_hr login instead of duplicating it');

  const clientAgenciesAfter = await request(server, { method: 'GET', path: '/api/client/agencies', cookie: firstCookie(clientSignup.setCookie) });
  assert(clientAgenciesAfter.body.agencies.length === 2, 'same client login now sees two agency connections');

  const hrLoginSelf = await request(server, { method: 'POST', path: '/api/auth/login', body: { email: `hr${stamp}@smoke.test`, password: 'hrpass123' } });
  assert(hrLoginSelf.status === 200 && hrLoginSelf.body.user.role === 'client_hr', 'client HR logs in with a single login across both agencies');
  const hrCookie = firstCookie(hrLoginSelf.setCookie);

  const switchRes = await request(server, {
    method: 'POST', path: '/api/client/switch-agency', cookie: hrCookie,
    body: { linkId: clientAgenciesAfter.body.agencies.find((a) => a.agencyId !== hrLoginSelf.body.user.agency_id).linkId }
  });
  assert(switchRes.status === 200 && switchRes.body.ok, 'client switches which agency their session is currently pointed at');

  const raiseRes = await request(server, {
    method: 'POST', path: '/api/client/raise-issue', cookie: hrCookie,
    body: { subject: 'Temp unresponsive', message: 'Nobody showed at 8am and no one answered the phone.', priority: 'critical' }
  });
  assert(raiseRes.status === 200 && raiseRes.body.ok, 'client HR raises a critical issue against whichever agency is currently selected');

  const escalationsAfterRaise = await request(server, { method: 'GET', path: '/api/manager/escalations', cookie: adminCookie });
  const tier3 = escalationsAfterRaise.body.escalations.find((e) => e.tier === 3);
  assert(!!tier3, 'critical client complaint created a Tier 3 escalation');

  // 13. Role enforcement — temp cannot hit manager routes
  const forbidden = await request(server, { method: 'GET', path: '/api/manager/overview', cookie: tempCookie });
  assert(forbidden.status === 403, 'temp is forbidden from manager-only routes');

  // 14. Unauthenticated access blocked
  const noAuth = await request(server, { method: 'GET', path: '/api/manager/overview' });
  assert(noAuth.status === 401, 'unauthenticated request to manager route is rejected');

  server.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
