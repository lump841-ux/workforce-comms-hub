import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const child=spawn(process.env.BUN_BIN||'bun',['run','index.ts'],{cwd:new URL('../prototype/',import.meta.url),env:{...process.env,PORT:'4353'},stdio:'pipe'});
try{
 let html='';for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:4353/contact');if(r.ok){html=await r.text();break}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(html);
 assert.match(html,/Delivery unavailable/);assert.match(html,/type="submit" disabled aria-describedby="contactDeliveryNote"/);
 assert.match(html,/aria-describedby="contactDeliveryNote" onsubmit="stopContactPreview\(event\)"/);
 assert.doesNotMatch(html,/Demo message sent successfully|id="sent"|begin your 7-day onboarding/);
 const form=html.match(/<form id="contactPreview"[\s\S]*?<\/form>/)[0];
 for(const id of ['contactName','contactEmail','contactCompany','contactMessage']){assert.ok(form.includes(`for="${id}"`));assert.ok(form.includes(`id="${id}"`));}
 const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function stopContactPreview'))[1];
 assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\.reset\(|\.value\s*=/);
 let blocked=0;const fields={contactName:{value:'Example'},contactEmail:{value:'example@example.invalid'},contactCompany:{value:'Fictional'},contactMessage:{value:'Draft only'},contactDeliveryStatus:{textContent:''}};const before=JSON.stringify(fields);
 const context={document:{getElementById:id=>fields[id]}};vm.runInNewContext(script,context);context.stopContactPreview({preventDefault(){blocked++}});
 assert.equal(blocked,1);assert.match(fields.contactDeliveryStatus.textContent,/^Not sent\./);fields.contactDeliveryStatus.textContent='';assert.equal(JSON.stringify(fields),before,'Attempted submission preserves draft without persistence/network');
 console.log('PASS contact HTTP page:4 explicit labels; disabled+described submit; submission prevented;draft preserved; truthful not-sent status;no delivery/storage APIs or fake success.');
}finally{child.kill();}
