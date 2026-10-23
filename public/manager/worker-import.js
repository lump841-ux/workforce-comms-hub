(() => {
  const el=id=>document.getElementById(id);
  let importId=null; let generation=0; let busy=false;
  function controls(value) { busy=value; el('previewButton').disabled=value; el('restartButton').disabled=value; el('csvFile').disabled=value; el('commitButton').disabled=value || !importId; }
  function reset() { generation++; importId=null; el('reviewSection').hidden=true; el('resultSection').hidden=true; el('results').replaceChildren(); el('status').textContent=''; el('commitButton').disabled=true; }
  el('csvFile').addEventListener('change',reset);
  el('restartButton').addEventListener('click',()=>{reset();el('csvFile').value='';});
  el('previewButton').addEventListener('click',async()=>{
    if(busy)return; reset(); const current=generation; const file=el('csvFile').files[0];
    if(!file){el('status').textContent='Choose a CSV file first.';return;}
    if(file.size>128*1024){el('status').textContent='CSV must be 128 KB or smaller.';return;}
    controls(true); el('status').textContent='Checking your list…';
    try{
      const csv=await file.text(); const result=await api('/manager/worker-import/preview',{method:'POST',body:{csv}});
      if(current!==generation)return;
      importId=result.importId; el('summary').textContent=`${result.summary.total} rows: ${result.summary.ready} ready, ${result.summary.skipped} skipped, ${result.summary.error} needing correction.`;
      const table=document.createElement('table'); const head=document.createElement('tr');
      ['Row','Name','Email','Phone','Result'].forEach(label=>{const th=document.createElement('th');th.textContent=label;head.append(th);}); table.append(head);
      result.rows.forEach(row=>{const tr=document.createElement('tr');[row.row,row.fullName,row.email,row.phone,`${row.status}: ${row.reason || 'Ready for a pending invitation.'}`].forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index===4)td.className=row.status;tr.append(td);});table.append(tr);});
      el('preview').replaceChildren(table);el('reviewSection').hidden=false;
      el('status').textContent=result.canImport?'Review the rows below. This preview expires in 10 minutes.':'Correct the errors and preview again, or choose another file. No changes were made.';
    }catch(error){el('status').textContent=error.message;}finally{controls(false);}
  });
  el('commitButton').addEventListener('click',async()=>{
    if(busy || !importId)return;controls(true);el('status').textContent='Saving pending invitations…';
    try{
      const result=await api('/manager/worker-import/commit',{method:'POST',body:{importId,confirm:true}});
      importId=null;el('resultSummary').textContent=`${result.created} pending invitations created. No emails sent and no active accounts created.`;
      result.imported.forEach(row=>{const li=document.createElement('li');const name=document.createElement('div');name.textContent=`${row.fullName} · ${row.email}`;const link=document.createElement('a');link.href=row.invitePath;link.textContent=new URL(row.invitePath,location.origin).href;li.append(name,link);el('results').append(li);});
      el('reviewSection').hidden=true;el('resultSection').hidden=false;el('status').textContent='Import complete. Share each private link separately when ready.';
    }catch(error){importId=null;el('status').textContent=error.message+' Check the Workers list before trying again if your connection was interrupted.';}finally{controls(false);}
  });
  requireSession(['owner','agency_admin','agency_manager','recruiter']).then(user=>{if(user)el('main').hidden=false;});
})();
