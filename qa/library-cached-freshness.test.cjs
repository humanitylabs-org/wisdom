'use strict';
// Browser-free integration: unmodified production kit, adapter, startup, route
// and chapter HTML renderer; actual HTTP responses and transactional replica.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http'),crypto=require('node:crypto');
const source=f=>fs.readFileSync(f==='offline.js'&&process.env.QA_CACHED_ADAPTER||'static/'+f,'utf8'),copy=x=>x===undefined?undefined:structuredClone(x);
// Test-owned synthetic catalog; no owner data, source pins, or workspace paths.
const body='# A quiet beginning\n\n## A first thought\n\nQuiet attention begins with one thing.';
const fixture={metadata_only:false,thinkers:[{id:'example-author',name:'Example Author'}],entries:[{id:'example-chapter',title:'A quiet beginning',thinker:'example-author',part:1,deck:'Test reader',body,body_sha256:crypto.createHash('sha256').update(body).digest('hex'),words:16,minutes:1,progress:37,read:false,saved:false,archived:false,rating:0,collections:['example-collection']}],collections:[{id:'example-collection',title:'Example collection',by:'Example Author',thinker:'example-author',entries:['example-chapter'],sections:[{title:'',entries:['example-chapter']}],numbers:{'example-chapter':1},count:1,minutes:1,read:0,done:0,next_id:'example-chapter',thinkers:['example-author'],mosaic:[]}],picks:['example-chapter'],orders:{'to-read':['example-chapter'],all:['example-chapter'],starred:[],archived:[]},preferences:{},timezone:'UTC',day:'synthetic',notices:[],highlights:[],glosses:{},requests:[{seq:1,status:'unsent',text:'Synthetic saved collection request'}]};
const metadata=copy(fixture);metadata.metadata_only=true;delete metadata.entries[0].body;metadata.requests=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
// Small IDB transport double, not a replacement of app/cache policy. Serialize
// transactions; callbacks can enqueue further requests before atomic completion.
function replica(initial,items){
 const stores={meta:new Map([['state',copy(initial)]]),outbox:new Map(items.map((x,i)=>[i+1,{...copy(x),seq:i+1}]))};let chain=Promise.resolve();
 const faults={read:false};
 const db={close(){},transaction(names,mode,options={}){
  if(faults.read&&mode==='readonly'&&names==='meta'){faults.read=false;throw Error('Synthetic readonly failure')}
  const tx={durability:options.durability,error:null},ops=[];let running=false,scheduled=false,aborted=false;
  const complete=deferred(),prior=chain;chain=complete.promise;
  const pump=()=>{if(scheduled||!running)return;scheduled=true;setImmediate(()=>{scheduled=false;if(aborted){tx.onabort?.();complete.resolve();return}const op=ops.shift();if(op){try{op()}catch(e){tx.error=e;tx.onerror?.();complete.resolve();return}pump()}else{tx.oncomplete?.();complete.resolve()}})};
  tx.abort=()=>{aborted=true;pump()};
  tx.objectStore=name=>Object.fromEntries(['get','getAll','put','add','delete'].map(method=>[method,(value,key)=>{const req={};ops.push(()=>{const s=stores[name];if(method==='get')req.result=copy(s.get(value));if(method==='getAll')req.result=copy([...s.values()]);if(method==='put'||method==='add'){const k=key??value.seq??s.size+1;s.set(k,copy(value));req.result=k}if(method==='delete')s.delete(value);req.onsuccess?.()});pump();return req}]));
  prior.then(()=>{running=true;pump()});return tx;
 }};
 return {stores,faults,indexedDB:{open(){const req={};setImmediate(()=>{req.result=db;req.onsuccess?.()});return req}}};
}
async function world({highlightOrder='after',metadataGate=false,pendingRating=false,successfulWrite=false,fullFails=false,preReadFails=false,sameEditionFull=false}={}){
 const full=copy(fixture),meta=copy(metadata),entry=full.entries[0],oldSha=entry.body_sha256,newBody=entry.body+'\n\nSynthetic updated edition.',newSha=crypto.createHash('sha256').update(newBody).digest('hex');
 meta.entries[0].body_sha256=newSha;full.entries[0]={...entry,body:newBody,body_sha256:newSha};
 const note={id:'pending-note',path:'api/wisdom/highlight',body:{action:'add',entry_id:entry.id,start:0,end:5,text:'Quiet',note:'Retain this note',body_sha256:oldSha},tempId:-123,created:'synthetic'};
 const rating={id:'pending-rating',path:'api/wisdom/reaction',body:{kind:'entry',id:entry.id,field:'rating',value:1},created:'synthetic'};
 const storage=replica(fixture,pendingRating?[note,rating]:[note]),metadataRelease=deferred(),metadataRequested=deferred(),highlightRelease=deferred(),highlightRequested=deferred(),fullRequested=deferred(),fullRelease=deferred(),metadataReturned=deferred(),requests=[],events=[];
 const acknowledged=copy(fixture);acknowledged.highlights=[{id:123,entry_id:entry.id,start:0,end:5,text:'Quiet',note:'Retain this note',anchor_status:'current'}];acknowledged.entries[0].rating=1;
 const server=http.createServer(async(req,res)=>{
  requests.push(req.url);
  if(req.url.endsWith('/metadata')){metadataRequested.resolve();if(metadataGate)await metadataRelease.promise;res.end(JSON.stringify(meta))}
  else if(req.url.endsWith('/highlight')||req.url.endsWith('/reaction')){
   highlightRequested.resolve();await highlightRelease.promise;
   if(successfulWrite)res.end(JSON.stringify(req.url.endsWith('/highlight')?{id:123,highlights:acknowledged.highlights}:acknowledged));
   else{res.statusCode=503;res.end('{"error":"retained"}')}
  }else if(req.url.includes('/chapter/'))res.end(JSON.stringify({id:entry.id,body:newBody,body_sha256:newSha,glosses:{}}));
  else if(req.url==='/wisdom/api/wisdom'){fullRequested.resolve();await fullRelease.promise;if(fullFails){res.statusCode=502;res.end('{"error":"full held then failed"}')}else res.end(JSON.stringify(sameEditionFull?acknowledged:full))}
  else{res.statusCode=404;res.end('{}')}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/wisdom/`;
 let html='',reader=null;const listeners={},nodes=[],timerHandles=[],noop=()=>{};
 const element=()=>({dataset:{},style:{},classList:{toggle:noop},append:noop,replaceChildren:noop});
 const document={hidden:false,body:{append:n=>nodes.push(n)},documentElement:{classList:{toggle:noop}},activeElement:null,createElement:element,querySelector:s=>s==='.wb-reader'?reader:null,querySelectorAll:()=>[],addEventListener:(n,f)=>listeners[n]=f};
 const ctx={console,URL,structuredClone,Map,Set,Error,DOMException,Promise,Date,Math,Intl,AbortSignal,crypto:crypto.webcrypto,...storage,document,navigator:{onLine:true},location:{href:base,pathname:'/wisdom/',search:'',hash:''},localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},sessionStorage:{setItem:noop,removeItem:noop},history:{state:{},replaceState:noop},route:'wisdom',MutationObserver:class{observe(){}disconnect(){}},setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,addEventListener:noop,dispatchEvent:noop,CustomEvent:class{},esc:s=>String(s??''),icon:()=>'',avatar:()=>'',toast:noop,scrollY:317,scrollTo:(x,y)=>{events.push(['scroll',y]);ctx.scrollY=y},fetch:(...a)=>fetch(...a)};
  ctx.setTimeout=(...args)=>{const handle=setTimeout(...args);timerHandles.push(handle);return handle};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source('offline-kit.js'),ctx);
 const wisdom=source('wisdom.js'),exposed=wisdom.replace('return {syncOffline,discussionContext,','return {getData:()=>data,chapterSettled:()=>Promise.all([...chapterLoads.values()]),syncOffline,discussionContext,');assert.notEqual(exposed,wisdom);
 vm.runInContext(exposed+';globalThis.Wisdom=Wisdom;',ctx);
 ctx.renderWisdom=()=>{html=ctx.Wisdom.render();const sha=/data-body-sha256="([^"]+)"/.exec(html);reader=sha?{dataset:{read:entry.id,bodySha256:sha[1]},querySelector:()=>null}:null;events.push(['render',sha?.[1]||'notice'])};
 ctx.api=async(p,b,t)=>{if(p==='wisdom/metadata'&&preReadFails)storage.faults.read=true;const result=await ctx.WisdomOffline.request('api/'+p,b,t);if(p==='wisdom/metadata')metadataReturned.resolve(copy(result));return result};vm.runInContext(source('offline.js'),ctx);
 await highlightRequested.promise;
 if(highlightOrder==='before'){highlightRelease.resolve();await ctx.WisdomOffline.flush()}
 const load=ctx.Wisdom.load();await metadataRequested.promise;
 return {ctx,entry,oldSha,newSha,newBody,meta,full,storage,requests,events,listeners,metadataReturned,metadataRelease,fullRequested,fullRelease,highlightRelease,load,
  html:()=>html,read(){ctx.location.hash='#/read/'+entry.id+'/'+fixture.collections[0].id;ctx.Wisdom.enter()},
  async close(){metadataRelease.resolve();highlightRelease.resolve();fullRelease.resolve();await load.catch(()=>{});timerHandles.forEach(clearTimeout);ctx.WisdomOffline.dispose();server.closeAllConnections();await new Promise(r=>server.close(r))}};
}
for(const order of ['before','after'])test('cached edition: highlight flush '+order+' metadata cannot resurrect stale body',async()=>{
 const w=await world({highlightOrder:order});try{
  // Full GET is a production-order barrier: load has already awaited and applied
  // metadata, not merely received the HTTP response. No sleeps or polling.
  await w.fullRequested.promise;
  assert.equal(w.ctx.Wisdom.getData().entries[0].body_sha256,w.newSha,'metadata applied before full request');
  w.highlightRelease.resolve();await w.ctx.WisdomOffline.flush();
  w.read();
  // Await actual selected-chapter response via adapter completion, not a delay.
  // hydrateChapter's pending promise is exposed only to this source-code test.
  await w.ctx.Wisdom.chapterSettled();
  assert(w.requests.some(p=>p.includes('/chapter/')),'selected new edition must be requested before full release');
  assert.equal(w.ctx.Wisdom.getData().entries[0].body_sha256,w.newSha);
  assert(w.html().includes('data-body-sha256="'+w.newSha+'"'));
  assert(w.html().includes('Synthetic updated edition.'));
  const projected=await w.ctx.WisdomOffline.projected();assert.equal(projected.entries[0].body_sha256,w.newSha);assert.equal(projected.highlights[0].anchor_status,'unresolved');assert.equal(projected.highlights[0].note,'Retain this note');
  assert.equal(w.storage.stores.outbox.size,1);assert.equal(w.ctx.scrollY,0,'normal reader navigation owns its scroll');
 }finally{await w.close()}
});
test('cached old body is allowed before unresolved metadata, but reconciles before full',async()=>{
 const w=await world({metadataGate:true});try{w.read();assert(w.html().includes('data-body-sha256="'+w.oldSha+'"'));assert(!w.requests.some(p=>p.includes('/chapter/')));w.metadataRelease.resolve();await w.fullRequested.promise;await w.ctx.Wisdom.chapterSettled();assert(w.html().includes('data-body-sha256="'+w.newSha+'"'));assert(w.html().includes('Synthetic updated edition.'))}finally{await w.close()}
});

test('a full snapshot committed during metadata request wins in replica AND live data',async()=>{
 const w=await world({metadataGate:true});try{
  w.meta.entries[0].body_sha256=w.oldSha; // delayed older metadata, not a new edition
  w.highlightRelease.resolve();await w.ctx.WisdomOffline.flush();
  const full=w.ctx.WisdomOffline.request('api/wisdom');w.fullRelease.resolve();await full;
  w.metadataRelease.resolve();await w.load;
  const saved=await w.ctx.WisdomOffline.projected();assert.equal(saved.metadata_only,false);assert.equal(saved.entries[0].body_sha256,w.newSha);assert.equal(saved.entries[0].body,w.newBody);
  assert.equal(w.ctx.Wisdom.getData().entries[0].body_sha256,w.newSha);assert.equal(w.ctx.Wisdom.getData().entries[0].body,w.newBody);
 }finally{await w.close()}
});
test('metadata invalidation preserves pending rating, saved request, note and focused editor/scroll',async()=>{
 const w=await world({metadataGate:true,pendingRating:true});try{
  const editor={matches:()=>true,closest:()=>null};w.ctx.document.activeElement=editor;const before=w.html(),y=w.ctx.scrollY;
  w.metadataRelease.resolve();await w.fullRequested.promise;w.highlightRelease.resolve();await w.ctx.WisdomOffline.flush();
  assert.equal(w.ctx.document.activeElement,editor);assert.equal(w.html(),before);assert.equal(w.ctx.scrollY,y);
  const s=await w.ctx.WisdomOffline.projected();assert.equal(s.entries[0].rating,1);assert.equal(s.entries[0].progress,37);assert.equal(s.requests[0].text,'Synthetic saved collection request');assert.equal(s.highlights[0].anchor_status,'unresolved');assert.equal(w.storage.stores.outbox.size,2);
  w.ctx.document.activeElement=null;w.read();await w.ctx.Wisdom.chapterSettled();assert(w.html().includes('data-body-sha256="'+w.newSha+'"'));assert.equal(w.ctx.Wisdom.getData().entries[0].rating,1);
 }finally{await w.close()}
});

for(const pendingRating of [false,true])test('successful '+(pendingRating?'rating and highlight':'highlight')+' during metadata cannot resurrect old body or erase acknowledged edits',async()=>{
 const w=await world({metadataGate:true,successfulWrite:true,pendingRating,fullFails:true});try{
  w.highlightRelease.resolve();await w.ctx.WisdomOffline.flush();assert.equal(w.storage.stores.outbox.size,0);
  w.metadataRelease.resolve();await w.fullRequested.promise;w.read();await w.ctx.Wisdom.chapterSettled();
  assert(w.html().includes('data-body-sha256="'+w.newSha+'"'));assert(w.requests.some(p=>p.includes('/chapter/')));
  w.fullRelease.resolve();await w.load;
  const s=await w.ctx.WisdomOffline.projected();assert.equal(s.metadata_only,true);assert.equal(s.entries[0].body_sha256,w.newSha);assert.equal(s.entries[0].body,w.newBody);assert.equal(s.highlights[0].id,123);assert.equal(s.highlights[0].anchor_status,'unresolved');assert.equal(s.highlights[0].note,'Retain this note');assert(!s.highlights[0].pending);if(pendingRating)assert.equal(s.entries[0].rating,1);
 }finally{await w.close()}
});
test('failed metadata pre-read still invalidates an old full replica',async()=>{
 const w=await world({preReadFails:true});try{await w.fullRequested.promise;w.highlightRelease.resolve();await w.ctx.WisdomOffline.flush();w.read();await w.ctx.Wisdom.chapterSettled();assert(w.html().includes('data-body-sha256="'+w.newSha+'"'));assert.equal((await w.ctx.WisdomOffline.projected()).entries[0].body_sha256,w.newSha)}finally{await w.close()}
});
test('concurrent complete save of SAME edition does not suppress fresher metadata',async()=>{
 const w=await world({metadataGate:true,sameEditionFull:true});try{
  w.highlightRelease.resolve();await w.ctx.WisdomOffline.flush();const f=w.ctx.WisdomOffline.request('api/wisdom');w.fullRelease.resolve();await f;
  w.metadataRelease.resolve();const meta=await w.metadataReturned.promise;assert.equal(meta.entries[0].body_sha256,w.newSha);assert.equal(meta.metadata_only,true);assert.equal(meta.entries[0].body,undefined);
 }finally{await w.close()}
});
