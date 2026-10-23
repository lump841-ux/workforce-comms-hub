// Isolated API regression suite. Ignores caller DB_PATH; never contacts production.
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-messaging-'));
process.env.DB_PATH = path.join(dir, 'test.db');
const app = require('../server');
const { db, run, get } = require('../database/db');
const bcrypt = require('bcryptjs');
let passed = 0, failed = 0;
function check(ok, label) { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); ok ? passed++ : failed++; }
const hash = bcrypt.hashSync('test-only-password', 4);
function user(id, agency, role, org = null) {
  run('INSERT INTO users(id,agency_id,client_org_id,role,full_name,email,password_hash) VALUES (?,?,?,?,?,?,?)', [id,agency,org,role,id,id+'@example.test',hash]);
}
async function main() {
  for (const a of ['a','b']) {
    run('INSERT INTO agencies(id,name,slug) VALUES (?,?,?)',[a,a,a]);
    run('INSERT INTO clients(id,agency_id,company_name) VALUES (?,?,?)',['client-'+a,a,a]);
    run('INSERT INTO client_orgs(id,company_name) VALUES (?,?)',['org-'+a,a]);
    run("INSERT INTO client_org_agency_links(id,client_org_id,agency_id,client_id,status) VALUES (?,?,?,?,'active')",['link-'+a,'org-'+a,a,'client-'+a]);
    for (const role of ['owner','agency_admin','agency_manager','recruiter','temp']) user(role+'-'+a,a,role);
    user('client_hr-'+a,null,'client_hr','org-'+a);
    run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time) VALUES (?,?,?,?,'Fixture','2035-01-01','08:00','16:00')",['shift-'+a,a,'client-'+a,'temp-'+a]);
  }
  user('other-temp-a','a','temp'); user('inactive-a','a','agency_manager'); user('archived-a','a','agency_manager');
  run("UPDATE users SET active=0 WHERE id='inactive-a'"); run("UPDATE users SET archived_at=datetime('now') WHERE id='archived-a'");
  run("INSERT INTO clients(id,agency_id,company_name) VALUES ('other-client-a','a','Other site')");
  run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time) VALUES ('other-shift-a','a','other-client-a','other-temp-a','Fixture','2035-01-01','08:00','16:00')");
  user('unscoped',null,'client_hr');
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,cookie,body,method='POST') {
    const res=await fetch(base+route,{method,headers:{'content-type':'application/json','x-twanova-csrf':'1',...(cookie?{cookie}:{})},...(method==='POST'?{body:JSON.stringify(body||{})}:{})});
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const cookies={};
  for(const id of ['owner-a','agency_admin-a','agency_manager-a','recruiter-a','temp-a','client_hr-a','owner-b','temp-b','client_hr-b','other-temp-a','unscoped']) {
    const login=await request('/api/auth/login',null,{email:id+'@example.test',password:'test-only-password'}); cookies[id]=login.cookie;
    check(login.status===200,'fixture login '+id);
  }
  const counts=()=>['conversations','conversation_participants','messages','notifications','escalations'].map(t=>get('SELECT COUNT(*) n FROM '+t).n).join(',');
  async function denied(actor,body,label,status) { const before=counts(); const res=await request('/api/conversations',cookies[actor],body); check(res.status===(status||403),label+' rejected'); check(before===counts(),label+' has no side effects'); }
  check((await request('/api/conversations',null,{participantIds:['temp-a']})).status===401,'anonymous creation rejected');
  for(const role of ['owner','agency_admin','agency_manager','recruiter','temp','client_hr']) {
    await denied(role+'-a',{participantIds:['owner-b']},role+' foreign recipient');
    await denied(role+'-a',{participantIds:['owner-a'],clientId:'client-b'},role+' foreign client',404);
    await denied(role+'-a',{participantIds:['owner-a'],shiftId:'shift-b'},role+' foreign shift',404);
  }
  for(const id of ['missing','inactive-a','archived-a']) await denied('owner-a',{participantIds:['temp-a',id]},id+' participant');
  await denied('temp-a',{participantIds:['owner-a'],shiftId:'other-shift-a'},'worker unassigned shift',404);
  await denied('client_hr-a',{participantIds:['owner-a'],clientId:'other-client-a'},'client other site',404);
  await denied('client_hr-a',{participantIds:['other-temp-a']},'client unrelated worker');
  await denied('temp-a',{participantIds:['other-temp-a']},'worker unrelated worker');
  await denied('owner-a',{participantIds:['temp-a'],clientId:'other-client-a',shiftId:'shift-a'},'mismatched shift client',400);
  await denied('unscoped',{participantIds:['owner-a']},'unlinked client');
  await denied('owner-a',{participantIds:'temp-a'},'malformed participants',400);
  await denied('owner-a',{participantIds:['temp-a'],priority:'bad'},'invalid priority',400);
  await denied('owner-a',{participantIds:['temp-a'],firstMessage:{}},'nontext message',400);
  await denied('owner-a',{participantIds:['temp-a'],subject:'x'.repeat(201)},'oversized subject',400);
  await denied('owner-a',{participantIds:['temp-a'],firstMessage:'x'.repeat(5001)},'oversized first message',400);
  const worker=await request('/api/conversations',cookies['temp-a'],{subject:'Work question',firstMessage:'Hello'});
  check(worker.status===200,'worker default routing remains supported');
  check(get("SELECT COUNT(*) n FROM conversation_participants WHERE conversation_id=?",[worker.body.conversationId]).n===4,'defaults include only active nonarchived managers');
  const reply=await request('/api/conversations/'+worker.body.conversationId+'/messages',cookies['owner-a'],{body:'Confirmed'});
  check(reply.status===200,'manager reply remains supported');
  for(const role of ['owner','agency_admin','agency_manager','recruiter']) {
    const res=await request('/api/conversations',cookies[role+'-a'],{participantIds:['temp-a'],subject:'Direct'});
    check(res.status===200,role+' can message own worker');
  }
  const client=await request('/api/conversations',cookies['client_hr-a'],{firstMessage:'Site question'});
  check(client.status===200,'client default routing remains supported');
  const joint=await request('/api/conversations',cookies['owner-a'],{participantIds:['temp-a','temp-a','client_hr-a'],shiftId:'shift-a',priority:'critical',firstMessage:'Attention'});
  check(joint.status===200,'manager can open scoped three-role critical conversation');
  const cid=joint.body.conversationId;
  check(get('SELECT COUNT(*) n FROM conversation_participants WHERE conversation_id=?',[cid]).n===3,'duplicate recipients deduplicated');
  check(get('SELECT client_id FROM conversations WHERE id=?',[cid]).client_id==='client-a','client derived from scoped shift');
  for(const id of ['owner-b','temp-b','client_hr-b','other-temp-a','agency_admin-a']) {
    const res=await request('/api/conversations/'+cid+'/resolve',cookies[id]);
    check(res.status===404,id+' nonparticipant resolve rejected');
    check(get('SELECT status FROM conversations WHERE id=?',[cid]).status==='open','denied resolve leaves thread open');
  }
  check((await request('/api/conversations/'+cid+'/resolve',null)).status===401,'anonymous resolve rejected');
  for(const id of ['owner-a','temp-a','client_hr-a']) check((await request('/api/conversations/'+cid+'/resolve',cookies[id])).status===200,id+' participant resolve/repeat works');
  check((await request('/api/conversations/missing/resolve',cookies['owner-a'])).status===404,'missing conversation rejected');
  const supervisor=await request('/api/message-supervisor',cookies['temp-a'],{shiftId:'shift-a',firstMessage:'Supervisor question'});
  check(supervisor.status===200,'existing supervisor shortcut remains supported');
  user('client_hr-replacement',null,'client_hr','org-a');
  const replacementLogin=await request('/api/auth/login',null,{email:'client_hr-replacement@example.test',password:'test-only-password'});
  run("UPDATE users SET active=0 WHERE id='client_hr-a'");
  const replacementThread=await request('/api/message-supervisor',cookies['temp-a'],{shiftId:'shift-a',firstMessage:'For new supervisor'});
  check(replacementThread.status===200 && replacementThread.body.conversationId!==supervisor.body.conversationId,'replacement supervisor receives a fresh thread');
  check(get("SELECT COUNT(*) n FROM conversation_participants WHERE conversation_id=? AND user_id='client_hr-replacement'",[replacementThread.body.conversationId]).n===1,'new supervisor is in current shortcut audience');
  check(get("SELECT COUNT(*) n FROM notifications WHERE user_id='client_hr-replacement'").n===1,'new supervisor notified');
  check((await request('/api/conversations/'+supervisor.body.conversationId,replacementLogin.cookie,null,'GET')).status===403,'new supervisor cannot read previous supervisor history');
  check((await request('/api/message-supervisor',cookies['temp-a'],{shiftId:'shift-a'})).body.conversationId===replacementThread.body.conversationId,'same shortcut audience reuses current thread');
  const beforeArchive=counts();run("UPDATE clients SET archived_at=datetime('now') WHERE id='client-a'");
  check((await request('/api/message-supervisor',cookies['temp-a'],{shiftId:'shift-a',firstMessage:'Blocked archive'})).status===404,'archived client blocks supervisor shortcut');
  check(counts()===beforeArchive,'archived-client shortcut has no side effects');
  run("UPDATE clients SET archived_at=NULL WHERE id='client-a'");run("UPDATE users SET active=1 WHERE id='client_hr-a'");run("UPDATE users SET active=0 WHERE id='client_hr-replacement'");

  // Multi-agency client identity: creating uses selected relationship, resolving
  // its existing participating thread uses that thread's still-active relationship.
  run("INSERT INTO client_org_agency_links(id,client_org_id,agency_id,client_id,status) VALUES ('link-a-b','org-a','b','client-b','active')");
  check((await request('/api/client/switch-agency',cookies['client_hr-a'],{linkId:'link-a-b'})).status===200,'client switches to second authorized agency');
  check((await request('/api/conversations',cookies['client_hr-a'],{firstMessage:'Agency B'})).status===200,'switched client can contact agency B');
  check((await request('/api/conversations/'+cid+'/resolve',cookies['client_hr-a'])).status===200,'client retains legitimate participating agency A conversation');
  run("UPDATE client_org_agency_links SET status='declined' WHERE id='link-a'");
  check((await request('/api/conversations/'+cid+'/resolve',cookies['client_hr-a'])).status===404,'revoked relationship cannot resolve old thread');

  check((await request('/api/conversations/'+cid,null,null,'GET')).status===401,'anonymous thread read rejected');
  check((await request('/api/conversations/'+cid,cookies['client_hr-a'],null,'GET')).status===403,'revoked client cannot read previous thread');
  check((await request('/api/conversations/'+cid+'/messages',cookies['client_hr-a'],{body:'Blocked'})).status===403,'revoked client cannot reply');
  const clientList=await request('/api/conversations',cookies['client_hr-a'],null,'GET');
  check(!clientList.body.conversations.some(c=>c.id===cid),'revoked thread removed from client list');
  run("INSERT INTO notifications(id,user_id,type,title,body,link) VALUES ('historical-direct','client_hr-a','message','Past','Inaccessible history',?)",['/#/conversation/'+cid]);
  run("INSERT INTO notifications(id,user_id,type,title,body,link) VALUES ('historical-generic','client_hr-a','message','Past','Unscoped history','/client/dashboard.html')");
  const visibleNotifications=await request('/api/notifications',cookies['client_hr-a'],null,'GET');
  check(visibleNotifications.status===200 && !visibleNotifications.body.notifications.some(n=>n.id==='historical-direct'),'revoked historical conversation notification is hidden');
  check(!visibleNotifications.body.notifications.some(n=>n.id==='historical-generic'),'ambiguous client notification fails closed after relationship revocation');

  const revokedBefore=get("SELECT COUNT(*) n FROM notifications WHERE user_id='client_hr-a'").n;
  check((await request('/api/conversations/'+cid+'/messages',cookies['owner-a'],{body:'Still authorized'})).status===200,'remaining active participant can reply');
  check(get("SELECT COUNT(*) n FROM notifications WHERE user_id='client_hr-a'").n===revokedBefore,'reply does not notify revoked client participant');
  for(const body of [{},null,'', 'x'.repeat(5001)]) check((await request('/api/conversations/'+cid+'/messages',cookies['owner-a'],{body})).status===400,'invalid reply rejected');
  check((await request('/api/message-supervisor',cookies['temp-a'],{shiftId:'shift-a',firstMessage:{}})).status===400,'supervisor shortcut rejects nontext message');
  const special='<img src=x onerror="alert(1)"> literal & text';
  check((await request('/api/conversations/'+cid+'/messages',cookies['owner-a'],{body:special})).status===200,'plain-text special characters accepted');
  check((await request('/api/conversations/'+cid,cookies['owner-a'],null,'GET')).body.messages.some(m=>m.body===special),'API preserves message original text for safe rendering');
  // A notification write failure must not leave a partially sent message.
  const beforeFailure=counts();
  db.exec("CREATE TRIGGER fail_test_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'simulated notification failure'); END;");
  check((await request('/api/conversations/'+cid+'/messages',cookies['owner-a'],{body:'Rollback this'})).status===500,'simulated reply storage failure reported');
  check(counts()===beforeFailure,'failed reply rolls back message and notifications');
  check((await request('/api/conversations',cookies['owner-a'],{participantIds:['temp-a'],firstMessage:'Rollback create'})).status===500,'simulated conversation creation failure reported');
  check(counts()===beforeFailure,'failed creation rolls back thread participants and message');
  db.exec('DROP TRIGGER fail_test_notification');
  run("UPDATE users SET active=0 WHERE id='temp-a'");
  await denied('temp-a',{participantIds:['owner-a']},'deactivated session creation',401);
  check((await request('/api/conversations/'+cid+'/resolve',cookies['temp-a'])).status===401,'deactivated session cannot resolve');
  check((await request('/api/conversations',cookies['temp-a'],null,'GET')).status===401,'deactivated session cannot list conversations');
  check((await request('/api/conversations/'+cid,cookies['temp-a'],null,'GET')).status===401,'deactivated session cannot read conversation');
  check((await request('/api/conversations/'+cid+'/messages',cookies['temp-a'],{body:'Blocked'})).status===401,'deactivated session cannot send message');
  check((await request('/api/message-supervisor',cookies['temp-a'],{shiftId:'shift-a',firstMessage:'Blocked'})).status===401,'deactivated session cannot use supervisor shortcut');
  check((await request('/api/notifications',cookies['temp-a'],null,'GET')).status===401,'deactivated session cannot read notifications');
  await new Promise(r=>server.close(r)); db.close(); fs.rmSync(dir,{recursive:true,force:true});
  console.log(`Messaging API regressions: ${passed} passed, ${failed} failed`); process.exit(failed?1:0);
}
main().catch(e=>{console.error(e);process.exit(1)});
