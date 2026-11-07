/* Wisdom's domain adapter for the shared WizOffline kit. Shared logic is vendored byte-for-byte. */
'use strict';
(() => {
  const base=new URL('./',location.href);
  const onlineOnly=['api/lookup','api/discussions','api/wisdom/request','api/wisdom/dives','api/library','api/authoring'];
  const clone=s=>s?structuredClone(s):{entries:[],highlights:[]};
  function project(raw,item){
    if(item.error)return clone(raw); // Retained failures are shown only by the explicit My library view.
    const s=clone(raw),b=item.body;
    if(item.path==='api/wisdom/highlight'){
      let hs=s.highlights||[];
      if(b.action==='add'){
        const entry=s.entries?.find(e=>e.id===b.entry_id),stale=!!(b.body_sha256&&entry?.body_sha256&&b.body_sha256!==entry.body_sha256);
        const overlap=stale?[]:hs.filter(h=>h.entry_id===b.entry_id&&h.start<b.end&&h.end>b.start&&h.anchor_status!=='unresolved');
        const notes=[...new Set([...overlap.map(h=>h.note),b.note].filter(Boolean))].join('\n\n');
        hs=hs.filter(h=>!overlap.includes(h));
        hs.unshift({id:item.tempId,entry_id:b.entry_id,start:b.start,end:b.end,text:b.text,note:notes,created_at:item.created,anchor_status:stale?'unresolved':'current',pending:true});
      }else if(b.action==='note')hs=hs.map(h=>h.id===b.id?{...h,note:b.note,pending:true}:h);
      else if(b.action==='remove')hs=hs.filter(h=>h.id!==b.id);
      s.highlights=hs;
    }else if(item.path==='api/wisdom/reaction'){
      const e=s.entries.find(x=>x.id===b.id);
      if(b.kind==='thinker'){const t=s.thinkers?.find(x=>x.id===b.id);if(t)t.more=b.value}
      else if(e){
        if(b.field==='done'){e.read=true;e.archived=true;e.progress=100;e.read_at=item.created}
        else {e[b.field]=b.value;if(b.field==='read')e.read_at=b.value?item.created:null;if(b.field==='progress')e.opened_at=item.created}
        e.pending=true;
      }
      summarize(s);
    }
    return s;
  }
  function summarize(s){
    const byId=new Map(s.entries.map(e=>[e.id,e]));
    for(const col of s.collections||[]){const es=col.entries.map(id=>byId.get(id)).filter(Boolean);col.read=es.filter(e=>e.read).length;col.done=es.filter(e=>e.read&&e.id!==col.overview).length;col.next_id=es.find(e=>e.id!==col.overview&&!e.read&&!e.archived)?.id||null;col.last_read_at=es.map(e=>e.read_at).filter(Boolean).sort().pop()||null;}
    if(s.orders)for(const view of Object.keys(s.orders)){const ids=s.entries.filter(e=>view==='all'||view==='to-read'&&!e.archived||view==='starred'&&e.saved||view==='archived'&&e.archived).map(e=>e.id),old=s.orders[view];s.orders[view]=[...old.filter(id=>ids.includes(id)),...ids.filter(id=>!old.includes(id))]}
    if(s.picks&&s.orders)s.picks=s.orders['to-read'].slice(0,3);
  }
  function reconcile(raw,result,item){
    if(item.path==='api/wisdom/reaction')return result;
    return {...clone(raw),highlights:result.highlights};
  }
  // Domain policy only: position failures are obsolete; authored edits remain until explicit dismissal.
  const isPosition=i=>i.path==='api/wisdom/reaction'&&i.body?.kind==='entry'&&i.body?.field==='progress';
  let status,cleaning=false,saveFailed=false;
  const line=document.createElement('span');line.dataset.offlineStatus='';line.className='wisdom-offline-state';document.body.append(line);
  // No offline popups anywhere (owner request, 28 Oct 2026). This diagnostic node is never painted.
  const el=document.createElement('aside');el.id='wisdom-offline';el.hidden=true;document.body.append(el);
  function editOutbox(predicate){
    const edit=()=>new Promise((resolve,reject)=>{
      const open=indexedDB.open('wisdom-offline-v1',1);
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('outbox','readwrite'),cursor=tx.objectStore('outbox').openCursor();
        cursor.onsuccess=()=>{const row=cursor.result;if(row){if(predicate(row.value))row.delete();row.continue()}};
        tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};
      };
    });
    return navigator.locks?navigator.locks.request('wisdom-outbox',edit):edit();
  }
  const retained=()=>status?.failed.filter(i=>!isPosition(i))||[];
  const label=i=>i.body?.note?'note':i.path==='api/wisdom/highlight'?'highlight':i.body?.field==='rating'?'rating':'change';
  function renderFailures(){
    const items=retained(),summary=document.querySelector('[data-offline-failures]'),view=document.querySelector('[data-offline-failure-view]');
    if(summary){summary.replaceChildren();if(saveFailed){const text=document.createElement('span');text.textContent='The last change could not be saved on this device. Free some space and try again.';summary.append(text)}if(items.length){const names=new Set(items.map(label)),name=names.size===1?label(items[0]):'change';const text=document.createElement('span');text.textContent=`${items.length} ${name}${items.length===1?'':'s'} couldn’t be saved · `;const a=document.createElement('a');a.href='#/unsaved';a.dataset.wisdomRoute='/unsaved';a.textContent='View';a.onclick=e=>{e.preventDefault();Wisdom.navigate('/unsaved')};summary.append(text,a)}}
    if(view){view.replaceChildren();for(const item of items){const row=document.createElement('article'),text=document.createElement('p'),dismiss=document.createElement('button');
      // Never expose server/transport errors. textContent keeps quotes and notes inert.
      const fallback=item.body?.field==='rating'?`Rating: ${item.body.value>0?'More like this':item.body.value<0?'Less like this':'Cleared'}`:`Your ${label(item)} is kept on this device.`;
      text.textContent=[item.body?.text,item.body?.note].filter(Boolean).join(' — ')||fallback;
      dismiss.type='button';dismiss.setAttribute('aria-label','Dismiss offline saving notice');dismiss.className='wisdom-action';dismiss.textContent='Dismiss';dismiss.onclick=async()=>{dismiss.disabled=true;try{await editOutbox(i=>i.id===item.id&&!!i.error);status=await kit.status();Wisdom.back();await kit.flush()}catch{dismiss.disabled=false}};
      row.append(text,dismiss);view.append(row);
    }}
  }
  function show(s){
    status={...s,online:navigator.onLine};s=status;
    const label=!s.online?'Offline':s.ready?'Ready offline':s.warming?`Saving for offline… ${s.total?Math.floor(s.done/s.total*100):0}%`:'Offline saving paused';
    const failed=retained();line.textContent=label+(s.pending?` · ${s.pending} pending`:'')+(failed.length?` · Couldn’t save ${failed.length} change${failed.length===1?'':'s'}`:'');
    renderFailures();
    // Clean legacy failures too. Never modify pending edits or any authored content.
    if(!cleaning&&s.failed.some(isPosition)){cleaning=true;void editOutbox(i=>!!i.error&&isPosition(i)).then(()=>kit.status()).then(show).catch(()=>{}).finally(()=>{cleaning=false})}
  }
  addEventListener('offline',()=>{if(status)show({...status,online:false})});
  addEventListener('online',()=>{if(status)show({...status,online:true})});
  const kit=WizOffline.create({prefix:'wisdom-',crashDurable:true,base,worker:'sw.js',data:['api/wisdom'],writes:['api/wisdom/highlight','api/wisdom/reaction'],onlineOnly,
    project,reconcile,alias:(item,result)=>item.path==='api/wisdom/highlight'&&item.body.action==='add'&&result.id?{from:item.tempId,to:result.id}:null,
    prepare:async(item,resolve)=>{if(item.path==='api/wisdom/highlight'&&item.body.id<0){const id=await resolve(item.body.id);if(id)return {...item,body:{...item.body,id}}}return item},
    onSynced:s=>{if(s&&typeof Wisdom!=='undefined')Wisdom.syncOffline(s)},
    queuedResult:(s,item)=>item.path==='api/wisdom/highlight'?{highlights:s.highlights,id:item.body.action==='add'?item.tempId:item.body.id,queued:true}:{...s,queued:true},
    resolve:(later,item,result)=>item.body.action==='add'&&result.id&&later.path==='api/wisdom/highlight'&&later.body.id===item.tempId?{...later,body:{...later.body,id:result.id}}:null,
    blocked:(item,items)=>item.path==='api/wisdom/highlight'&&item.body.id<0&&items.some(i=>i.tempId===item.body.id),
    assetURLs:s=>{
      const urls=new Set(['wisdom-art/f/newsreader.woff2','wisdom-art/f/newsreader-italic.woff2','wisdom-art/f/fraunces.woff2','wisdom-art/f/fraunces-italic.woff2']);
      function scan(v){if(typeof v==='string'&&v.startsWith('wisdom-art/'))urls.add(v);else if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')Object.values(v).forEach(scan)}scan(s);return [...urls];
    },onStatus:show
  });
  // Same replica/state key as WizOffline, never a second content cache.
  // Invalidate a pre-existing full edition, but let a concurrent full save win.
  const reactionFields=['rating','saved','archived','read','read_at','progress','opened_at'];
  const edition=s=>JSON.stringify((s?.entries||[]).map(e=>[e.id,e.body_sha256]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  function replicaVersion(s){return {edition:edition(s),highlights:JSON.stringify(s?.highlights||[]),entries:new Map((s?.entries||[]).map(e=>[e.id,Object.fromEntries(reactionFields.map(k=>[k,e[k]]))])),thinkers:new Map((s?.thinkers||[]).map(t=>[t.id,t.more]))}}
  function replicaState(){
    return new Promise((resolve,reject)=>{
      const open=indexedDB.open('wisdom-offline-v1',1);open.onerror=()=>reject(open.error);open.onblocked=()=>reject(Error('Storage blocked'));
      open.onsuccess=()=>{const db=open.result;let tx;
        try{tx=db.transaction('meta','readonly')}catch(e){db.close();reject(e);return}
        const req=tx.objectStore('meta').get('state');let state;
        req.onsuccess=()=>{state=replicaVersion(req.result)};tx.oncomplete=()=>{db.close();resolve(state)};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Storage unavailable'))};
      };
    });
  }
  async function rememberPartial(result,chapter,before){
    return new Promise((resolve,reject)=>{
      const open=indexedDB.open('wisdom-offline-v1',1);open.onerror=()=>reject(open.error);open.onblocked=()=>reject(Error('Storage blocked'));
      open.onsuccess=()=>{const db=open.result;let tx,projected=result;
        try{tx=db.transaction(['meta','outbox'],'readwrite',{durability:'strict'});if(tx.durability!=='strict'){tx.abort();throw Error('Crash-durable storage unavailable')}}catch(e){db.close();reject(e);return}
        const store=tx.objectStore('meta'),read=store.get('state');
        read.onsuccess=()=>{const saved=read.result;
          if(!chapter){
            // Metadata supersedes the cache we read before the request, not a
            // full snapshot committed while that request was in flight.
            if(!saved||saved.metadata_only||before===null||edition(saved)===before.edition){
              const next=structuredClone(result);next.requests=saved?.requests||next.requests;
              for(const e of next.entries){const old=saved?.entries?.find(x=>x.id===e.id);
                if(old?.body_sha256===e.body_sha256&&typeof old.body==='string')e.body=old.body;
                // A write acknowledged while metadata was in flight is no
                // longer in the outbox. Keep its personal fields, not its body.
                const was=before?.entries.get(e.id);if(old&&was)for(const k of reactionFields)if(old[k]!==was[k])e[k]=old[k];
              }
              for(const t of next.thinkers||[]){const old=saved?.thinkers?.find(x=>x.id===t.id);if(old&&before?.thinkers.has(t.id)&&old.more!==before.thinkers.get(t.id))t.more=old.more}
              if(before&&saved&&JSON.stringify(saved.highlights||[])!==before.highlights){
                next.highlights=structuredClone(saved.highlights||[]);for(const h of next.highlights){const old=saved.entries?.find(e=>e.id===h.entry_id),now=next.entries.find(e=>e.id===h.entry_id);if(!now||old?.body_sha256!==now.body_sha256)h.anchor_status='unresolved'}
              }
              summarize(next);next.glosses={...saved?.glosses,...next.glosses};store.put(next,'state');projected=next;
            }else projected=saved;
            const rows=tx.objectStore('outbox').getAll();rows.onsuccess=()=>{for(const item of rows.result)projected=project(projected,item)};return;
          }
          const entry=saved?.entries?.find(e=>e.id===result.id);
          if(saved?.metadata_only&&entry?.body_sha256===result.body_sha256){entry.body=result.body;saved.glosses={...saved.glosses,...result.glosses};store.put(saved,'state')}
        };
        tx.oncomplete=()=>{db.close();resolve(projected)};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Storage unavailable'))};
      };
    });
  }
  window.WisdomOffline=Object.freeze({...kit,renderFailures,refreshFailed:failed=>{line.dataset.refreshFailed=String(failed);line.textContent=failed?'Library refresh paused. Retrying when connected.':line.textContent},savingFailed:()=>{saveFailed=true;renderFailures()},request:async(path,body,...rest)=>{
    try{
      const before=path==='api/wisdom/metadata'?await replicaState().catch(()=>null):undefined;
      const result=await kit.request(path,body,...rest);
      if(path==='api/wisdom/metadata'||path.startsWith('api/wisdom/chapter/')){
        try{return await rememberPartial(result,path.includes('/chapter/'),before)}
        catch{line.dataset.replicaSaveFailed='true';return result} // Readable network bytes still win; no edit failed.
      }
      return result;
    }
    catch(error){if(body&&['api/wisdom/reaction','api/wisdom/highlight'].includes(path)&&!error.status){saveFailed=true;renderFailures()}throw error}
  }});
  // Preserve live Ask AI's local, recoverable draft admission offline.
  // Other AI surfaces retain their existing API/stream guard.

  document.addEventListener('click',e=>{
    const target=e.target.closest('[data-hl-act="lookup"],[data-wisdom-dive],[data-wisdom-go-deeper],[data-wisdom-retry-req],[data-wisdom-request],[data-wisdom-lookup]');
    if(target&&!navigator.onLine){e.preventDefault();e.stopImmediatePropagation();toast('Needs a connection')}
  },true);
})();
