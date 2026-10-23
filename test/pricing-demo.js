// Dependency-free DOM/VM checks, not a substitute for visual browser QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const pricing = fs.readFileSync(path.join(root, 'prototype/pricing.html'), 'utf8');
const signup = fs.readFileSync(path.join(root, 'prototype/signup-demo.html'), 'utf8');
const originalNumbers = require('./fixtures/pricing-numeric-baseline.json').numbers;
const scripts = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const numericCopy = html => html.slice(0,html.indexOf('<script>')).replace(/href="[^"]*"/g,'').match(/\d[\d,.–-]*/g);
assert.deepEqual(numericCopy(pricing), originalNumbers, 'All visible numbers, price arrays, fees and worker tiers preserved');
assert.equal(scripts(pricing).length,1);
assert.ok(pricing.endsWith('</script></body></html>'));
assert.ok(!pricing.includes('</html>+'));
const matrix = [...pricing.matchAll(/data-prices="([^"]+)"/g)].map(m=>m[1].split(',').map(Number));
function element(dataset={}) { return {dataset, value:'0',textContent:'',attrs:{},events:{},checked:false,classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,f){this.events[k]=f},appendChild(){},checkValidity(){return true}}; }
const buttons = [0,1,2].map(n=>element({term:String(n)}));
const prices = matrix.map(p=>element({prices:p.join(',')}));
const savings = matrix.map(p=>element({savings:p.join(',')}));
const links = matrix.map(()=>element());
const groups={'[data-term]':buttons,'[data-prices]':prices,'[data-savings]':savings,'[data-checkout]':links};
vm.runInNewContext(scripts(pricing)[0], {document:{querySelectorAll:s=>groups[s]}});
function signupState(search) {
 const ids = new Map(); const get = id => {if(!ids.has(id))ids.set(id,element());return ids.get(id)};
 let alerts=0,scrolls=0;
 const context={URLSearchParams,location:{search},document:{getElementById:get,createElement:()=>element(),querySelector:()=>element()},window:{scrollTo(){scrolls++}},alert(){alerts++}};
 vm.runInNewContext(scripts(signup)[0],context);
 return {get, alerts:()=>alerts,scrolls:()=>scrolls};
}
for(const term of [0,1,2,0]) {
 buttons[term].events.click();
 buttons.forEach((b,i)=>assert.equal(b.attrs['aria-pressed'],String(i===term)));
 matrix.forEach((p,plan)=>{
  assert.equal(prices[plan].textContent,'$'+p[term].toLocaleString('en-US'));
  assert.equal(savings[plan].textContent,term===0?'Monthly flexibility':`Save $${(p[0]-p[term]).toLocaleString('en-US')}/mo compared with Monthly Flex`);
  assert.equal(links[plan].href,`/signup-demo?plan=${plan}&term=${term}`);
  const state=signupState(links[plan].href.split('?')[1]);
  assert.equal(state.get('workers').value,String(plan));assert.equal(state.get('contract').value,String(term));
  assert.equal(state.get('sub').textContent,prices[plan].textContent);
  assert.equal(state.get('first').textContent,'$'+(p[term]+1999).toLocaleString('en-US'));
 });
}
for(const search of ['', '?plan=999&term=-1','?plan=%3Cscript%3E&term=NaN','?plan=1.5&term=3']){
 const state=signupState(search);assert.equal(state.get('summaryName').textContent,'Essentials');assert.equal(state.get('sub').textContent,'$349');
 state.get('continue').onclick();assert.equal(state.alerts(),1);assert.equal(state.scrolls(),0,'Unchecked form cannot advance');
}
for(let plan=0;plan<6;plan++)assert.ok(pricing.includes(`href="/signup-demo?plan=${plan}&amp;term=0"`),'No-JS fallback preserves plan');
assert.match(signup,/DEMO ONLY — NO REAL STRIPE PAYMENT/);
assert.match(signup,/no payment or live account created/);
assert.doesNotMatch(scripts(pricing).join('')+scripts(signup).join(''),/fetch\(|XMLHttpRequest|sendBeacon/);
console.log('PASS pricing numeric preservation; parsed single script; 24 selection journeys; 6 no-JS links; 4 invalid/missing parameter + unchecked-form cases; no payment/network mutations.');
