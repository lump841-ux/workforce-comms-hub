/* Twanova Guide: safe, role-specific in-app walkthrough. No API calls, simulated submissions or account data. */
(()=>{
'use strict';
const pathname=location.pathname;
const role=pathname.includes('/manager/')?'agency':pathname.includes('/client/')?'client':pathname.includes('/temp/')?'worker':null;
if(!role||document.getElementById('twanova-guide-launch'))return;
const sequences={
 agency:[
 ['.navlink[data-tab="overview"]','Your Command Center shows the current staffing picture. Select Overview to begin.'],
 ['.navlink[data-tab="clients"]','Open Clients to review client businesses and contacts before assigning workers.'],
 ['.navlink[data-tab="temps"]','Open Workers to view the temporary workers registered with your agency.'],
 ['.navlink[data-tab="shifts"]','Open Shifts. This is where you create and manage assignments.'],
 ['.navlink[data-tab="attendance"]','Open Attendance to check worker arrivals and shifts.'],
 ['.navlink[data-tab="messages"]','Open Messages for agency communication.']
 ],
 client:[
 ['.navlink[data-tab="overview"]','Your Client Dashboard summarizes the workforce assigned to your company.'],
 ['.navlink[data-tab="workers"]','Open Workers to see your assigned staffing team.'],
 ['.navlink[data-tab="shifts"]','Open Shifts to see the schedule.'],
 ['.navlink[data-tab="attendance"]','Open Attendance to review arrival and departure information.'],
 ['.navlink[data-tab="messages"]','Open Messages to contact the staffing agency.'],
 ['.navlink[data-tab="issues"]','Open Issues if you need to raise a workplace concern.']
 ],
 worker:[
 ['.navlink[data-tab="today"]','Your Dashboard shows your current shift.'],
 ['.navlink[data-tab="shifts"]','Open My Shifts to review your assigned work. Running-late and arrival actions are shown with eligible shifts.'],
 ['.navlink[data-tab="messages"]','Open Messages to reach your agency.'],
 ['.navlink[data-tab="issues"]','Open Report Issue when you need to notify the agency about a problem.'],
 ['.navlink[data-tab="photos"]','Open Photo Proof to upload evidence when your assignment requires it.'],
 ['.navlink[data-tab="notifications"]','Open Notifications to review updates.']
 ]
};
const css=document.createElement('style');
css.textContent=`#twanova-guide-launch{position:fixed;right:20px;bottom:20px;z-index:9900;cursor:pointer;background:#123b6a;color:white;border:2px solid #f8bf45;border-radius:28px;padding:12px 16px;font:600 14px system-ui;box-shadow:0 8px 22px #122a4466}#twanova-guide-panel{position:fixed;right:16px;bottom:76px;z-index:9902;background:#fff;color:#193552;max-width:min(370px,calc(100vw - 32px));width:350px;border:1px solid #a9c2da;border-radius:15px;padding:18px;font:15px/1.55 system-ui;box-shadow:0 12px 38px #102a3f44}#twanova-guide-panel h2{font-size:18px;margin:0 0 10px}#twanova-guide-panel p{margin:0 0 15px}#twanova-guide-panel button{cursor:pointer;border:none;background:#174f94;color:#fff;padding:9px 12px;border-radius:8px;margin-right:5px;font:600 13px system-ui}#twanova-guide-panel button.guide-muted{background:#e7edf4;color:#163a5b}#twanova-guide-panel .guide-meter{font-size:12px;color:#536a80;margin-bottom:8px}.twanova-guide-target{outline:4px solid #ffb631!important;outline-offset:3px!important;box-shadow:0 0 0 7px #ffb63150!important;position:relative;z-index:9901!important}@media(max-width:600px){#twanova-guide-launch{right:88px;bottom:17px}#twanova-guide-panel{bottom:82px}body:has(#twanova-guide-panel) .twanova-guide-target{scroll-margin-top:90px}}`;
document.head.appendChild(css);
let index=0,active=false,target=null;
const btn=document.createElement('button');btn.id='twanova-guide-launch';btn.type='button';btn.textContent='✦ Guided Tour';btn.setAttribute('aria-expanded','false');document.body.appendChild(btn);
const panel=document.createElement('section');panel.id='twanova-guide-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Twanova guided tutorial');panel.hidden=true;document.body.appendChild(panel);
function clearTarget(){if(target){target.classList.remove('twanova-guide-target');target.removeEventListener('click',onTargetClick);target=null;}}
function close(){active=false;clearTarget();panel.hidden=true;btn.setAttribute('aria-expanded','false');btn.focus();}
function onTargetClick(){if(active){setTimeout(()=>{if(active)next();},100);}}
function render(){
 clearTarget();
 const steps=sequences[role];
 if(index>=steps.length){panel.innerHTML='<h2>✓ Tour complete</h2><p>You have explored the key pages. You can restart the tour whenever you need help.</p><button type="button" data-action="restart">Restart</button><button type="button" class="guide-muted" data-action="close">Close</button>';return;}
 const [selector,description]=steps[index];
 target=document.querySelector(selector);
 panel.innerHTML='<div class="guide-meter">Step '+(index+1)+' of '+steps.length+'</div><h2>Let\'s explore your dashboard</h2><p id="guide-description"></p><button type="button" data-action="next">Next</button><button type="button" class="guide-muted" data-action="back">Back</button><button type="button" class="guide-muted" data-action="close">Exit</button>';
 panel.querySelector('#guide-description').textContent=description;
 if(target){target.classList.add('twanova-guide-target');target.addEventListener('click',onTargetClick);try{target.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(_){}}
 else panel.querySelector('#guide-description').textContent+=' This control is unavailable in your current view; choose Next.';
}
function next(){index++;render();}
btn.addEventListener('click',()=>{if(active){close();return;}active=true;index=0;panel.hidden=false;btn.setAttribute('aria-expanded','true');render();});
panel.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;switch(b.dataset.action){case 'next':next();break;case 'back':index=Math.max(0,index-1);render();break;case 'restart':index=0;render();break;case 'close':close();break;}});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&active)close();});
})();