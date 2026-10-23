import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),cwd=new URL('../prototype/',import.meta.url);
const source=await readFile(new URL('index.ts',cwd),'utf8');
const baseline=JSON.parse(await readFile(new URL('test/fixtures/public-sample-baseline.json',root),'utf8'));
for(const [file,hash] of Object.entries(baseline.unchanged))assert.equal(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex'),hash,file+' unchanged');
assert.equal(source.match(/const shiftMessages:[\s\S]*?let nextMessageId = 3;/)[0],baseline.seed,'No mock message seed deletion');
assert.ok(baseline.retiredClaim.includes('$2,000'));
assert.ok(!source.includes('pay the one-time $2,000'));
assert.match(source,/header \.topbtn\{display:inline-flex;align-items:center;justify-content:center;height:44px;line-height:1\.2;flex-shrink:0;white-space:nowrap\}/);
assert.match(source,/header\{gap:12px 18px;flex-wrap:wrap\}/);
assert.equal(source.match(/\.btn\{[^}]+\}/)[0],baseline.buttonCss,'Hero/button base design unchanged');
const child=spawn(process.env.BUN_BIN||'bun',['run','index.ts'],{cwd,env:{...process.env,PORT:'4351'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
const base='http://127.0.0.1:4351';
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready,output);
 for(const route of ['/agencies','/workers','/clients','/app','/dashboard','/worker-management','/client-management','/job-sites','/shift-details','/messages','/reports']){
  const response=await fetch(base+route);assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/FICTIONAL SAMPLE — NOT YOUR LIVE WORKSPACE/);assert.match(html,/href="\/practice"/);
  assert.match(html,/href="https:\/\/web-production-cd82a.up.railway.app\/login.html"/);
  assert.doesNotMatch(html,/fetch\('\/api\/messages|Loading messages|Type a real message|onclick="send(?:Client|Temp|Agency)Msg|onclick="ahSendMessage/);
  assert.doesNotMatch(html,/<td>✎|<td>Message<|<td>View ETA<|<td>View Proof<|<td>Details</);
  for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
  if(route==='/worker-management'){assert.match(html,/Log in to invite workers/);assert.match(html,/Log in to import CSV/);assert.doesNotMatch(html,/<button[^>]*>\+ Invite Worker/);}
  if(route==='/clients')assert.match(html,/href="https:\/\/web-production-cd82a.up.railway.app\/client-login.html"/);
  if(route==='/app'){assert.doesNotMatch(html,/\$2,000|unlock after purchase|Unlock Full Twanova|7-day onboarding begins|Real workforce setup begins after purchase/);assert.match(html,/No payment or automatic account activation/);}
  if(route==='/app'||route==='/workers'){
   let text='';const context={document:{getElementById:()=>({set textContent(v){text=v}})}};
   const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function setS'))[1];vm.runInNewContext(script,context);
   for(const status of ['On My Way','Arrived','Running Late','On Break','Emergency Time Off','Clocked Out']){context.setS(null,status);assert.equal(text,`Sample status: ${status} — not sent`);}
  }
 }
 for(const method of ['GET','POST','PUT','DELETE'])for(const route of ['/api/messages?thread=shift-001','/api/messages/']){
  const response=await fetch(base+route,{method,...(method==='POST'?{headers:{'content-type':'application/json'},body:JSON.stringify({text:'TEST MUST NOT BE STORED',senderName:'Spoofed sender'})}:{})});
  assert.equal(response.status,410);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();assert.match(body.error,/Public sample messaging is unavailable/);assert.ok(!JSON.stringify(body).includes('TEST MUST NOT BE STORED'));assert.ok(!Array.isArray(body));
 }
 for(const route of ['/practice','/pricing','/signup-demo?plan=5&term=2'])assert.equal((await fetch(base+route)).status,200);
 const home=await(await fetch(base+'/')).text();assert.match(home,/href="https:\/\/web-production-cd82a.up.railway.app\/agency-signup.html"/);
 console.log('PASS 11 sample pages + script compilation;12 local phone statuses explicitly not sent;8 retired API method/path cases;3 existing demo routes; primary signup/login preserved; pricing/signup/server and message seeds unchanged.');
}finally{child.kill();}
