// Runs actual UI render functions in a Node VM with inert DOM sinks.
// This validates serialization/DOM assignments, not a browser parser or visual E2E.
const fs=require('fs'),path=require('path'),vm=require('vm'),images=require('./fixtures/media.json');
let passed=0,failed=0;
const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);ok?passed++:failed++};
const payload='\"><svg onload="globalThis.__mediaXss=1">& <script>globalThis.__mediaXss=2</script>\'';
const escaped=payload.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const source=(file)=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
function safe(html,label){check(html.includes(escaped),label+' keeps malicious-looking content literal');check(!html.includes('<svg')&&!html.includes('<script')&&!html.includes(payload),label+' does not serialize injected markup')}
function makeContext(){
 const nodes={};const element=()=>({innerHTML:'',textContent:'',value:'',src:'',dataset:{},style:{},scrollHeight:0,addEventListener(){},replaceChildren(){},append(){},classList:{toggle(){}},getBoundingClientRect(){return {bottom:1,left:1}}});
 const document={getElementById(id){return nodes[id]??=element()},querySelectorAll(){return []},createElement:element,body:{insertAdjacentHTML(pos,html){nodes.body=html},appendChild(el){nodes.appended=el}},addEventListener(){}};
 const context=vm.createContext({document,console,URL,URLSearchParams,Date,atob,setTimeout:()=>0,clearTimeout,alert(){},location:{},window:{scrollTo(){}}});
 vm.runInContext(source('media-policy.js'),context);vm.runInContext(source('app.js'),context);
 return {context,nodes};
}
async function main(){
 for(const role of ['manager','client','temp']){
  const {context:c,nodes:n}=makeContext();const html=source(role+'/dashboard.html');
  check(html.indexOf('/media-policy.js')<html.indexOf('/app.js'),role+' loads media policy before helper');
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('let CURRENT_USER'));
  vm.runInContext(script.replace(/\nboot\(\);\s*$/,''),c);
  const worker={id:'safe-worker',full_name:payload,email:payload,phone:payload,client_name:payload,status:'active',activeSince:'2026-01-01',isInvite:false,shiftsCompleted:1,attendanceRate:100};
  const shift={id:'safe-shift',temp_name:payload,temp_phone:payload,temp_email:payload,job_title:payload,company_name:payload,site_name:payload,address:payload,late_eta:payload,running_late_at:'2026-01-01',shift_date:'2026-01-01',start_time:'08:00',end_time:'16:00',status:'scheduled'};
  const photos=[{id:'safe-photo',data_url:'javascript:alert(1)',caption:payload,uploader_name:payload,created_at:'2026-01-01 00:00:00'},{id:'real-photo',data_url:images.png,caption:'Real image'}];
  c.payload=payload;c.worker=worker;c.shift=shift;c.photos=photos;c.fixture={workers:[worker],shifts:[shift],stats:{},photos,breaks:[],supervisors:[]};
  vm.runInContext("CURRENT_USER={id:'current',role:'owner',full_name:'Test'};api=async()=>fixture;",c);
  if(role==='manager'){
   await vm.runInContext('loadTemps()',c);safe(n.workersTable.innerHTML,'agency roster');
   vm.runInContext('renderWorkerProfile(worker)',c);safe(n.workerProfilePanel.innerHTML,'agency worker profile');
   c.company={companyName:payload,primaryClientId:'safe-client',sites:1,supervisors:1,activeWorkers:1,issues:0,replacements:0,unreadChats:0,status:'active'};
   vm.runInContext('COMPANIES_CACHE=[company];renderClientsTable()',c);safe(n.clientsTable.innerHTML,'agency clients');
   check(n.clientsTable.innerHTML.includes("onclick=\"openHrContactModal('safe-client',this.dataset.company)\"")&&n.clientsTable.innerHTML.includes('data-company="'+escaped+'"'),'company handler consumes safely quoted data attribute, not user JS');
   vm.runInContext("openHrContactModal('safe-client',payload)",c);safe(n.modalRoot.innerHTML,'agency HR modal');
   await vm.runInContext('loadShifts()',c);safe(n.shiftsTable.innerHTML,'agency shift roster');
  }else if(role==='client'){
   await vm.runInContext('loadWorkers()',c);safe(n.workersTable.innerHTML,'client worker roster');
   c.fixture.workers=[shift];await vm.runInContext('loadTodayWorkers()',c);safe(n.todayWorkersList.innerHTML,'client current worker card');
   await vm.runInContext('loadAttendance()',c);safe(n.attendanceTable.innerHTML,'client attendance');
   check(n.attendanceTable.innerHTML.includes("onclick=\"disputeShift('safe-shift',this.dataset.tempName,this.dataset.shiftDate)\"")&&n.attendanceTable.innerHTML.includes('data-temp-name="'+escaped+'"'),'attendance handler consumes safely quoted data attribute, not user JS');
  }else{
   vm.runInContext('ALL_SHIFTS={upcoming:[shift],history:[shift]};renderShiftTables();renderToday()',c);
   safe(n.upcomingShifts.innerHTML,'worker upcoming shift');safe(n.historyShifts.innerHTML,'worker shift history');safe(n.todayCard.innerHTML,'worker assignment');
   await vm.runInContext("loadPhotoGallery('safe-shift')",c);safe(n.photoGallery.innerHTML,'worker photo caption');
   check(n.photoGallery.innerHTML.includes('src="/favicon-32.png"')&&!n.photoGallery.innerHTML.includes('javascript:'),'worker invalid stored image replaced safely');
   check(n.photoGallery.innerHTML.includes('src="'+images.png+'"'),'worker valid stored image retained');
  }
  if(role!=='temp'){
   const gallery=vm.runInContext('renderPhotoGallery(photos)',c);
   check(gallery.includes('src="/favicon-32.png"')&&!gallery.includes('javascript:'),role+' invalid stored image replaced safely');
   check(gallery.includes('src="'+images.png+'"'),role+' valid stored image retained');
   vm.runInContext("openPhotoLightbox('safe-photo')",c);safe(n.body,role+' photo caption and uploader');
  }
  check(c.__mediaXss===undefined,role+' render functions do not evaluate payload');
 }
 const {context:c,nodes:n}=makeContext();let avatar=images.png;
 c.fetch=async url=>({ok:true,status:200,json:async()=>url.endsWith('/auth/me')?{user:{role:'temp',full_name:payload}}:url.endsWith('/temp/profile')?{profile:{full_name:payload,avatar_url:avatar}}:{upcoming:[],history:[]}});
 const mobile=source('temp/mobile-beta.html'),script=[...mobile.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('let activeShift'));
 check(mobile.includes('<script src="/media-policy.js"></script>'),'mobile loads shared policy');
 vm.runInContext(script.replace(/\nrefresh\(\);\s*$/,''),c);await vm.runInContext('refresh()',c);
 check(n.profileImage.src===images.png&&n.headerPhoto.src===images.png,'mobile valid existing upload displayed');
 check(n.displayName.value===payload&&n.greet.textContent===payload.split(' ')[0],'mobile profile name uses value/textContent');
 avatar='data:image/svg+xml;base64,PHN2Zz4=';await vm.runInContext('refresh()',c);
 check(n.profileImage.src==='/favicon-32.png'&&n.headerPhoto.src==='/favicon-32.png','mobile unsafe legacy avatar replaced safely');
 avatar='https://example.test/avatar.jpg';await vm.runInContext('refresh()',c);check(n.profileImage.src===avatar,'mobile existing HTTPS avatar retained');
 console.log(`Media rendering checks: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1});
