'use strict';
// Exact real Wizard shell/API, genuine installed app registry. All domain/private
// responses are synthetic; no providers, owner library or history may be read.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {observerSource}=require('./library-boot-observer.cjs');
const OUT=process.env.QA_OUT,SHELL=process.env.QA_SHELL,ALL=JSON.parse(fs.readFileSync(process.env.QA_SOURCE_MANIFEST));
const BASE=new URL('https://wizard.example.ts.net/wizard-os-home/?open=wisdom');
const allowed=new Set(Object.keys(ALL.shell_files).filter(x=>x.startsWith('web/')).map(x=>'/wizard-os-home/'+x.slice(4)));
const fixture=JSON.parse(fs.readFileSync(process.env.QA_FIXTURE)),metadata=JSON.parse(fs.readFileSync(process.env.QA_METADATA)),chapter=JSON.parse(fs.readFileSync(process.env.QA_CHAPTER));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
// Read-only native evidence: no API writes, pagination calls or DOM mutation.
async function replicaSnapshot(){
 const stored=await new Promise((resolve,reject)=>{const o=indexedDB.open('wisdom-offline-v1',1);o.onerror=()=>reject(o.error);o.onsuccess=()=>{const db=o.result,tx=db.transaction(['meta','outbox'],'readonly'),state=tx.objectStore('meta').get('state'),rows=tx.objectStore('outbox').getAll();tx.oncomplete=()=>{db.close();resolve({state:state.result,outbox:rows.result})};tx.onerror=()=>{db.close();reject(tx.error)}}});
 const r=document.querySelector('.wb-reader');return {...stored,projected:await WisdomOffline.projected(),reader:r?{id:r.dataset.read,count:r.querySelector('.wb-count')?.textContent}:null};
}
function assertReplica(s,entryId,before){
 const entry=s.projected.entries.find(e=>e.id===entryId),base=s.state.entries.find(e=>e.id===entryId);
 const positions=s.outbox.filter(i=>i.path==='api/wisdom/reaction'&&i.body?.kind==='entry'&&i.body.id===entryId&&i.body.field==='progress');
 const note=s.outbox.find(i=>i.id==='synthetic-pending-boot-note');assert(note&&!note.error,'original pending highlight remains queued');
 const highlight=s.projected.highlights.find(h=>h.id===-123);assert(highlight,'pending highlight overlay preserved');
 for(const [key,value] of Object.entries({entry_id:entryId,start:0,end:5,text:'Quiet',note:'Pending boot note survives',pending:true,anchor_status:'current'}))assert.equal(highlight[key],value,'exact pending highlight '+key);
 assert.equal(base.progress,37,'unresolved full backend cannot replace cached seed');
 if(!before){assert.equal(s.reader,null,'seed is observed before reader navigation');assert.equal(positions.length,0,'no reading progress action before entering reader');assert.equal(entry.progress,37);return;}
 assert.deepEqual(note,before.outbox.find(i=>i.id==='synthetic-pending-boot-note'),'pending highlight row unchanged');
 assert.deepEqual(s.projected.highlights,before.projected.highlights,'pending highlight overlay unchanged');
 assert.equal(s.reader?.id,entryId);const count=/^(\d+) \/ (\d+)$/.exec(s.reader.count);assert(count,'real reader page counter');
 const [at,total]=count.slice(1).map(Number);assert(total>1&&at>=1&&at<=total);
 assert(positions.length>0,'actual native reader must queue progress');
 for(const i of positions)assert(!i.error&&Number.isInteger(i.body.value)&&i.body.value>=0&&i.body.value<=100&&i.seq>note.seq,'valid later durable reading event');
 const latest=positions.at(-1),actual=Math.round((at-1)/(total-1)*100);
 assert.equal(latest.body.value,actual,'latest queued progress exactly matches real native page');
 assert.equal(entry.progress,latest.body.value,'projection must apply latest outbox reading event, not stale seed');
 assert.equal(entry.opened_at,latest.created);assert.equal(entry.pending,true);
}
const cases=[];
for(const variant of ['baseline','candidate','live-static'])for(const width of [390,1280])for(const skin of (variant==='live-static'?['nebula']:['nebula','signal']))for(const mode of (variant==='live-static'?['cold']:['cold','cached']))cases.push({variant,width,skin,mode});
if(process.env.QA_TRANSITION){cases.length=0;cases.push({variant:'candidate',width:Number(process.env.QA_WIDTH||390),skin:process.env.QA_SKIN||'nebula',mode:process.env.QA_TRANSITION==='cached-edition'?'cached':'cold',id:process.env.QA_CASE})}
const caseId=c=>c.id??`${c.variant}-${c.width}-${c.skin}-${c.mode}`;
// First native diagnostic must succeed before spending the remaining matrix.
cases.sort((a,b)=>Number(caseId(b)==='candidate-390-nebula-cold')-Number(caseId(a)==='candidate-390-nebula-cold'));
// External per-case deadlines: a broken case cannot starve independent cases.
if(!process.env.QA_CASE){
 const {spawnSync}=require('node:child_process');const report={status:'running',expected:cases.map(caseId),cases:[]};
 const save=()=>fs.writeFileSync(path.join(OUT,'library-boot-browser.json'),JSON.stringify(report,null,2)+'\n');save();
 for(const [i,item] of cases.entries()){
  const id=caseId(item),tmp=path.join(process.env.TMPDIR,'b'+i);fs.mkdirSync(tmp);
  const log=fs.openSync(path.join(OUT,id+'.log'),'wx');
  const child=spawnSync(process.execPath,[__filename],{env:{...process.env,QA_CASE:id,TMPDIR:tmp},stdio:['ignore',log,log],timeout:28000,killSignal:'SIGKILL'});fs.closeSync(log);
  const file=path.join(OUT,id+'.json');let row=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).cases[0]:{...item,status:'fail',error:'no case checkpoint'};
  row.child={exit:child.status,signal:child.signal,error:child.error?.code};
  // Playwright browsers are detached: reap only this owned case's TMPDIR marker.
  const owned=()=>fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)&&+p>1&&+p!==process.pid).filter(p=>{try{return fs.statSync('/proc/'+p).uid===process.getuid()&&fs.readFileSync('/proc/'+p+'/environ').toString().split('\0').includes('TMPDIR='+tmp)}catch{return false}}).map(Number);
  const leaked=owned();for(const pid of leaked)try{process.kill(pid,'SIGTERM')}catch{}
  if(leaked.length)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);
  for(const pid of owned())try{process.kill(pid,'SIGKILL')}catch{}
  if(leaked.length)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
  row.cleanup={markedPidsAtExit:leaked,remaining:owned()};
  if(child.status!==0||leaked.length||row.cleanup.remaining.length)row.status='fail';
  report.cases.push(row);save();
  if(row.status!=='pass'){report.missing=report.expected.filter(id=>!report.cases.some(c=>caseId(c)===id));report.stoppedAfter=id;break;}
 }
 report.status=report.cases.length===18&&report.cases.every(c=>c.status==='pass')?'pass':'fail';save();console.log(JSON.stringify({status:report.status,cases:report.cases.length}));process.exit(report.status==='pass'?0:1);
}
const DID='f'.repeat(32),SID='wizard_qa_wisdom_boot_only';
const json=(r,x,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(x)}).catch(e=>{if(/closed|Invalid Interception/.test(e.message))return;throw e});
const mime=f=>({'.js':'application/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}[path.extname(f)]||'application/octet-stream');
const result={status:'running',scope:'exact-source synthetic in-shell opening; real registry/shared API; zero provider/owner-content requests',cases:[]};
function save(){fs.writeFileSync(path.join(OUT,process.env.QA_CASE+'.json'),JSON.stringify(result,null,2)+'\n')}
(async()=>{const browser=await chromium.launch({headless:true});try{
for(const {variant,width,skin,mode} of cases.filter(c=>caseId(c)===process.env.QA_CASE)){
 const ROOT=variant==='baseline'?process.env.QA_BASELINE:process.env.QA_SOURCE,manifest={...ALL,files:variant==='baseline'?ALL.baseline_files:ALL.files};
 const c={variant,width,skin,mode,requests:[],assets:{},failures:[],status:'running',startedAt:new Date().toISOString(),checkpoints:[]};Object.defineProperty(c,'id',{value:caseId(c),enumerable:true});result.cases.push(c);save();
 const checkpoint=phase=>{c.phase=phase;c.checkpoints.push({phase,at:new Date().toISOString()});save()};
 const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',hasTouch:width===390,isMobile:width===390});
 const data=structuredClone(fixture),entry=data.entries[0],action='selection-ask-ai';let thread,armed=false;
 const pending=new Set(),net={create:0,bind:0},fullHolds=new Set(),control={meta:structuredClone(metadata),chapter:structuredClone(chapter),full:structuredClone(data),released:false,fullAttempts:0};let page,frame;
 const transition=process.env.QA_TRANSITION;
 if(transition==='cached-edition'||transition==='changed-edition'||transition==='discussion-close'||transition==='chapter-mismatch'){const body=entry.body+'\n\nSynthetic updated edition.';control.full.entries[0].body=body;control.full.entries[0].body_sha256=digest(Buffer.from(body));control.chapter={...chapter,body,body_sha256:control.full.entries[0].body_sha256};if(transition==='cached-edition')control.meta.entries[0].body_sha256=control.chapter.body_sha256}
 if(transition==='refresh-retry')await ctx.addInitScript(()=>{const native=setTimeout;window.setTimeout=(f,ms,...rest)=>native(f,ms===30000?100:ms,...rest)});
 const makeThread=b=>({id:DID,entry_id:entry.id,body_sha256:entry.body_sha256,scope:b?.scope||'chapter',start:0,end:5,text:'Quiet',quote:'Quiet',chapter_title:entry.title,messages:[],configured:true});
 try{
  await ctx.routeWebSocket('**/*',ws=>{c.requests.push({method:'WEBSOCKET',path:new URL(ws.url()).pathname,decision:'blocked'});ws.close()});
  await ctx.addInitScript(s=>{if(location.pathname.startsWith('/wizard-os-home/')){localStorage.setItem('wos.skin',s);localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true')}},skin);
  await ctx.route('**/*',async r=>{
   const req=r.request(),u=new URL(req.url()),p=u.pathname,m=req.method();
   const log=decision=>c.requests.push({method:m,path:p,decision});
   if(u.origin!==BASE.origin){log('blocked-external');return r.abort()}
   if(req.resourceType()==='eventsource'||/\/(?:events|stream)(?:\/|$)/.test(p)){log('blocked-stream');return r.abort()}
   if(p.startsWith('/wisdom/api/')){
    log('synthetic-private-api');const q=p.slice('/wisdom/api/'.length);let b={};try{b=req.postDataJSON()||{}}catch{}
    if(q==='wisdom'){c.fullRequested=true;c.fullRequestedAt??=Date.now();control.fullAttempts++;(c.fullEvents||=[]).push({phase:'requested',at:Date.now()});if(transition==='metadata-404'||transition==='refresh-retry'){if(transition==='refresh-retry'&&control.fullAttempts===1)return json(r,{error:'Synthetic refresh failure'},502);c.fullResponse=true;return json(r,control.full)}if(variant==='live-static'){c.fullResponse=true;return json(r,data)}if(variant==='baseline'){await delay(5500);c.fullResponse=true;(c.fullEvents||=[]).push({phase:'response',at:Date.now()});return json(r,data)}if(!control.released)await new Promise(resolve=>fullHolds.add(resolve));if(transition){c.fullResponse=true;return json(r,control.full)}return r.abort().catch(()=>{})}
    if(q==='wisdom/metadata'){c.metadataRequested=true;if(transition==='metadata-404')return json(r,{error:'Older server'},404);return json(r,control.meta)}
    if(q.startsWith('wisdom/chapter/')){if(transition==='chapter-mismatch')control.meta.entries[0].body_sha256=control.chapter.body_sha256;return json(r,(transition==='changed-edition'||transition==='discussion-close')&&!control.released?chapter:control.chapter)}
    if(q==='wisdom/reaction'||q==='wisdom/highlight')return json(r,{error:'Synthetic retained pending edit'},503);
    if(q==='discussions'&&m==='GET')return json(r,{threads:thread?[thread]:[]});
    if((q==='discussions'&&m==='POST')||q==='discussions/'+DID){
     if(armed){const token={path:p};pending.add(token);await delay(net.create);pending.delete(token)}
     if(net.failCreate)return json(r,{error:'Synthetic admission failure'},503);
     if(m==='POST')thread=makeThread(b);
     return json(r,thread||makeThread({}));
    }
    if(q==='discussions/'+DID+'/thread'){
     if(armed){const token={path:p};pending.add(token);await delay(net.bind);pending.delete(token)}
     if(net.failBind)return json(r,{error:'Synthetic binding failure'},503);
     return json(r,{session_id:SID,agent:'philosopher',reply:{key:'wisdom:'+DID,title:entry.title,message:'Synthetic canonical route QA passage only.'}});
    }
    if(q==='library')return json(r,{bundles:[],source:[]});
    return json(r,{error:'Synthetic unspecified Wisdom API'},404);
   }
   if(m!=='GET'&&m!=='HEAD'){log('blocked-write');return json(r,{})}
   if(p==='/wizard/v1/bootstrap')return json(r,{bootstrap:1,settings:{agent:{name:'Wizard'},owner:{name:''},clock:{timezone:'UTC',day_starts_at:'00:00'}},endpoints:{apps:'/wizard/v1/apps'}});
   if(p==='/wizard/v1/agents')return json(r,{agents:[{id:'hermes',is_default:true,label:'Synthetic main',harness:'hermes',privacy:'standard',status:'running',model:{provider:'anthropic',model:'claude-fable-5-1'}},{id:'philosopher',label:'Synthetic route identity',harness:'hermes',privacy:'standard',status:'running',model:{provider:'anthropic',model:'claude-fable-5-1'},appearance:{glyph:'hat',hue:200}}]});
   if(p==='/wizard/v1/agent-options')return json(r,{harnesses:[],providers:[],presets:[],wizard_apps:[],agent_apps:[],outside_tools:[]});
   if(p==='/wizard/v1/app-bindings')return json(r,{bindings:[]});
   if(p==='/wizard/v1/ui-preferences')return json(r,{version:1,migrations:{'launcher-seed-v1':true},spaces:[],pinnedChats:[]});
   if(p==='/wizard/v1/skins')return json(r,{version:1,skins:[],active:null,migrated:true});
   if(p==='/wizard/v1/my-skin')return r.fulfill({contentType:'text/css',body:''});
   if(p==='/wizard/v1/my-skin/info')return json(r,{exists:false,bytes:0,script:{exists:false,bytes:0}});
   if(p==='/wizard/v1/schedules')return json(r,{schedules:[]});
   if(p==='/wizard/thread-seen'||p==='/wizard/thread-dispositions')return json(r,{state:{}});
   if(p==='/wizard/hermes/api/sessions')return json(r,{sessions:[],data:[],has_more:false,pagination:{returned:0,total:0}});
   if(p.startsWith('/wizard/hermes/api/sessions/'+SID)){
    log('synthetic-chats-session-read');
    const history=action==='selection-open-discussion'?[{id:'qa-native-history',role:'assistant',content:'Synthetic saved discussion history.',timestamp:'2026-10-29T00:00:00Z'}]:[];
    return json(r,p.endsWith('/messages')?{messages:history,data:history,has_more:false,pagination:{returned:history.length,total:history.length}}:{session:{id:SID,title:'Synthetic Wisdom route QA',agent:{id:'philosopher'},model:'claude-fable-5-1',provider:'anthropic',wizard_retry_input:'',message_count:history.length,messages:history}});
   }
   // Registry stays genuine. No synthetic capability, launcher or app admission.
   if(p==='/wizard/v1/apps'){log('real-installed-registry');return r.continue()}
   if(p==='/wisdom/'||p.startsWith('/wisdom/')){
    if(variant==='live-static'){log('real-live-app-static');return r.continue()}
    const f=p.slice('/wisdom/'.length)||'index.html';
    if(!Object.hasOwn(manifest.files,'static/'+f)){log('blocked-nonstatic-wisdom');return r.abort()}
    const b=fs.readFileSync(path.join(ROOT,'static',f));assert.equal(digest(b),manifest.files['static/'+f]);c.assets[f]=digest(b);return r.fulfill({contentType:mime(f),body:b});
   }
   // Generated update attribution is status data (can contain thread ids), not
   // executable shell code. Preserve its schema/head without private attribution.
   if(p==='/wizard-os-home/ux-changes.json'){log('synthetic-generated-update-status');return json(r,ALL.dynamic_shell['web/ux-changes.json'].fixture)}
   if(p==='/wizard-os-home/'||allowed.has(p)){
    if(variant==='live-static'){log('real-live-shell-static');return r.continue()}
    const f=p.slice('/wizard-os-home/'.length)||'index.html',b=fs.readFileSync(path.join(SHELL,'web',f));
    assert.equal(digest(b),manifest.shell_files['web/'+f],f);c.assets[p]=digest(b);log('pinned-candidate-shell-static');return r.fulfill({contentType:mime(f),body:b});
   }
   // Unrelated default windows are inert documents, not private owner pages.
   if(['/other-app-a/','/other-app-b/','/other-app-c/','/other-app-d/','/other-app-e/'].includes(p))return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic unrelated app</title>'});
   log('blocked-private-or-unknown-get');return json(r,{error:'QA privacy barrier'},404);
  });

  const observerArgs={entryId:entry.id,entryTitle:entry.title,collectionId:data.collections[0].id,collectionTitle:data.collections[0].title};
  const frameDiagnostic=()=>({href:location.href,path:location.pathname,baseURI:document.baseURI,timeOrigin:performance.timeOrigin,now:performance.now(),src:window.frameElement?.getAttribute('src')??null,srcdoc:window.frameElement?.getAttribute('srcdoc')??null,initType:typeof window.__qaInit,bootType:typeof window.__qaBoot,init:window.__qaInit,boot:window.__qaBoot,home:document.querySelector('.wb-home')?.textContent.slice(0,1800)});
  if(mode==='cached'){
    await ctx.route('**/__qa-seed',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic replica seed</title>'}));
    const seed=await ctx.newPage();await seed.goto(new URL('/__qa-seed',BASE).href);
    await seed.evaluate(async data=>{await new Promise((resolve,reject)=>{const o=indexedDB.open('wisdom-offline-v1',1);o.onupgradeneeded=()=>{o.result.createObjectStore('outbox',{keyPath:'seq',autoIncrement:true});o.result.createObjectStore('meta')};o.onsuccess=()=>{const db=o.result,tx=db.transaction(['meta','outbox'],'readwrite');tx.objectStore('meta').put(data,'state');const e=data.entries[0];tx.objectStore('outbox').add({id:'synthetic-pending-boot-note',path:'api/wisdom/highlight',body:{action:'add',entry_id:e.id,start:0,end:5,text:'Quiet',note:'Pending boot note survives',body_sha256:e.body_sha256},tempId:-123,created:'2026-11-03'});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};o.onerror=()=>reject(o.error)})},data);await seed.close();
  }
  page=await ctx.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>c.failures.push({name:e.name,message:e.message}));
  const cdp=await ctx.newCDPSession(page);c.transport=[];
  for(const event of ['Page.frameAttached','Page.frameNavigated','Page.lifecycleEvent','Runtime.executionContextCreated','Runtime.exceptionThrown'])cdp.on(event,data=>c.transport.push({event,at:Date.now(),data}));
  await cdp.send('Page.enable');await cdp.send('Page.setLifecycleEventsEnabled',{enabled:true});await cdp.send('Runtime.enable');
  // Only observer source. Registered before navigation, in the default world.
  c.observerRegistration=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:observerSource(observerArgs)});
  checkpoint('observer-registered-before-navigation');
  const url=new URL(BASE);url.searchParams.set('shell',width===390?'phone':'desktop');
  const began=Date.now();await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>{const r=f.getBoundingClientRect();return new URL(f.src,location.href).pathname.startsWith('/wisdom/')&&f.contentWindow?.WizardApp?.hosted===true&&r.width>100&&r.height>100&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight}),null,{timeout:12000});
  const handle=await page.evaluateHandle(()=>[...document.querySelectorAll('iframe')].find(f=>{const r=f.getBoundingClientRect();return new URL(f.src,location.href).pathname.startsWith('/wisdom/')&&r.width>100&&r.height>100&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight}));
  frame=await handle.asElement().contentFrame();assert(frame);c.shellMode=await page.evaluate(()=>document.documentElement.dataset.shell);assert.equal(c.shellMode,width===390?'phone':'desktop');c.beforeHome=await frame.evaluate(frameDiagnostic);checkpoint('hosted-frame');
  await frame.locator('.wb-home').waitFor({timeout:12000});c.afterHome=await frame.evaluate(frameDiagnostic);checkpoint('home-rendered');
  assert.equal(c.afterHome.initType,'object','pre-app observer marker must exist; inspect transport trace');assert(!c.afterHome.init.error,c.afterHome.init.error);assert.equal(c.afterHome.init.events[0].hasHome,false,'observer was installed before home content');
  await frame.waitForFunction(()=>Number.isFinite(window.__qaBoot?.usable),null,{timeout:2000});
  c.shellToUsableMs=Date.now()-began;c.timing=await frame.evaluate(()=>({...__qaBoot,appClient:performance.getEntriesByType('resource').filter(x=>x.name.endsWith('/core/app-client.js')).map(x=>({start:x.startTime,duration:x.duration,bytes:x.transferSize})),html:performance.getEntriesByType('navigation').map(x=>({responseEnd:x.responseEnd,domContentLoaded:x.domContentLoadedEventEnd}))}));
  assert.equal(await frame.evaluate(()=>WizardApp.hosted),true);
  assert.equal(await page.evaluate(f=>WizAppServices.authorized(f),await frame.frameElement()),true);
  checkpoint('usable-content-observed');await page.screenshot({path:path.join(OUT,process.env.QA_CASE+'-home-before-assert.png')});
  if(transition){
    const release=()=>{control.released=true;for(const resolve of fullHolds)resolve();fullHolds.clear()};
    await require('./library-hydration-cases.cjs').exercise({transition,page,frame,c,control,data,entry,DID,SID,net,arm:()=>armed=true,release,checkpoint});
    assert.deepEqual(c.failures,[]);c.status='pass';checkpoint('transition-complete');continue;
  }
  if(variant==='baseline'){assert(c.timing.usable>=5000,'specific regression: usable content gated by delayed full backend');assert(c.fullResponse,'baseline full response observed');c.expectedRegression={predicate:'usable-under-800ms',actualMs:c.timing.usable,passed:false,controlledBackendMs:5500}}
  else if(variant==='candidate'){assert(c.timing.usable<800,'usable library <800ms from app navigation while full backend unresolved');assert(c.fullRequested&&!c.fullResponse,'full API requested and still unresolved');if(mode==='cached')assert(c.metadataRequested,'cached content is shown immediately and then freshness-checked');}
  c.hostResources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(x=>/\.(?:js|css)(?:[?]|$)/.test(x.name)).map(x=>({path:new URL(x.name).pathname,start:x.startTime,duration:x.duration,responseEnd:x.responseEnd})));
  c.frameResources=await frame.evaluate(()=>({navigationOffset:performance.timeOrigin-parent.performance.timeOrigin,assets:performance.getEntriesByType('resource').filter(x=>/\.(?:js|css)(?:[?]|$)/.test(x.name)).map(x=>({path:new URL(x.name).pathname,start:x.startTime,duration:x.duration,responseEnd:x.responseEnd}))}));
  // Exercise real navigation, not only a ready flag, placeholder or spinner.
  checkpoint('navigate-library');await page.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState==='finished'||a.playState==='idle'),null,{timeout:4000});
  const navStart=Date.now();await frame.locator('.wb-browse-card').click();await frame.locator('.wb-browse').waitFor();
  await frame.locator('.wb-cover').first().click();await frame.locator('.wb-collection').waitFor();c.navigationMs=Date.now()-navStart;assert(c.navigationMs<1500);assert((await frame.locator('.wb-collection').textContent()).includes(data.collections[0].title));
  await page.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState==='finished'||a.playState==='idle'),null,{timeout:4000});
  c.appearance=await frame.evaluate(()=>({id:document.documentElement.dataset.skin,overflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(c.appearance.id,skin);assert(!c.appearance.overflow);
  if(variant==='candidate'){
    c.appearance=await require('./library-appearance.cjs').captureAppearance({page,frame,skin,shell:SHELL});
    const shot=`${width}-${skin}-${mode}-usable-library.png`;checkpoint('capture-library');await page.screenshot({path:path.join(OUT,shot)});c.screenshot=shot;
    let beforeReader;
    // Already in the native collection from Browse; there is no self-link here.
    if(mode==='cached'){await frame.locator('.wb-collection').waitFor();assert((await frame.locator('.wb-collection').textContent()).includes(data.collections[0].title));checkpoint('cached-seed-before-reader');beforeReader=c.cachedSeed=await frame.evaluate(replicaSnapshot);assertReplica(beforeReader,entry.id);save();}
    const target=frame.locator(`[data-wisdom-route="/read/${entry.id}/${data.collections[0].id}"]`).first();await target.click();await frame.locator('.wb-reader').waitFor({timeout:5000});
    checkpoint('readable-chapter');assert((await frame.locator('.wb-reader').textContent()).includes('Quiet attention'));c.readerAppearance=await require('./library-appearance.cjs').captureAppearance({page,frame,skin,shell:SHELL});await page.screenshot({path:path.join(OUT,`${width}-${skin}-${mode}-readable-chapter.png`)});
    const other=skin==='nebula'?'signal':'nebula';await page.evaluate(s=>WosSkin.set(s),other);await frame.waitForFunction(s=>document.documentElement.dataset.skin===s,other);c.liveSkinChange=other;c.changedAppearance=await require('./library-appearance.cjs').captureAppearance({page,frame,skin:other,shell:SHELL});await page.screenshot({path:path.join(OUT,`${width}-${skin}-${mode}-live-${other}-reader.png`)});
    if(mode==='cached'){c.cachedAfterReader=await frame.evaluate(replicaSnapshot);save();assertReplica(c.cachedAfterReader,entry.id,beforeReader);c.pendingNotePreserved=true;}
    // Reload with unresolved full backend, preserving exact same replica and route.
    const oldOrigin=await frame.evaluate(()=>performance.timeOrigin),before=Date.now();await frame.evaluate(()=>location.reload());await frame.waitForFunction(t=>performance.timeOrigin!==t,oldOrigin,{timeout:5000});await frame.locator('.wb-reader').waitFor({timeout:5000});c.reloadReaderMs=Date.now()-before;assert(c.reloadReaderMs<1500);assert((await frame.locator('.wb-reader').textContent()).includes('Quiet attention'));
    await delay(Math.max(0,5500-(Date.now()-c.fullRequestedAt)));c.fullUnresolvedMs=Date.now()-c.fullRequestedAt;assert(c.fullUnresolvedMs>=5500&&c.fullRequested&&!c.fullResponse,'full API stays unresolved for 5.5s through chapter and reload');
    if(mode==='cached'){c.cachedAfterReload=await frame.evaluate(replicaSnapshot);save();assertReplica(c.cachedAfterReload,entry.id,beforeReader);}
    await frame.locator('[data-wisdom-reader-back]').click();await frame.locator('.wb-collection').waitFor();assert((await frame.locator('.wb-collection').textContent()).includes(data.collections[0].title));c.reloadThenBack=true;
  }
  assert.deepEqual(c.failures,[]);c.status='pass';checkpoint('complete');
 }catch(e){c.status='fail';c.error={name:e.name,message:e.message,stack:String(e.stack)};save();if(page){await page.screenshot({path:path.join(OUT,process.env.QA_CASE+'-FAIL.png'),timeout:2500}).catch(()=>{});c.diagnostic=await frame?.evaluate(()=>({href:location.href,path:location.pathname,baseURI:document.baseURI,timeOrigin:performance.timeOrigin,src:window.frameElement?.getAttribute('src'),srcdoc:window.frameElement?.getAttribute('srcdoc'),initType:typeof window.__qaInit,bootType:typeof window.__qaBoot,init:window.__qaInit,boot:window.__qaBoot,home:document.querySelector('.wb-home')?.textContent.slice(0,1800)})).catch(()=>null)}throw e}
 finally{for(const resolve of fullHolds)resolve();c.finishedAt=new Date().toISOString();save();await ctx.close()}
}
result.status='pass';save();console.log(JSON.stringify({status:result.status,cases:result.cases.length,path:path.join(OUT,'library-boot-browser.json')}));
}finally{await browser.close();save()}})().catch(e=>{result.status='fail';save();console.error(e);process.exitCode=1});
