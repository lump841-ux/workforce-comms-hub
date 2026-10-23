// Isolated regression tests: never uses a caller-supplied/live database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-critical-'));
process.env.DB_PATH = path.join(dir, 'test.db');
const app = require('../server');
const { db, run, get, all } = require('../database/db');
const bcrypt = require('bcryptjs');
const { scanForNoShows, flagShiftNoShow } = require('../services/noshow');
const { acceptReplacement, confirmReplacementByClient } = require('../services/replacement');
let passed = 0, failed = 0;
function check(condition, message) { console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`); condition ? passed++ : failed++; }
let seq = 0;
function shift(agency, extra = {}) {
  const sid = `shift-${++seq}`;
  run(`INSERT INTO shifts (id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time,status,arrived_at,supervisor_confirmed_arrival_at,archived_at) VALUES (?,?,?,?,?,'2020-01-01','08:00','16:00',?,?,?,?)`, [sid,agency,`client-${agency}`,`worker-${agency}`,'Test job',extra.status || 'scheduled',extra.arrived || null,extra.confirmed || null,extra.archived || null]);
  return sid;
}
function offer(extra = {}) {
  const sid = shift('a'); const rid = `request-${++seq}`;
  const date = new Date(Date.UTC(2030,0,seq)).toISOString().slice(0,10);
  run('UPDATE shifts SET shift_date=? WHERE id=?',[date,sid]);
  run(`INSERT INTO replacement_requests (id,agency_id,original_shift_id,status) VALUES (?,?,?,?)`, [rid,'a',sid,extra.status || 'offered']);
  run(`INSERT INTO replacement_candidates (id,replacement_request_id,temp_id,response) VALUES (?,?,?,?)`, [`candidate-${seq}`,rid,extra.temp || 'replacement-a',extra.response || null]);
  return { sid, rid };
}
async function main() {
  for (const a of ['a','b']) {
    run('INSERT INTO agencies (id,name,slug) VALUES (?,?,?)',[a,a,a]);
    run('INSERT INTO clients (id,agency_id,company_name) VALUES (?,?,?)',[`client-${a}`,a,a]);
    for (const role of ['owner','worker','replacement','recruiter']) {
      run('INSERT INTO users (id,agency_id,role,full_name,email,password_hash) VALUES (?,?,?,?,?,?)',[`${role}-${a}`,a,role === 'worker' || role === 'replacement' ? 'temp' : role,role,`${role}-${a}@example.test`,bcrypt.hashSync('test-only-password',4)]);
    }
  }
  run("INSERT INTO client_orgs (id,company_name) VALUES ('org-a','Client A')");
  run("INSERT INTO client_org_agency_links (id,client_org_id,agency_id,client_id,status) VALUES ('link-a','org-a','a','client-a','active')");
  run("INSERT INTO users (id,client_org_id,role,full_name,password_hash) VALUES ('supervisor-a','org-a','client_hr','Supervisor','unused')");
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route,cookie,body) {
    const res = await fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-twanova-csrf':'1',...(cookie?{cookie}:{})},body:JSON.stringify(body || {})});
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  run("INSERT INTO users (id,role,full_name,email,password_hash) VALUES ('unscoped','owner','Unscoped','unscoped@example.test',?)",[bcrypt.hashSync('test-only-password',4)]);
  const unscoped = await request('/api/auth/login',null,{email:'unscoped@example.test',password:'test-only-password'});
  check((await request('/api/manager/no-shows/scan',unscoped.cookie)).status === 403,'missing agency context cannot trigger global scan');
  const owner = await request('/api/auth/login',null,{email:'owner-a@example.test',password:'test-only-password'});
  const recruiter = await request('/api/auth/login',null,{email:'recruiter-a@example.test',password:'test-only-password'});
  for (const a of ['a','b']) run('INSERT INTO escalations (id,agency_id,triggered_by) VALUES (?,?,?)',[`escalation-${a}`,a,'manual']);
  for (const action of ['acknowledge','resolve']) {
    check((await request(`/api/manager/escalations/escalation-b/${action}`,owner.cookie)).status === 404,`${action} rejects foreign escalation`);
    check(get("SELECT status FROM escalations WHERE id='escalation-b'").status === 'open',`${action} leaves foreign escalation untouched`);
    check((await request(`/api/manager/escalations/missing/${action}`,owner.cookie)).status === 404,`${action} rejects missing escalation`);
    check((await request(`/api/manager/escalations/escalation-a/${action}`,unscoped.cookie)).status === 404,`${action} rejects missing agency context`);
    check((await request(`/api/manager/escalations/escalation-a/${action}`,owner.cookie)).status === 200,`${action} works for own agency`);
    check((await request(`/api/manager/escalations/escalation-a/${action}`,owner.cookie)).status === 200,`${action} is safely repeatable`);
  }
  await request('/api/manager/escalations/escalation-a/acknowledge',owner.cookie);
  check(get("SELECT status FROM escalations WHERE id='escalation-a'").status === 'resolved','late acknowledge does not reopen resolved escalation');
  const foreign = shift('b');
  const denied = await request(`/api/manager/shifts/${foreign}/flag-no-show`,owner.cookie);
  check(denied.status === 404 || denied.status === 400,'foreign manual no-show rejected');
  check(get('SELECT status FROM shifts WHERE id=?',[foreign]).status === 'scheduled','foreign shift unchanged');
  check(get('SELECT COUNT(*) n FROM no_show_events WHERE shift_id=?',[foreign]).n === 0,'foreign no-show creates no event');
  const foreignScan = shift('b');
  const arrived = shift('a',{arrived:'2020-01-01 08:00:00'});
  const confirmed = shift('a',{confirmed:'2020-01-01 08:00:00'});
  const archived = shift('a',{archived:'2020-01-01 08:00:00'});
  const absent = shift('a');
  const scan = await request('/api/manager/no-shows/scan',owner.cookie);
  check(scan.status === 200 && scan.body.flagged.includes(absent),'agency scan detects its absent worker');
  check(!scan.body.flagged.includes(foreignScan),'agency scan excludes foreign shifts');
  check(get('SELECT status FROM shifts WHERE id=?',[arrived]).status === 'scheduled','arrived worker not falsely marked absent');
  check(get('SELECT status FROM shifts WHERE id=?',[confirmed]).status === 'scheduled','supervisor-confirmed arrival not falsely marked absent');
  check(get('SELECT status FROM shifts WHERE id=?',[archived]).status === 'scheduled','archived shift not scanned');
  const repeatFlag = await request(`/api/manager/shifts/${absent}/flag-no-show`,owner.cookie);
  check(get('SELECT COUNT(*) n FROM no_show_events WHERE shift_id=?',[absent]).n === 1,'repeated no-show creates no duplicate event');
  const recruiterScan = await request('/api/manager/no-shows/scan',recruiter.cookie);
  check(recruiterScan.status === 403,'recruiter cannot trigger no-show mutations');
  check(scanForNoShows().includes(foreignScan),'internal scheduled scan still scans all agencies');
  const raceArrival = shift('a');
  const staleShift = get('SELECT * FROM shifts WHERE id=?',[raceArrival]);
  run("UPDATE shifts SET arrived_at=datetime('now') WHERE id=?",[raceArrival]);
  check(flagShiftNoShow(staleShift,{automatic:true}) === null,'automatic scan rechecks arrival inside transaction');
  const first = offer();
  const accepted = acceptReplacement(first.rid,'replacement-a');
  check(accepted.ok,'offered replacement accepted');
  check(get("SELECT COUNT(*) n FROM notifications WHERE user_id='supervisor-a' AND title='Replacement worker assigned'").n === 1,'invited supervisor receives replacement notification without prior login');
  check(!acceptReplacement(first.rid,'replacement-a').ok,'repeat filled acceptance rejected');
  confirmReplacementByClient({requestId:first.rid,clientUserId:'supervisor-a',clientId:'client-a'});
  check(!acceptReplacement(first.rid,'replacement-a').ok,'repeat completed acceptance rejected');
  check(get('SELECT COUNT(*) n FROM shifts WHERE original_shift_id=?',[first.sid]).n === 1,'completed replacement has exactly one cover shift');
  for (const status of ['cancelled','requested','reviewing','searching','unfilled','completed']) {
    const closed = offer({status}); const outcome = acceptReplacement(closed.rid,'replacement-a');
    check(!outcome.ok && get('SELECT COUNT(*) n FROM shifts WHERE original_shift_id=?',[closed.sid]).n === 0,`${status} replacement cannot be accepted`);
  }
  const declined = offer({response:'declined'});
  let declinedRejected = false; try { declinedRejected = !acceptReplacement(declined.rid,'replacement-a').ok; } catch { declinedRejected = true; }
  check(declinedRejected,'declined candidate cannot accept stale offer');
  const cross = offer({temp:'replacement-b'});
  let crossRejected = false; try { crossRejected = !acceptReplacement(cross.rid,'replacement-b').ok; } catch { crossRejected = true; }
  check(crossRejected,'foreign-agency candidate rejected even if stale candidate row exists');
  for (const state of ['inactive','archived']) {
    const invalid = offer();
    if (state === 'inactive') run("UPDATE users SET active=0 WHERE id='replacement-a'");
    else run("UPDATE users SET archived_at=datetime('now') WHERE id='replacement-a'");
    let rejected = false; try { rejected = !acceptReplacement(invalid.rid,'replacement-a').ok; } catch { rejected = true; }
    check(rejected,`${state} worker cannot accept stale offer`);
    run("UPDATE users SET active=1, archived_at=NULL WHERE id='replacement-a'");
  }
  for (const state of ['completed','cancelled','replaced']) {
    const invalid = offer(); run('UPDATE shifts SET status=? WHERE id=?',[state,invalid.sid]);
    check(!acceptReplacement(invalid.rid,'replacement-a').ok,`${state} original shift cannot be replaced again`);
  }
  const overlap1 = offer(); const overlap2 = offer();
  run("UPDATE shifts SET shift_date='2040-01-01' WHERE id IN (?,?)",[overlap1.sid,overlap2.sid]);
  check(acceptReplacement(overlap1.rid,'replacement-a').ok,'first overlapping offer may be claimed');
  check(!acceptReplacement(overlap2.rid,'replacement-a').ok,'second overlapping offer rejected at acceptance');
  run("UPDATE shifts SET start_time='16:00',end_time='20:00' WHERE id=?",[overlap2.sid]);
  check(acceptReplacement(overlap2.rid,'replacement-a').ok,'back-to-back nonoverlapping offer allowed');
  const overnight = offer(); const nextDay = offer();
  run("UPDATE shifts SET shift_date='2041-01-01',start_time='22:00',end_time='06:00' WHERE id=?",[overnight.sid]);
  run("UPDATE shifts SET shift_date='2041-01-02',start_time='05:00',end_time='09:00' WHERE id=?",[nextDay.sid]);
  check(acceptReplacement(overnight.rid,'replacement-a').ok,'overnight offer may be claimed');
  check(!acceptReplacement(nextDay.rid,'replacement-a').ok,'overnight overlap on next calendar day rejected');
  const rollback = offer();
  db.exec("CREATE TRIGGER fail_test_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  try { acceptReplacement(rollback.rid,'replacement-a'); } catch {}
  db.exec('DROP TRIGGER fail_test_notification');
  check(get('SELECT status FROM replacement_requests WHERE id=?',[rollback.rid]).status === 'offered' && get('SELECT COUNT(*) n FROM shifts WHERE original_shift_id=?',[rollback.sid]).n === 0,'failed notification rolls back replacement assignment atomically');
  server.close(); db.close(); fs.rmSync(dir,{recursive:true,force:true});
  console.log(`${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
}
main().catch(e=>{console.error(e);process.exit(1)});
