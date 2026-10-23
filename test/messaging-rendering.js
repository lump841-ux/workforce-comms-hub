// Executes real dashboard render functions in a Node VM with a DOM sink stub.
// Checks template serialization and inert DOM sinks; this is NOT browser/DOM-parser E2E.
const fs=require('fs'),path=require('path'),vm=require('vm');
let passed=0,failed=0;
const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);ok?passed++:failed++};
const payload='<img src=x onerror="globalThis.__messageXss=1">MESSAGE & <script>globalThis.__messageXss=2</script> "\'';
const escapedPayload=payload.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function safe(markup,label){
 check(markup.includes(escapedPayload),label+' serializes malicious-looking content as literal escaped text');
 check(!/<(?:img|script|svg|iframe|object)\b/i.test(markup) && !/\bonerror\s*=\s*["']/.test(markup),label+' emits no injected element or handler');
}
async function main(){
 for(const role of ['manager','client','temp']){
  const nodes={}; const document={getElementById(id){return nodes[id]??=( {innerHTML:'',textContent:'',style:{},scrollHeight:0} )},querySelectorAll(){return []}};
  const context=vm.createContext({document,console,URL,Date,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
  const html=fs.readFileSync(path.join(__dirname,'../public',role,'dashboard.html'),'utf8');
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('let CURRENT_USER'));
  if(!script)throw new Error('No dashboard script');
  vm.runInContext(script.replace(/\nboot\(\);\s*$/,''),context);
  const conversation={id:'safe-id',subject:payload,last_message:payload,status:payload,priority:payload,unread_count:1,type:'escalation',created_at:'2026-01-01 08:00:00'};
  const messages=[{id:'safe-message',body:payload,sender_name:payload,sender_role:payload,sender_id:'other',created_at:'2026-01-01 08:00:00'}];
  context.fixture={conversation,messages,participants:[],conversations:[conversation],notifications:[{title:payload,body:payload,created_at:'2026-01-01 08:00:00'}],escalations:[{id:'safe-escalation',summary:payload,tier:1,company_name:'Site',triggered_by:'client_complaint',status:'open'}]};
  vm.runInContext("CURRENT_USER={id:'current',full_name:'Test'}; api=async()=>fixture;",context);
  await vm.runInContext('loadConversations()',context); safe(nodes.convList.innerHTML,role+' list');
  await vm.runInContext("openConv('safe-id')",context); safe(nodes.convPane.innerHTML,role+' thread');
  if(role==='client'){await vm.runInContext('loadIssues()',context);safe(nodes.issuesTable.innerHTML,'client issue list');await vm.runInContext("selectIssue('safe-id')",context);safe(nodes.issueDetail.innerHTML,'client issue thread')}
  if(role==='temp'){await vm.runInContext('loadNotifications()',context);safe(nodes.notifList.innerHTML,'worker notification')}
  if(role==='manager'){await vm.runInContext('loadEscalations()',context);safe(nodes.escalationsTable.innerHTML,'manager message-derived escalation')}
  check(context.__messageXss===undefined,role+' render functions never evaluate payload');
  check(vm.runInContext("escapeHtml(null)==='' && escapeHtml(0)==='0'",context),role+' safe helper handles absent/numeric fields');
 }
 console.log(`Messaging rendering checks: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1});
