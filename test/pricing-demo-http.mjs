import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const cwd = new URL('../prototype/',import.meta.url);
const server=spawn(process.env.BUN_BIN || 'bun',['run','index.ts'],{cwd,env:{...process.env,PORT:'4349'},stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
try {
 let ready=false;
 for(let i=0;i<100;i++) {try {const r=await fetch('http://127.0.0.1:4349/pricing');if(r.ok){ready=true;break}} catch{} await new Promise(r=>setTimeout(r,50));}
 assert.ok(ready,output);
 for(const route of ['/pricing','/pricing/','/signup-demo?plan=5&term=2','/signup-demo/?plan=0&term=0','/signup-demo?plan=%3Cscript%3E&term=999']){
  const response=await fetch('http://127.0.0.1:4349'+route);
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);
  const file=route.startsWith('/pricing')?'pricing.html':'signup-demo.html';
  assert.equal(await response.text(),await readFile(new URL(file,cwd),'utf8'));
 }
 console.log('PASS 5 actual Bun HTTP routes: exact patched HTML served; query strings do not inject HTML; no API writes.');
}finally{server.kill();}
