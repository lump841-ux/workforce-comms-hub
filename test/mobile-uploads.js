// Actual mobile handlers in a Node VM with inert DOM/FileReader sinks + real loopback API.
// Not a browser parser, camera, touch, or visual acceptance test.
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-mobile-uploads-'));process.env.DB_PATH=path.join(dir,'test.db');
const app=require('../server'),{db,run,get}=require('../database/db'),bcrypt=require('bcryptjs'),images=require('./fixtures/media.json');
let passed=0,failed=0;const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);ok?passed++:failed++};
const next=()=>new Promise(r=>setImmediate(r));
class Element{
 constructor(){this._value='';this.files=[];this.style={};this.dataset={};this.children=[];this.handlers={};this.textContent='';this.innerHTML='';this.src='';this.disabled=false;this.hidden=false;this.classList={toggle(){}}}
 get value(){return this._value}set value(v){this._value=v;if(v==='')this.files=[]}
 append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=[...nodes]}
 addEventListener(type,fn){this.handlers[type]=fn}removeAttribute(name){if(name==='src')this.src=''}
}
class Reader{
 readAsDataURL(file){file.reader=this;if(file.defer)return;queueMicrotask(()=>{if(file.readError){this.onerror();return}this.result=file.contents;this.onload()})}
}
const file=(image=images.png,extra={})=>({type:'image/png',size:Buffer.from(image.split(',')[1]||'','base64').length,contents:image,...extra});
async function main(){
 run("INSERT INTO agencies(id,name,slug) VALUES ('a','A','a')");run("INSERT INTO clients(id,agency_id,company_name) VALUES ('c','a','Site <img src=x>')");
 run("INSERT INTO users(id,agency_id,role,full_name,email,password_hash) VALUES ('worker','a','temp','Actual Worker','worker@example.test',?)",[bcrypt.hashSync('test-only-password',4)]);
 for(const id of ['shift-1','shift-2'])run("INSERT INTO shifts(id,agency_id,client_id,temp_id,job_title,shift_date,start_time,end_time) VALUES (?,'a','c','worker',?,'2035-01-01','08:00','16:00')",[id,id+' <svg onload=alert(1)>']);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-twanova-csrf':'1'},body:JSON.stringify({email:'worker@example.test',password:'test-only-password'})});const cookie=login.headers.get('set-cookie').split(';')[0];check(login.status===200,'synthetic worker signed in');
 const nodes={},g=id=>nodes[id]??=new Element();let nextPostMode=null,releasePost=null,postHeld=null,confirmAnswer=false;const writes=[];
 const context=vm.createContext({document:{getElementById:g,createElement:()=>new Element(),querySelectorAll:()=>[]},window:{scrollTo(){}},location:{},alert(){},confirm:()=>confirmAnswer,FileReader:Reader,MediaPolicy:require('../public/media-policy'),URL,Date,atob,AbortController,setTimeout,clearTimeout,console,
  fetch:async(url,opts={})=>{
   if(opts.method==='POST'){
    writes.push({url,body:JSON.parse(opts.body)});const mode=nextPostMode;nextPostMode=null;
    if(mode==='hold'){postHeld=new Promise(r=>releasePost=r);await postHeld}
    if(mode==='before-drop')throw Error('Connection lost');
    if(mode==='400')return {ok:false,status:400,json:async()=>({error:'Photo rejected for test'})};
    if(mode==='missing-confirmation')return {ok:true,status:200,json:async()=>({ok:true})};
    const result=await fetch(base+url,{...opts,headers:{...opts.headers,cookie}});if(mode==='after-drop')throw Error('Response lost');return result;
   }
   return fetch(base+url,{...opts,headers:{...opts.headers,cookie}});
  }});
 const html=fs.readFileSync(path.join(__dirname,'../public/temp/mobile-beta.html'),'utf8');
 const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('let activeShift'));
 vm.runInContext(script.replace(/\nrefresh\(\);\s*$/,''),context);
 const call=(s)=>vm.runInContext(s,context);const state=(s)=>vm.runInContext(s,context);
 async function select(kind,value){g(kind+'File').files=value?[value]:[];await call(kind==='profile'?'selectProfilePhoto()':'selectProofPhoto()')}
 await call('refresh()');await call('reloadProofGallery()');
 check(g('displayName').value==='Actual Worker'&&g('saveProfile').disabled===false,'profile loaded from authenticated API');
 check(!html.includes('Maria Lopez')&&!html.includes('Supervisor: Taylor Reed')&&!html.includes('Agency Coordinator</b>'),'fake worker identity and canned messages removed');
 check(g('proofShift').children.length===2&&g('proofShift').children[0].textContent.includes('<svg'),'shift options use literal DOM text');
 const before=writes.length;await select('profile',file());
 check(writes.length===before,'profile selection does not upload');check(g('profileImage').src===images.png&&g('headerPhoto').src==='/favicon-32.png','unsaved profile preview does not change saved header');
 call("openScreen('home');openScreen('profile')");check(state('profileDraft')===images.png,'navigation preserves unsaved draft');
 call('clearProfileSelection()');check(state('profileDraft')===null&&g('profileImage').src==='/favicon-32.png','cancel restores saved profile photo');
 for(const value of [file(images.png,{type:'image/svg+xml'}),file(images.png,{size:512*1024+1}),file('data:image/png;base64,AAAA'),file(images.png,{readError:true})]){await select('profile',value);check(state('profileDraft')===null&&!g('profileStatus').textContent.includes('saved to your account'),'invalid/unreadable profile photo never saved')}
 const old=file(images.png,{defer:true});g('profileFile').files=[old];const reading=call('selectProfilePhoto()');check(g('saveProfile').disabled,'save disabled while photo is reading');await select('profile',file(images.gif,{type:'image/gif'}));old.reader.result=images.png;old.reader.onload();await reading;check(state('profileDraft')===images.gif,'older file read cannot overwrite newer selection');
 const cancelled=file(images.png,{defer:true});g('profileFile').files=[cancelled];const pending=call('selectProfilePhoto()');call('clearProfileSelection()');cancelled.reader.result=images.png;cancelled.reader.onload();await pending;check(state('profileDraft')===null,'late read after cancel ignored');
 await select('profile',file());g('displayName').value='<svg onload=alert(1)> Worker';nextPostMode='400';await call('saveProfile()');check(state('profileDraft')===images.png&&!g('saveProfile').disabled&&g('profileStatus').textContent.includes('not confirmed'),'failed save keeps draft and enables explicit retry');
 nextPostMode='hold';const firstSave=call('saveProfile()');await next();const writeCount=writes.length;await call('saveProfile()');check(writes.length===writeCount&&g('profileFile').disabled,'double Save click sends one request');releasePost();await firstSave;
 check(get("SELECT full_name FROM users WHERE id='worker'").full_name==='<svg onload=alert(1)> Worker','literal profile name reaches backend unchanged');check(get("SELECT avatar_url FROM users WHERE id='worker'").avatar_url===images.png&&g('headerPhoto').src===images.png,'confirmed profile image persisted and displayed');check(g('profileStatus').textContent==='Profile saved to your account.'&&state('profileDraft')===null,'profile success only after server confirmation');
 await select('profile',file(images.gif,{type:'image/gif'}));nextPostMode='after-drop';await call('saveProfile()');check(g('profileStatus').textContent.includes('not confirmed')&&g('headerPhoto').src===images.png,'lost profile response does not claim success');call('clearProfileSelection()');check(g('profileStatus').textContent.includes('Last confirmed photo shown')&&!g('profileStatus').textContent.includes('unchanged'),'cancelling after uncertain profile save does not claim unchanged');await select('profile',file(images.gif,{type:'image/gif'}));await call('saveProfile()');check(g('headerPhoto').src===images.gif&&get("SELECT avatar_url FROM users WHERE id='worker'").avatar_url===images.gif,'profile retry idempotently confirms saved image');
 g('proofShift').value='shift-1';await select('proof',file());g('proofCaption').value='<img src=x onerror=alert(1)> literal caption';const proofBefore=writes.length;check(g('proofImage').src===images.png&&g('proofImage').style.display==='block'&&writes.length===proofBefore,'proof preview is local until upload');await call('submitProof()');
 check(get('SELECT COUNT(*) n FROM shift_photos').n===1&&get('SELECT shift_id FROM shift_photos').shift_id==='shift-1','proof stored against explicitly selected own shift');check(g('proofGallery').children[0].children[1].textContent==='<img src=x onerror=alert(1)> literal caption','saved caption uses textContent not HTML');check(g('proofStatus').textContent.startsWith('Photo uploaded to shift-1')&&state('proofDraft')===null,'proof success names captured target and clears draft');
 const completedWrites=writes.length;await call('submitProof()');check(writes.length===completedWrites,'repeated upload after success does not resubmit cleared photo');
 await select('proof',file());nextPostMode='400';await call('submitProof()');check(state('proofDraft')!==null&&state('proofAttempt')===null&&!g('uploadProof').disabled,'known failure keeps proof retryable');await call('submitProof()');check(get('SELECT COUNT(*) n FROM shift_photos').n===2,'explicit retry after known error uploads once');
 await select('proof',file(images.gif,{type:'image/gif'}));nextPostMode='after-drop';const attemptWrites=writes.length;await call('submitProof()');check(writes.length===attemptWrites+1&&get('SELECT COUNT(*) n FROM shift_photos').n===3,'lost response with committed photo reconciles without duplicate write');check(state('proofAttempt')===null&&g('proofStatus').textContent.includes('confirmed in your saved photos'),'ambiguous successful write confirmed through saved record');
 await select('proof',file());nextPostMode='before-drop';await call('submitProof()');check(state('proofAttempt')!==null&&g('proofShift').disabled&&g('proofFile').disabled&&g('uploadProof').textContent==='Check Upload Status','unknown outcome locks draft and offers status check');const ambiguousWrites=writes.length;await call('submitProof()');check(writes.length===ambiguousWrites,'status check never automatically repeats write');confirmAnswer=false;await call('retryUnconfirmedProof()');check(writes.length===ambiguousWrites&&state('proofAttempt')!==null,'cancel retry leaves ambiguous attempt intact');call('clearProofSelection()');check(state('proofAttempt')!==null,'cancel discard keeps uncertain upload state');confirmAnswer=true;call('clearProofSelection()');check(g('proofStatus').textContent.includes('previous upload is still unconfirmed')&&!g('proofStatus').textContent.includes('No new photo'),'discard does not falsely deny an ambiguous prior write');
 await select('proof',file());nextPostMode='before-drop';await call('submitProof()');confirmAnswer=true;await call('retryUnconfirmedProof()');check(state('proofAttempt')===null&&get('SELECT COUNT(*) n FROM shift_photos').n===4,'explicit informed retry can finish after status recheck');
 await select('proof',file(images.gif,{type:'image/gif'}));nextPostMode='hold';const uploading=call('submitProof()');while(!state('proofAttempt')||!releasePost)await next();await next();const busyWrites=writes.length;await call('submitProof()');check(writes.length===busyWrites&&g('proofFile').disabled,'duplicate upload while busy sends one POST');
 context.replacementShifts=[{id:'shift-2',shift_date:'2035-01-01',job_title:'Second target',company_name:'Site'}];call('populateProofShifts(replacementShifts)');check(g('proofShift').value==='shift-1','background refresh cannot change visible target mid-upload');releasePost();await uploading;check(g('proofShift').value==='shift-2'&&g('proofStatus').textContent.includes('shift-1'),'deferred shift refresh retains truthful original target receipt');check(get('SELECT COUNT(*) n FROM shift_photos WHERE shift_id=\'shift-1\'').n===5,'in-flight photo remains attached to original target');
 const stale=file(images.png,{defer:true});g('proofFile').files=[stale];const proofRead=call('selectProofPhoto()');g('proofShift').value='shift-1';call('changeProofShift()');stale.reader.result=images.png;stale.reader.onload();await proofRead;check(state('proofDraft')===null&&g('proofImage').style.display==='none','changing shift invalidates prior file read');
 call('populateProofShifts([])');const noShiftWrites=writes.length;await select('proof',file());await call('submitProof()');check(g('uploadProof').disabled&&writes.length===noShiftWrites,'no assigned shift never uploads');
 call('populateProofShifts(replacementShifts)');await select('proof',file());g('proofCaption').value='x'.repeat(501);await call('submitProof()');check(g('proofStatus').textContent.includes('500')&&writes.length===noShiftWrites,'oversized caption rejected before upload');g('proofCaption').value='';nextPostMode='missing-confirmation';await call('submitProof()');check(state('proofAttempt')!==null&&!g('proofStatus').textContent.startsWith('Photo uploaded'),'malformed success response cannot claim uploaded');confirmAnswer=true;call('clearProofSelection()');
 run("UPDATE users SET active=0 WHERE id='worker'");await select('proof',file());await call('submitProof()');check(context.location.href==='/login.html'&&!g('proofStatus').textContent.startsWith('Photo uploaded'),'expired/revoked session redirects without fake upload success');check(get('SELECT COUNT(*) n FROM shift_photos').n===5,'auth failure adds no proof records');
 server.closeAllConnections();await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});console.log(`Mobile upload checks: ${passed} passed, ${failed} failed`);process.exit(failed?1:0);
}
main().catch(e=>{console.error(e);process.exit(1)});
