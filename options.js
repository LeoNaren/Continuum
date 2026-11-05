
async function load(){
  const defaults={autoTrackDomains:["github.com"], globalDefaultMinutes:10, cooldownMinutes:60, enableIdleDetection:true};
  const data=await chrome.storage.local.get(Object.keys(defaults));
  const cfg={...defaults,...data};
  document.getElementById('defaultMin').value=String(cfg.globalDefaultMinutes);
  document.getElementById('cooldownMin').value=String(cfg.cooldownMinutes);
  document.getElementById('idleCheck').checked=cfg.enableIdleDetection;
  renderDomains(cfg.autoTrackDomains);
}
function renderDomains(list){
  const container=document.getElementById('domainList');
  container.innerHTML='';
  list.forEach(d=>{
    const span=document.createElement('span');
    span.className='tag';
    span.innerHTML=`${d} <button data-d="${d}">×</button>`;
    container.appendChild(span);
  });
  container.querySelectorAll('button').forEach(b=>b.addEventListener('click', async()=>{
    const {autoTrackDomains=[]}=await chrome.storage.local.get(['autoTrackDomains']);
    const updated=autoTrackDomains.filter(x=>x!==b.dataset.d);
    await chrome.storage.local.set({autoTrackDomains:updated});
    renderDomains(updated);
  }));
}
document.getElementById('addDomain').addEventListener('click', async()=>{
  const input=document.getElementById('domainInput');
  let v=input.value.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'');
  if(!v) return;
  const {autoTrackDomains=[]}=await chrome.storage.local.get(['autoTrackDomains']);
  if(!autoTrackDomains.includes(v)){
    const updated=[...autoTrackDomains,v];
    await chrome.storage.local.set({autoTrackDomains:updated});
    renderDomains(updated);
  }
  input.value='';
});
document.getElementById('saveBtn').addEventListener('click', async()=>{
  const globalDefaultMinutes=parseInt(document.getElementById('defaultMin').value);
  const cooldownMinutes=parseInt(document.getElementById('cooldownMin').value);
  const enableIdleDetection=document.getElementById('idleCheck').checked;
  await chrome.storage.local.set({globalDefaultMinutes, cooldownMinutes, enableIdleDetection});
  document.getElementById('saved').style.display='inline';
  setTimeout(()=>document.getElementById('saved').style.display='none',2000);
});
load();
