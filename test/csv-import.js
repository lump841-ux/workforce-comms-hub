const fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-csv-'));process.env.DB_PATH=path.join(dir,'test.db');
const app=require('../server');const {db,run,get}=require('../database/db');const bcrypt=require('bcryptjs');const {parseCsv}=require('../services/workerCsv');
let passed=0,failed=0;function check(ok,label){console.log(`${ok?'PASS':'FAIL'} ${label}`);ok?passed++:failed++;}
function rejects(csv){try{parseCsv(csv);return false;}catch{return true;}}
async function main(){
  check(parseCsv('\uFEFFfull_name,email,phone\r\n"Smith, Jane",JANE@example.test,"555-0100"\r\n')[0].fullName==='Smith, Jane','BOM CRLF and quoted comma supported');
  check(parseCsv('name,email\n"Jane ""JJ"" Doe",jj@example.test')[0].fullName==='Jane "JJ" Doe','escaped quotes supported');
  check(parseCsv('name,email\n"Jane\nDoe",jj@example.test')[0].errors.length>0,'multiline value parsed then rejected for one-line identity field');
  for(const csv of ['', 'name,email', 'name,email\n"Bad,bad@example.test', 'name,email\n"Bad"junk,x@example.test', 'name,email\nBa"d,x@example.test', 'name,email,email\nBad,x@example.test,x@example.test', 'name,password\nBad,secret', 'name,email,agency_id\nBad,x@example.test,b'])check(rejects(csv),'malformed or unsupported CSV rejected');
  check(rejects('name,email\n'+Array.from({length:501},(_,i)=>`Worker ${i},w${i}@example.test`).join('\n')),'501 worker row limit enforced');
  check(parseCsv('name,email\n'+Array.from({length:500},(_,i)=>`Worker ${i},w${i}@example.test`).join('\n')).length===500,'500 workers accepted by parser');
  check(rejects('name,email\n'+ 'x'.repeat(128*1024)),'byte bound enforced');
  check(rejects('name,email\n'+ 'x'.repeat(4097)+',x@example.test'),'field length bound enforced');
  for(const a of ['a','b']){
    run('INSERT INTO agencies(id,name,slug) VALUES (?,?,?)',[a,a,a]);
    for(const role of ['owner','temp','recruiter'])run('INSERT INTO users(id,agency_id,role,full_name,email,password_hash) VALUES (?,?,?,?,?,?)',[`${role}-${a}`,a,role,role,`${role}-${a}@example.test`,bcrypt.hashSync('test-only',4)]);
  }
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  async function req(route,cookie,body){const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-twanova-csrf':'1',...(cookie?{cookie}:{})},body:JSON.stringify(body||{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function login(email){return (await req('/api/auth/login',null,{email,password:'test-only'})).cookie;}
  let a=await login('owner-a@example.test'),b=await login('owner-b@example.test'),temp=await login('temp-a@example.test'),recruiter=await login('recruiter-a@example.test');
  const url='/api/manager/worker-import/';const csv='full_name,email,phone\n"Smith, Jane",jane@example.test,555-0100\nSecond,second@example.test,';
  check((await req(url+'preview',null,{csv})).status===401,'anonymous preview denied');
  check((await req(url+'preview',temp,{csv})).status===403,'worker role preview denied');
  check((await req(url+'preview',recruiter,{csv})).status===200,'recruiter may preview worker import');
  const preview=await req(url+'preview',a,{csv});check(preview.status===200&&preview.body.summary.ready===2,'valid CSV preview returns two ready rows');
  check(get('SELECT COUNT(*) n FROM temp_invites').n===0,'preview performs no database mutation');
  check(!JSON.stringify(preview.body).includes('password')&&!JSON.stringify(preview.body).includes('invitePath'),'preview returns no passwords or invitation links');
  check((await req(url+'commit',a,{importId:preview.body.importId})).status===409,'explicit import confirmation required');
  check((await req(url+'commit',b,{importId:preview.body.importId,confirm:true})).status===409,'another agency cannot commit someone else’s draft');
  const usersBefore=get('SELECT COUNT(*) n FROM users').n;
  const commit=await req(url+'commit',a,{importId:preview.body.importId,confirm:true,rows:[{email:'injected@example.test'}],agencyId:'b'});
  check(commit.status===200&&commit.body.created===2,'confirmed preview stages both invitations');
  check(commit.body.sent===0&&commit.body.accountsCreated===0&&get('SELECT COUNT(*) n FROM users').n===usersBefore,'no emails or active accounts created');
  check(get("SELECT COUNT(*) n FROM temp_invites WHERE agency_id='a'").n===2&&get("SELECT COUNT(*) n FROM temp_invites WHERE agency_id='b'").n===0,'agency identity taken from session not request');
  check(!get("SELECT id FROM temp_invites WHERE email='injected@example.test'"),'client-supplied edited rows ignored');
  check((await req(url+'commit',a,{importId:preview.body.importId,confirm:true})).status===409&&get('SELECT COUNT(*) n FROM temp_invites').n===2,'repeated commit cannot duplicate invitations');
  const duplicate=await req(url+'preview',a,{csv:'name,email\nOne,jane@example.test\nTwo,temp-a@example.test\nThree,new@example.test\nFour,NEW@example.test'});
  check(duplicate.body.summary.ready===1&&duplicate.body.summary.skipped===3,'file and existing-agency duplicates skipped case-insensitively');
  const foreign=await req(url+'preview',a,{csv:'name,email\nForeign,temp-b@example.test'});
  check(foreign.body.summary.error===1&&!foreign.body.canImport,'unavailable existing email blocks import');
  check(!JSON.stringify(foreign.body).includes('agency_id')&&!JSON.stringify(foreign.body).includes('temp-b"'),'foreign account details not returned');
  for(const csvBad of ['name,email\n,bad@example.test','name,email\nValid,invalid','name,email,phone\nValid,valid@example.test,'+'1'.repeat(41),'name,email\n<img src=x>,x@example.test','name,email\nValid,x@example.test,extra']){
    const result=await req(url+'preview',a,{csv:csvBad});check(result.body.summary.error>0&&!result.body.canImport,'invalid worker row blocks commit');
  }
  const stale=await req(url+'preview',a,{csv:'name,email\nFirst,stale1@example.test\nSecond,stale2@example.test'});
  run("INSERT INTO users(id,agency_id,role,full_name,email,password_hash) VALUES ('stale','a','temp','Stale','stale2@example.test','unused')");
  check((await req(url+'commit',a,{importId:stale.body.importId,confirm:true})).status===409&&!get("SELECT id FROM temp_invites WHERE email='stale1@example.test'"),'changed data fails whole import without partial writes');
  const rollback=await req(url+'preview',a,{csv:'name,email\nFirst,rollback1@example.test\nSecond,rollback2@example.test'});
  db.exec("CREATE TRIGGER fail_csv_test BEFORE INSERT ON temp_invites WHEN NEW.email='rollback2@example.test' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  const failure=await req(url+'commit',a,{importId:rollback.body.importId,confirm:true});db.exec('DROP TRIGGER fail_csv_test');
  check(failure.status===409&&!get("SELECT id FROM temp_invites WHERE email='rollback1@example.test'"),'insertion failure rolls back entire batch');
  check(!failure.body.error.includes('test failure'),'database failure detail not leaked');
  const valid=await req(url+'preview',a,{csv:'name,email\nOne,final@example.test'});await req(url+'preview',a,{csv:'broken'});
  check((await req(url+'commit',a,{importId:valid.body.importId,confirm:true})).status===409,'failed preview invalidates older draft');
  const expiring=await req(url+'preview',a,{csv:'name,email\nOne,expired@example.test'});
  const actualNow=Date.now; Date.now=()=>actualNow()+11*60*1000;
  const expired=await req(url+'commit',a,{importId:expiring.body.importId,confirm:true}); Date.now=actualNow;
  check(expired.status===409&&!get("SELECT id FROM temp_invites WHERE email='expired@example.test'"),'expired preview cannot create invitations');
  for(const change of ["active=0","archived_at=datetime('now')","role='temp'","agency_id='b'"]){
    a=await login('owner-a@example.test');
    const draft=await req(url+'preview',a,{csv:'name,email\nPermission,permission@example.test'});
    run(`UPDATE users SET ${change} WHERE id='owner-a'`);
    check((await req(url+'commit',a,{importId:draft.body.importId,confirm:true})).status===401,`changed actor ${change} cannot commit saved preview`);
    check((await req(url+'preview',a,{csv})).status===401,`changed actor ${change} cannot preview`);
    check(!get("SELECT id FROM temp_invites WHERE email='permission@example.test'"),'permission denial creates no invitation');
    run("UPDATE users SET active=1,archived_at=NULL,role='owner',agency_id='a' WHERE id='owner-a'");
  }
  const huge=await req(url+'preview',a,{csv:'x'.repeat(300*1024)});check(huge.status===413&&huge.body.error,'oversized JSON body returns clear 413');
  server.close();db.close();fs.rmSync(dir,{recursive:true,force:true});console.log(`${passed} passed, ${failed} failed`);process.exit(failed?1:0);
}
main().catch(e=>{console.error(e);process.exit(1)});
