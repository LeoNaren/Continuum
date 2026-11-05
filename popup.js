
let selectedMinutes = 10;
const durBtns = document.querySelectorAll('#durBtns button');
const customRow = document.getElementById('customRow');
const customMin = document.getElementById('customMin');

durBtns.forEach(b=>{
  b.addEventListener('click', ()=>{
    durBtns.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    if(b.dataset.m==='custom'){ customRow.style.display='flex'; selectedMinutes=parseInt(customMin.value)||15; }
    else{ customRow.style.display='none'; selectedMinutes=parseInt(b.dataset.m); }
  });
});
customMin.addEventListener('input', ()=>{ selectedMinutes=parseInt(customMin.value)||15; });

async function refresh(){
  const state = await chrome.runtime.sendMessage({type:"GET_STATE"});
  document.getElementById('currTitle').textContent = state.currentTab?.title?.slice(0,50) || 'No tab';
  document.getElementById('currDomain').textContent = state.currentTab?.url?.slice(0,60) || '';
  document.getElementById('taskCount').textContent = state.activeTasks.length;
  document.getElementById('badge').textContent = state.activeTasks.length ? `${state.activeTasks.length} active` : '';
  const dot=document.getElementById('trackDot');
  const btn=document.getElementById('trackBtn');
  if(state.isCurrentTracked){ dot.style.background='#22c55e'; btn.textContent='Untrack this tab'; btn.className='btn secondary'; }
  else{ dot.style.background='#cbd5e1'; btn.textContent='Track this tab'; btn.className='btn primary'; }
  const list=document.getElementById('taskList');
  if(!state.activeTasks.length){
    list.innerHTML=`<div id="empty">No tasks yet.<br><span class="muted">Track a tab, switch away, you'll be reminded</span></div>`;
  }else{
    list.innerHTML='';
    state.activeTasks.slice().reverse().forEach(t=>{
      const elapsed = Math.floor((Date.now()-t.leftAt)/60000);
      const left = Math.max(0, t.remindAfter - elapsed);
      const leftText = t.remindAfter < 1 ? `${Math.round(t.remindAfter*60)}s` : `${left}m`;
      const div=document.createElement('div');
      div.className='task';
      div.innerHTML=`
        <img src="${t.favIconUrl||''}" onerror="this.style.display='none'">
        <div style="flex:1">
          <div style="font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${t.title}</div>
          <div class="muted" style="font-size:10px">${t.domain} • left ${elapsed}m ago • in ${leftText}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn primary" style="padding:4px 8px;font-size:10px" data-return="${t.id}">Return</button>
          <button class="btn secondary" style="padding:4px 8px;font-size:10px" data-finish="${t.id}">Done</button>
        </div>`;
      list.appendChild(div);
    });
    list.querySelectorAll('[data-return]').forEach(b=>b.addEventListener('click', async()=>{ await chrome.runtime.sendMessage({type:"RETURN_TASK", taskId:b.dataset.return}); refresh(); }));
    list.querySelectorAll('[data-finish]').forEach(b=>b.addEventListener('click', async()=>{ await chrome.runtime.sendMessage({type:"FINISH_TASK", taskId:b.dataset.finish}); refresh(); }));
  }
}
document.getElementById('trackBtn').addEventListener('click', async()=>{
  const state = await chrome.runtime.sendMessage({type:"GET_STATE"});
  if(state.isCurrentTracked) await chrome.runtime.sendMessage({type:"UNTRACK_CURRENT"});
  else await chrome.runtime.sendMessage({type:"TRACK_CURRENT", minutes:selectedMinutes});
  refresh();
});
document.getElementById('optionsBtn').addEventListener('click', ()=>{ chrome.runtime.openOptionsPage(); });
document.getElementById('clearAll').addEventListener('click', async()=>{
  const s=await chrome.storage.local.get(['activeTasks']);
  for(const t of (s.activeTasks||[])) try{ await chrome.alarms.clear(t.alarmName);}catch{}
  await chrome.storage.local.set({activeTasks:[], cooldowns:{}});
  refresh();
});
refresh();
setInterval(refresh,1500);
