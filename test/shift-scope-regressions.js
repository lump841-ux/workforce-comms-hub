// Privacy regression only: isolated synthetic data, loopback HTTP, never production.
const fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-shift-scope-'));
process.env.DB_PATH=path.join(dir,'test.db');
const app=require('../server'),{db,run,get,all}=require('../database/db'),bcrypt=require('bcryptjs');
const images=require('./fixtures/media.json');
let passed=0,failed=0;
const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);ok?passed++:failed++};
const hash=bcrypt.hashSync('test-only-password',4);
const tables=['shifts','shift_breaks','shift_photos','replacement_requests','replacement_candidates','conversations','conversation_participants','messages','notifications','escalations','audit_log','time_disputes'];
const snapshot=()=>JSON.stringify(tables.map(t=>all('SELECT * FROM '+t+' ORDER BY id')));
async function main(){
 for(const a of ['a','b']){
  run('INSERT INTO agencies(id,name,slug) VALUES (?,?,?)',[a,a,a]);run('INSERT INTO clients(id,agency_id,company_name) VALUES (?,?,?)',['client-'+a,a,'Site '+a]);
  run('INSERT INTO client_orgs(id,company_name) VALUES (?,?)',['org-'+a,a]);run("INSERT INTO client_org_agency_links(id,client_org_id,agency_id,client_id,status) VALUES (?,?,?,?,'active')",['link-'+a,'org-'+a,a,'client-'+a]);
  for(const role of ['temp','agency_manager','client_hr'])run('INSERT INTO users(id,agency_id,client_org_id,role,full_name,email,password_hash) VALUES (?,?,?,?,?,?,?)',[role+'-'+a,role==='client_hr'?null:a,role==='client_hr'?'org-'+a:null,role,'Person '+a,role+'-'+a+'@example.test',hash]);
  run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time) VALUES (?,?,?,?,'PRIVATE_SHIFT_RECORD','2035-01-01','08:00','16:00')",['shift-'+a,a,'client-'+a,'temp-'+a]);
 }
 run("INSERT INTO users(id,agency_id,role,full_name,email,password_hash) VALUES ('other-a','a','temp','Other worker','other-a@example.test',?)",[hash]);
 run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time) VALUES ('offer-shift','a','client-a','other-a','PRIVATE_OFFER_RECORD','2035-01-02','08:00','16:00')");
 run("INSERT INTO replacement_requests(id,agency_id,original_shift_id,status) VALUES ('offer-a','a','offer-shift','offered')");
 for(const worker of ['temp-a','temp-b'])run('INSERT INTO replacement_candidates(id,replacement_request_id,temp_id) VALUES (?,?,?)',['candidate-'+worker,'offer-a',worker]);
 run("INSERT INTO shift_breaks(id,shift_id,temp_id) VALUES ('break-a','shift-a','temp-a')");
 run("INSERT INTO time_disputes(id,agency_id,shift_id,reported_hours) VALUES ('dispute-a','a','shift-a',8)");
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function request(route,cookie,body,method='POST'){
  const res=await fetch(base+route,{method,headers:{'content-type':'application/json','x-twanova-csrf':'1',...(cookie?{cookie}:{})},...(method==='POST'?{body:JSON.stringify(body||{})}:{})});
  return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const cookies={};async function login(actor){const r=await request('/api/auth/login',null,{email:actor+'@example.test',password:'test-only-password'});check(r.status===200,'fixture login '+actor);cookies[actor]=r.cookie;return r.cookie}
 for(const actor of ['temp-a','temp-b','agency_manager-a','agency_manager-b','client_hr-a','client_hr-b'])await login(actor);
 const workerRoutes=[['/shifts/shift-a/care-team',null,'GET'],['/shifts/shift-a/breaks',null,'GET'],['/shifts/shift-a/photos',null,'GET'],['/shifts/shift-a/timeline',null,'GET'],...['confirm','clock-in','clock-out','on-my-way','arrived','breaks/end'].map(a=>['/shifts/shift-a/'+a,{}]),['/shifts/shift-a/running-late',{eta:'09:00'}],['/shifts/shift-a/emergency',{details:'Test'}],['/shifts/shift-a/cant-make-it',{category:'other'}],['/shifts/shift-a/breaks/start',{breakType:'short'}],['/shifts/shift-a/time-dispute',{category:'other',reportedHours:8}],['/shifts/shift-a/photos',{dataUrl:images.png}],['/issues',{shiftId:'shift-a',description:'Test'}],['/open-shifts/offer-a/accept',{}],['/open-shifts/offer-a/decline',{}]];
 async function deny(actor,prefix,routes,label){
  for(const [route,body,method] of routes){const before=snapshot(),r=await request('/api/'+prefix+route,cookies[actor],body,method||'POST');check([401,403,404].includes(r.status)&&!JSON.stringify(r.body).includes('PRIVATE_'),label+' denies '+route);check(snapshot()===before,label+' no mutation '+route)}
 }
 async function workerDenied(actor,label){
  await deny(actor,'temp',workerRoutes,label);
  for(const route of ['/shifts','/open-shifts']){const r=await request('/api/temp'+route,cookies[actor],null,'GET');const rows=route==='/shifts'?[...(r.body.upcoming||[]),...(r.body.history||[])]:r.body.openShifts||[];check(r.status===401||(r.status===200&&!rows.some(s=>s.id==='shift-a'||s.id==='offer-shift')),label+' list omits old records '+route)}
 }
 await workerDenied('temp-b','foreign worker even if old candidate');
 await login('other-a');await deny('other-a','temp',workerRoutes,'same-agency unassigned worker');
 run("UPDATE users SET agency_id='b' WHERE id='temp-a'");await workerDenied('temp-a','moved worker stale session');await login('temp-a');await workerDenied('temp-a','moved worker fresh login');
 run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time) VALUES ('new-agency-shift','b','client-b','temp-a','New agency valid','2035-02-01','08:00','16:00')");
 check((await request('/api/temp/shifts/new-agency-shift/on-my-way',cookies['temp-a'])).status===200,'fresh moved worker can act on newly assigned current-agency shift');
 const currentList=await request('/api/temp/shifts',cookies['temp-a'],null,'GET');check(currentList.body.upcoming.some(s=>s.id==='new-agency-shift')&&!currentList.body.upcoming.some(s=>s.id==='shift-a'),'moved worker sees current assignment not prior agency');
 const directory=await request('/api/client/workers',cookies['client_hr-a'],null,'GET');check(directory.status===200&&!directory.body.workers.some(w=>w.id==='temp-a'),'prior client roster omits moved worker current profile');
 run("UPDATE users SET agency_id='a' WHERE id='temp-a'");await login('temp-a');
 const clientRoutes=[...['confirm-arrival','report-absent','report-left-early'].map(a=>['/shifts/shift-a/'+a,{}]),['/shifts/shift-a/time-correction',{clientClaimHours:8}],['/time-disputes/dispute-a/verify',{}],['/replacement-requests',{shiftId:'shift-a',reason:'Test'}],['/replacement-requests/offer-a/confirm',{}],['/raise-issue',{shiftId:'shift-a',subject:'Test',message:'Test'}],['/shifts/shift-a/photos',null,'GET'],['/shifts/shift-a/timeline',null,'GET'],['/shifts/shift-a/photos',{dataUrl:images.png}]];
 await deny('client_hr-b','client',clientRoutes,'foreign client');
 for(const table of ['shifts','clients']){
  if(table==='shifts')run("UPDATE shifts SET archived_at=datetime('now') WHERE agency_id='a'");else run("UPDATE clients SET archived_at=datetime('now') WHERE id='client-a'");
  await workerDenied('temp-a',table+' archive');await deny('client_hr-a','client',clientRoutes,table+' archive');
  for(const route of ['/shifts','/today','/workers','/attendance','/replacement-requests','/reports','/overview']){
   const r=await request('/api/client'+route,cookies['client_hr-a'],null,'GET');
   const rows=r.body.shifts||r.body.workers||r.body.requests||[];
   check(r.status===401||(r.status===200&&rows.length===0&&!(r.body.totalShifts||r.body.todayShiftCount||r.body.openEscalations||r.body.escalationCount)),table+' archive filtered client '+route);
  }
  if(table==='shifts')run("UPDATE shifts SET archived_at=NULL WHERE agency_id='a'");else run("UPDATE clients SET archived_at=NULL WHERE id='client-a'");
  await login('client_hr-a');
 }
 // Explicit missing shift IDs never become unscoped emergency/issue conversations.
 await deny('temp-a','temp',[['/shifts/missing/emergency',{details:'Test'}],['/issues',{shiftId:'missing',description:'Test'}]],'missing worker shift');
 await deny('client_hr-a','client',[['/raise-issue',{shiftId:'missing',subject:'Test',message:'Test'}]],'missing client shift');
 // Valid normal worker/client flows remain supported.
 for(const [route,body] of [['confirm',{}],['on-my-way',{}],['running-late',{eta:'09:00'}],['arrived',{}],['clock-in',{}],['breaks/end',{}],['breaks/start',{breakType:'short'}],['breaks/end',{}],['clock-out',{}],['emergency',{details:'Test normal escalation'}],['time-dispute',{category:'other',reportedHours:8}]])check((await request('/api/temp/shifts/shift-a/'+route,cookies['temp-a'],body)).status===200,'normal worker '+route);
 check((await request('/api/temp/shifts/shift-a/care-team',cookies['temp-a'],null,'GET')).body.supervisors.length===1,'normal current worker supervisor list');
 check((await request('/api/temp/shifts/shift-a/breaks',cookies['temp-a'],null,'GET')).body.breaks.length===2,'normal current worker break history');
 for(const shiftId of ['shift-a',null])check((await request('/api/temp/issues',cookies['temp-a'],{shiftId,description:'Normal issue'})).status===200,'normal worker optional issue '+shiftId);
 for(const shiftId of ['shift-a',null])check((await request('/api/client/raise-issue',cookies['client_hr-a'],{shiftId,subject:'Normal issue',message:'Test'})).status===200,'normal client optional issue '+shiftId);
 for(const [route,body] of [['/shifts/shift-a/confirm-arrival',{}],['/shifts/shift-a/report-absent',{}],['/shifts/shift-a/report-left-early',{}],['/shifts/shift-a/time-correction',{clientClaimHours:8}],['/time-disputes/dispute-a/verify',{}]])check((await request('/api/client'+route,cookies['client_hr-a'],body)).status===200,'normal supervisor '+route);
 // The archived latest shift must not supply the roster's last_status subquery.
 run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time,status,archived_at) VALUES ('archived-latest','a','client-a','temp-a','Archived only','2036-01-01','08:00','16:00','PRIVATE_ARCHIVED_STATUS',datetime('now'))");
 const roster=await request('/api/client/workers',cookies['client_hr-a'],null,'GET');check(roster.status===200&&roster.body.workers.find(w=>w.id==='temp-a').last_status==='completed','nested roster status excludes archived latest shift');
 check((await request('/api/temp/open-shifts',cookies['temp-a'],null,'GET')).body.openShifts.some(s=>s.replacement_request_id==='offer-a'),'normal current offer listed');
 check((await request('/api/temp/open-shifts/offer-a/decline',cookies['temp-a'])).status===200,'normal candidate decline');
 run("UPDATE replacement_candidates SET response=NULL WHERE id='candidate-temp-a'");
 const accepted=await request('/api/temp/open-shifts/offer-a/accept',cookies['temp-a']);check(accepted.status===200&&accepted.body.newShiftId,'normal candidate acceptance remains atomic service flow');
 check((await request('/api/client/replacement-requests/offer-a/confirm',cookies['client_hr-a'])).status===200,'normal supervisor confirms replacement despite original replaced status');
 // Valid multi-agency client switching remains supported by the shared helper.
 run("INSERT INTO client_org_agency_links(id,client_org_id,agency_id,client_id,status) VALUES ('link-a-b','org-a','b','client-b','active')");
 check((await request('/api/client/switch-agency',cookies['client_hr-a'],{linkId:'link-a-b'})).status===200,'client switches to second valid agency');
 check((await request('/api/client/shifts/shift-b/confirm-arrival',cookies['client_hr-a'])).status===200,'multi-agency client action authorized for selected site');
 await deny('client_hr-a','client',[['/shifts/shift-a/confirm-arrival',{}]],'client selected other site');
 check((await request('/api/client/switch-agency',cookies['client_hr-a'],{linkId:'link-a'})).status===200,'client switches back to first valid agency');
 // Revoked/deactivated actors fail closed even with a previously authenticated cookie.
 run("UPDATE users SET active=0 WHERE id='temp-a'");await workerDenied('temp-a','inactive worker stale session');run("UPDATE users SET active=1 WHERE id='temp-a'");
 run("UPDATE client_org_agency_links SET status='pending' WHERE id='link-a'");await deny('client_hr-a','client',clientRoutes,'revoked client stale session');
 server.closeAllConnections();await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});
 console.log(`Shift privacy regressions: ${passed} passed, ${failed} failed`);process.exit(failed?1:0);
}
main().catch(e=>{console.error(e);process.exit(1)});
