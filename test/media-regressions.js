// Throwaway data and loopback HTTP only. No live accounts, media, or services.
const fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-media-'));
process.env.DB_PATH=path.join(dir,'test.db');
const policy=require('../public/media-policy'),images=require('./fixtures/media.json');
const app=require('../server'),{db,run,get}=require('../database/db');
const bcrypt=require('bcryptjs');
let passed=0,failed=0;
const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);ok?passed++:failed++};
function rejected(fn,label){try{fn();check(false,label)}catch(e){check(e.status===400,label)}}
async function main(){
 for(const [type,image] of Object.entries(images))check(policy.validateDataImage(image)===image,type+' accepted');
 const invalidImages=[null,{},'', 'javascript:alert(1)','data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',images.png.replace('image/png','image/jpeg'),'data:image/png;base64,AAAA','data:image/png;base64,***=',images.png+'\n','data:image/png;base64,'+Buffer.alloc(policy.MAX_IMAGE_BYTES+1).toString('base64')];
 const giant=Buffer.from(images.png.split(',')[1],'base64');giant.writeUInt32BE(4097,16);invalidImages.push('data:image/png;base64,'+giant.toString('base64'));
 for(const [i,v] of invalidImages.entries())rejected(()=>policy.validateDataImage(v),'invalid image '+i+' rejected');
 for(const source of ['https://example.test/a.png?x=1&y=2','/photos/worker.png',images.png])check(policy.normalizeImageSource(source)===source,'valid existing image source retained');
 for(const source of ['javascript:alert(1)','data:text/html;base64,AAAA','data:image/svg+xml;base64,AAAA','http://example.test/a.png','//example.test/a.png','/\\example.test/a.png','https://name:pass@example.test/a.png','https://example.test/x" onerror="evil','https://example.test/x\ny','relative.png'])rejected(()=>policy.normalizeImageSource(source),'unsafe image source rejected');
 const hash=bcrypt.hashSync('test-only-password',4);
 for(const a of ['a','b']){
  run('INSERT INTO agencies(id,name,slug) VALUES (?,?,?)',[a,a,a]);
  run('INSERT INTO clients(id,agency_id,company_name) VALUES (?,?,?)',['client-'+a,a,a]);
  run('INSERT INTO client_orgs(id,company_name) VALUES (?,?)',['org-'+a,a]);
  run("INSERT INTO client_org_agency_links(id,client_org_id,agency_id,client_id,status) VALUES (?,?,?,?,'active')",['link-'+a,'org-'+a,a,'client-'+a]);
  for(const role of ['temp','agency_manager','client_hr'])run('INSERT INTO users(id,agency_id,client_org_id,role,full_name,email,password_hash) VALUES (?,?,?,?,?,?,?)',[role+'-'+a,role==='client_hr'?null:a,role==='client_hr'?'org-'+a:null,role,role+'-'+a,role+'-'+a+'@example.test',hash]);
  run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time) VALUES (?,?,?,?,'Fixture','2035-01-01','08:00','16:00')",['shift-'+a,a,'client-'+a,'temp-'+a]);
 }
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 async function request(route,cookie,body,method='POST'){
  const res=await fetch(base+route,{method,headers:{'content-type':'application/json','x-twanova-csrf':'1',...(cookie?{cookie}:{})},...(method==='POST'?{body:JSON.stringify(body||{})}:{})});
  return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const cookies={};for(const actor of ['temp-a','temp-b','client_hr-a','client_hr-b','agency_manager-a']){const r=await request('/api/auth/login',null,{email:actor+'@example.test',password:'test-only-password'});cookies[actor]=r.cookie;check(r.status===200,'fixture login '+actor)}
 const photoCount=()=>get('SELECT COUNT(*) n FROM shift_photos').n;
 const before=photoCount();
 check((await request('/api/temp/shifts/shift-a/photos',null,{dataUrl:images.png})).status===401,'anonymous photo rejected');
 check((await request('/api/temp/shifts/shift-a/photos',cookies['temp-b'],{dataUrl:images.png})).status===404,'foreign worker photo rejected');
 check((await request('/api/client/shifts/shift-a/photos',cookies['client_hr-b'],{dataUrl:images.png})).status===404,'foreign client photo rejected');
 check(photoCount()===before,'unauthorized photos no writes');
 const caption='<svg onload="globalThis.__xss=1">& test';
 for(const role of ['temp','client_hr']){
  const prefix=role==='temp'?'temp':'client';
  const r=await request('/api/'+prefix+'/shifts/shift-a/photos',cookies[role+'-a'],{dataUrl:images.png,caption});
  check(r.status===200,role+' valid photo accepted');
  const photos=await request('/api/'+prefix+'/shifts/shift-a/photos',cookies[role+'-a'],null,'GET');
  check(photos.body.photos.some(p=>p.data_url===images.png&&p.caption===caption),role+' valid image and raw literal caption round-trip');
  for(const [i,dataUrl] of invalidImages.entries()){
   const count=photoCount(),r=await request('/api/'+prefix+'/shifts/shift-a/photos',cookies[role+'-a'],{dataUrl});
   check(r.status===400&&photoCount()===count,role+' invalid image '+i+' rejected without writes');
  }
  for(const caption of [{},'x'.repeat(501)]){const count=photoCount(),r=await request('/api/'+prefix+'/shifts/shift-a/photos',cookies[role+'-a'],{dataUrl:images.png,caption});check(r.status===400&&photoCount()===count,role+' invalid caption rejected without writes')}
 }
 const fullName='<img src=x onerror="globalThis.__xss=1">';
 check((await request('/api/temp/profile',cookies['temp-a'],{fullName,avatarUrl:images.png,phone:'123',languagePref:'es'})).status===200,'profile valid data image accepted');
 let p=(await request('/api/temp/profile',cookies['temp-a'],null,'GET')).body.profile;
 check(p.full_name===fullName&&p.avatar_url===images.png&&p.language_pref==='es','profile preserves literal name and image');
 for(const body of [{avatarUrl:'javascript:alert(1)'},{avatarUrl:'data:image/svg+xml;base64,AAAA'},{avatarUrl:images.png.replace('image/png','image/jpeg')},{fullName:{}},{fullName:' '},{fullName:'x'.repeat(101)},{phone:{}},{phone:'x'.repeat(51)},{languagePref:'xx'}]){
  const before=JSON.stringify(get("SELECT * FROM users WHERE id='temp-a'")),r=await request('/api/temp/profile',cookies['temp-a'],body);
  check(r.status===400&&JSON.stringify(get("SELECT * FROM users WHERE id='temp-a'"))===before,'invalid profile rejected without writes');
 }
 check((await request('/api/temp/profile',cookies['temp-a'],{fullName:'New name'})).status===200,'name-only update supported');
 check(get("SELECT avatar_url FROM users WHERE id='temp-a'").avatar_url===images.png,'omitted avatar preserved');
 for(const avatarUrl of ['https://example.test/a.jpg?x=1&y=2','/photos/example.png'])check((await request('/api/temp/profile',cookies['temp-a'],{avatarUrl})).status===200,'existing safe URL accepted');
 const disputes=()=>get('SELECT COUNT(*) n FROM time_disputes').n;
 const count=disputes();check((await request('/api/temp/shifts/shift-a/time-dispute',cookies['temp-a'],{category:'other',reportedHours:8,workerClaim:'Test',photoDataUrl:'data:text/html;base64,AAAA'})).status===400&&disputes()===count,'dispute unsafe proof rejected before writes');
 check((await request('/api/temp/shifts/shift-a/time-dispute',cookies['temp-a'],{category:'other',reportedHours:8,workerClaim:'Test',photoDataUrl:images.jpeg})).status===200,'dispute genuine JPEG proof accepted');
 // Access is checked again against current tenant and archive state, not old ownership alone.
 const noContent=r=>[401,403,404].includes(r.status)&&!JSON.stringify(r.body).includes('data:image/');
 const proofBody={category:'other',reportedHours:8,workerClaim:'Test',photoDataUrl:images.png};
 async function blockedProof(actor,prefix,label){
  const photosBefore=photoCount(),disputesBefore=disputes();
  check(noContent(await request('/api/'+prefix+'/shifts/shift-a/photos',cookies[actor],null,'GET')),label+' cannot read photo data');
  check(noContent(await request('/api/'+prefix+'/shifts/shift-a/timeline',cookies[actor],null,'GET')),label+' cannot read alternate timeline media');
  if(prefix!=='manager')check(noContent(await request('/api/'+prefix+'/shifts/shift-a/photos',cookies[actor],{dataUrl:images.png})),label+' cannot upload photo');
  if(prefix==='temp')check(noContent(await request('/api/temp/shifts/shift-a/time-dispute',cookies[actor],proofBody)),label+' cannot attach dispute proof');
  check(photoCount()===photosBefore&&disputes()===disputesBefore,label+' denied requests have no writes');
 }
 check((await request('/api/manager/shifts/shift-a/photos',cookies['agency_manager-a'],null,'GET')).body.photos.length===2,'own agency manager sees legitimate worker and supervisor proofs');
 await blockedProof('temp-b','temp','foreign worker');await blockedProof('client_hr-b','client','foreign client');
 run("INSERT INTO shift_photos(id,shift_id,temp_id,data_url,caption) VALUES ('other-worker-photo','shift-a','temp-b',?,'other worker proof')",[images.gif]);
 const privateThread=await request('/api/conversations',cookies['agency_manager-a'],{participantIds:['client_hr-a'],shiftId:'shift-a',firstMessage:'PRIVATE_TIMELINE_BODY'});
 check(privateThread.status===200,'fixture private site conversation created');
 const workerTimeline=await request('/api/temp/shifts/shift-a/timeline',cookies['temp-a'],null,'GET');
 check(workerTimeline.status===200&&JSON.stringify(workerTimeline.body).includes(images.png),'authorized worker timeline retains owned media');
 check(!JSON.stringify(workerTimeline.body).includes(images.gif),'worker timeline omits other worker photo');
 check(!JSON.stringify(workerTimeline.body).includes('PRIVATE_TIMELINE_BODY'),'worker timeline does not expose nonparticipant message');
 for(const [actor,prefix] of [['client_hr-a','client'],['agency_manager-a','manager']]){
  const timeline=await request('/api/'+prefix+'/shifts/shift-a/timeline',cookies[actor],null,'GET');
  check(timeline.status===200&&JSON.stringify(timeline.body).includes('PRIVATE_TIMELINE_BODY'),prefix+' participant timeline retains own messages');
 }
 run("UPDATE conversations SET client_id='client-b' WHERE id=?",[privateThread.body.conversationId]);
 const mismatchedTimeline=await request('/api/client/shifts/shift-a/timeline',cookies['client_hr-a'],null,'GET');
 check(mismatchedTimeline.status===200&&!JSON.stringify(mismatchedTimeline.body).includes('PRIVATE_TIMELINE_BODY'),'malformed legacy conversation from different site excluded');
 run("UPDATE conversations SET client_id='client-a' WHERE id=?",[privateThread.body.conversationId]);
 run("UPDATE users SET agency_id='b' WHERE id='temp-a'");
 await blockedProof('temp-a','temp','moved worker old session');
 cookies['temp-a']=(await request('/api/auth/login',null,{email:'temp-a@example.test',password:'test-only-password'})).cookie;
 await blockedProof('temp-a','temp','moved worker fresh login');
 run("UPDATE users SET agency_id='a' WHERE id='temp-a'");
 cookies['temp-a']=(await request('/api/auth/login',null,{email:'temp-a@example.test',password:'test-only-password'})).cookie;
 for(const table of ['shifts','clients']){
  run('UPDATE '+table+" SET archived_at=datetime('now') WHERE id=?",[table==='shifts'?'shift-a':'client-a']);
  await blockedProof('temp-a','temp',table+' archived worker');
  await blockedProof('client_hr-a','client',table+' archived client');
  await blockedProof('agency_manager-a','manager',table+' archived manager');
  const list=await request('/api/manager/time-disputes',cookies['agency_manager-a'],null,'GET');
  check(list.status===200&&list.body.disputes.length===0,table+' archived dispute proofs hidden');
  run('UPDATE '+table+' SET archived_at=NULL WHERE id=?',[table==='shifts'?'shift-a':'client-a']);
  cookies['client_hr-a']=(await request('/api/auth/login',null,{email:'client_hr-a@example.test',password:'test-only-password'})).cookie;
 }
 run("UPDATE client_org_agency_links SET status='pending' WHERE id='link-a'");
 await blockedProof('client_hr-a','client','revoked client link');
 run("UPDATE client_org_agency_links SET status='active' WHERE id='link-a'");
 cookies['client_hr-a']=(await request('/api/auth/login',null,{email:'client_hr-a@example.test',password:'test-only-password'})).cookie;
 check((await request('/api/temp/shifts/shift-a/photos',cookies['temp-a'],null,'GET')).body.photos.length===2,'restored live worker relationship retains valid proofs');
 const oversized=await request('/api/temp/profile',cookies['temp-a'],{avatarUrl:'x'.repeat(1024*1024)});check(oversized.status===413&&typeof oversized.body.error==='string','oversized request bounded with JSON 413');
 server.closeAllConnections();await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});
 console.log(`Media API/policy checks: ${passed} passed, ${failed} failed`);process.exit(failed?1:0);
}
main().catch(e=>{console.error(e);process.exit(1)});
