import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
const base='http://127.0.0.1:4329';
const child=spawn(process.env.BUN_BIN,['run','index.ts'],{cwd:new URL('../prototype/',import.meta.url),env:{...process.env,PORT:'4329'},stdio:'pipe'});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
const results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS '+name)}
try{
 for(let i=0;i<60;i++){try{await fetch(base+'/health');break}catch{await new Promise(r=>setTimeout(r,100))}}
 const html=await(await fetch(base)).text();
 for(const route of ['/practice','/practice/']) await test('Practice page and isolated scripts: '+route,async()=>{const r=await fetch(base+route);const h=await r.text();assert.equal(r.status,200);assert.ok(h.includes('src="/practice-state.js"'));assert.ok(h.includes('src="/practice-ui.js"'));assert.ok(h.includes("connect-src 'none'"));});
 for(const route of ['/practice-state.js','/practice-ui.js']) {
 await test('Practice script MIME and body: '+route,async()=>{const r=await fetch(base+route);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/javascript/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.ok((await r.text()).length>100);});
 await test('Practice script HEAD and method protection: '+route,async()=>{const r=await fetch(base+route,{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');assert.equal((await fetch(base+route,{method:'POST'})).status,405);});
 }

 await test('Homepage labels concept media and sample demo; operational links unchanged',async()=>{
  assert.match(html,/ARCHIVED CONCEPT VIDEO/);assert.match(html,/Illustrative screens, not verified app behavior/);assert.match(html,/Explore Sample Agency Demo/);
  assert.match(html,/fictional data stored in your browser/);assert.match(html,/web-production-cd82a\.up\.railway\.app\/login.html/);assert.match(html,/web-production-cd82a\.up\.railway\.app\/agency-signup.html/);
  assert.doesNotMatch(html,/files2\.heygen\.ai/);
 });
 await test('Responsive header and dynamic sticky-anchor offset present',async()=>{assert.match(html,/header nav\{order:3;flex:0 0 100%/);assert.match(html,/scroll-margin-top:var\(--header-offset,160px\)/);assert.match(html,/new ResizeObserver\(update\)/);assert.match(html,/header \.topbtn\{display:inline-flex\}/)});
 const local=readFileSync(new URL('../prototype/media/twanova-overview-draft.mp4',import.meta.url));
 await test('Full MP4 response equals recovered asset bytes',async()=>{const r=await fetch(base+'/media/twanova-overview-draft.mp4');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'video/mp4');assert.deepEqual(Buffer.from(await r.arrayBuffer()),local)});
 await test('HEAD returns correct size without body',async()=>{const r=await fetch(base+'/media/twanova-overview-draft.mp4',{method:'HEAD'});assert.equal(r.status,200);assert.equal(Number(r.headers.get('content-length')),local.length);assert.equal((await r.arrayBuffer()).byteLength,0)});
 for(const [range,start,end] of [['bytes=0-1023',0,1023],['bytes=-512',local.length-512,local.length-1],['bytes=1024-',1024,local.length-1]]){
  await test('Seeking range '+range,async()=>{const r=await fetch(base+'/media/twanova-overview-draft.mp4',{headers:{Range:range}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes ${start}-${end}/${local.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),local.subarray(start,end+1))});
 }
 for(const range of ['bytes=0-1,4-5','bytes=-0','bytes=9-2','bytes=999999999-','bytes=-'])await test('Invalid range rejected: '+range,async()=>{const r=await fetch(base+'/media/twanova-overview-draft.mp4',{headers:{Range:range}});assert.equal(r.status,416)});
 await test('Unknown asset does not expose filesystem',async()=>{assert.equal((await fetch(base+'/media/package.json')).status,404)});
 await test('POST cannot mutate media',async()=>{assert.equal((await fetch(base+'/media/twanova-overview-draft.mp4',{method:'POST'})).status,405)});
 await test('Poster served as JPEG with bytes',async()=>{const r=await fetch(base+'/media/twanova-overview-poster.jpg');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.ok((await r.arrayBuffer()).byteLength>1000)});
 console.log(`RESULT ${results.length}/${results.length} passed. Bun HTTP integration; browser playback not tested.`);
}finally{child.kill();}
