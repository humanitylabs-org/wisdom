// Real offline acceptance on the build worker. Only qa.offline_fixture's disposable copy is written.
const {chromium}=require(process.env.PLAYWRIGHT_DIR),{spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const DISCUSSION_PANEL='.wd-overlay:not([hidden]) .wd-panel[role="dialog"]';
const QUESTION='.wd-composer textarea[aria-label="Your question"]';
const out=process.env.WISDOM_QA_EVIDENCE;fs.mkdirSync(out,{recursive:true});
const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.offline_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
let browser,context,page;const errors=[],checks={};
const word=()=>page.evaluate(()=>{const flow=document.querySelector('.wb-flow'),walker=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const re=/[A-Za-z]{6,}/g;let m;while(m=re.exec(n.nodeValue)){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);const q=r.getBoundingClientRect();if(q.width&&q.left>20&&q.right<innerWidth-20&&q.top>120&&q.bottom<innerHeight-160)return {text:m[0],x:q.x+q.width/2,y:q.y+q.height/2}}}return null});
async function selectWord(){let w;for(let i=0;i<8&&!(w=await word());i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(300)}assert(w,'visible prose word');await page.mouse.move(w.x,w.y);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.up();await page.waitForSelector('[data-hl-act="note"]:visible');return w}
(async()=>{
 const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),30000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',s=>{clearTimeout(t);resolve(JSON.parse(s))})});
 checks.fixture=info;assert(info.disposable.includes('wisdom-offline-'));
 browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'});
 await context.tracing.start({screenshots:true,snapshots:true});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{window.__offlinePopups=[];new MutationObserver(()=>{const el=document.querySelector('#wisdom-offline');if(el&&el.getBoundingClientRect().height)__offlinePopups.push(el.textContent)}).observe(document,{childList:true,subtree:true,attributes:true})});
 await page.goto(info.url);await page.waitForSelector('.wb-home');
 await page.evaluate(async()=>{const c=await caches.open('sibling-shell-sentinel');await c.put('/sentinel',new Response('sibling-safe'));const old=await caches.open('wisdom-shell-stale');await old.put('/old',new Response('old'))});
 await page.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.startsWith('Ready offline'),{},{timeout:120000});
 const data=await page.evaluate(async()=>await(await fetch('api/wisdom')).json());checks.library={collections:data.collections.length,entries:data.entries.length};assert(data.collections.length>=3);
 checks.scope=await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).scope);assert(checks.scope.endsWith('/wisdom/'));
 checks.caches=await page.evaluate(()=>caches.keys());assert(checks.caches.every(k=>k.startsWith('wisdom-')||k==='sibling-shell-sentinel'));
 assert.equal(await page.evaluate(async()=>await(await(await caches.open('sibling-shell-sentinel')).match('/sentinel')).text()),'sibling-safe');
 assert(await page.locator('#wisdom-offline').isHidden());
 await page.evaluate(()=>{window.__offlinePopups=[];new MutationObserver(()=>{const el=document.querySelector('#wisdom-offline');if(el&&el.getBoundingClientRect().height)__offlinePopups.push(el.textContent)}).observe(document.body,{childList:true,subtree:true,attributes:true})});
 await page.screenshot({path:path.join(out,'online-ready.png'),fullPage:true});
 await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.startsWith('Offline'));assert(await page.locator('#wisdom-offline').isHidden());
 checks['offline status is temporary and never persistent while reading']='passed';
 await page.reload();await page.waitForSelector('.wb-home');await page.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.startsWith('Offline'));
 await page.locator('.wb-discovery .wb-browse-card').click();await page.waitForSelector('.wb-browse');
 const count=await page.locator('.wb-browse-body .wb-cover').count();assert.equal(count,data.collections.length);checks.offlineCollections=count;
 const entries=new Map(data.entries.map(e=>[e.id,e])),selected=[];
 for(const c of data.collections){const e=c.entries.filter(id=>id!==c.overview).map(id=>entries.get(id)).find(e=>e&&(e.art||data.thinkers.find(t=>t.id===e.thinker)?.portrait));if(e)selected.push({c,e});if(selected.length===3)break}assert.equal(selected.length,3);
 checks.chapters=[];
 for(const {c,e} of selected){
  await page.evaluate(id=>Wisdom.navigate('/collection/'+id),c.id);await page.waitForSelector('.wb-collection');await page.locator(`[data-wisdom-route="/read/${e.id}/${c.id}"]`).first().click();await page.waitForSelector('.wb-reader');
  await page.waitForFunction(()=>[...document.querySelectorAll('.wb-reader img')].some(i=>i.naturalWidth>0));
  checks.chapters.push({collection:c.id,chapter:e.id,image:await page.locator('.wb-reader img').first().evaluate(i=>({src:i.getAttribute('src'),naturalWidth:i.naturalWidth}))});
 }
 const e=selected[2].e;const w=await selectWord();await page.locator('[data-hl-act="highlight"]').click();
 await page.waitForFunction(async()=>{const s=await WisdomOffline.status();return s.pending>0});
 await page.waitForFunction(async id=>(await WisdomOffline.projected()).highlights.some(h=>h.entry_id===id&&h.id<0),e.id);
 const h=await page.evaluate(async id=>(await WisdomOffline.projected()).highlights.find(h=>h.entry_id===id&&h.id<0),e.id);assert(h&&h.pending);
 // A note on that queued highlight exercises temporary-id dependency resolution.
 await page.evaluate(async id=>{await api('wisdom/highlight',{action:'note',id,note:'Offline note retained and replayed.'})},h.id);
 const desired=!e.saved;
 await page.evaluate(async({id,value})=>{await api('wisdom/reaction',{kind:'entry',id,field:'saved',value});await api('wisdom/reaction',{kind:'entry',id,field:'progress',value:37})},{id:e.id,value:desired});
 checks.pending=await page.evaluate(()=>WisdomOffline.status());assert(checks.pending.pending>=4);
 await page.screenshot({path:path.join(out,'offline-pending.png')});
 // Pending overlays survive a genuinely disconnected reload, including the note.
 await page.reload();await page.waitForSelector('.wb-reader');
 const overlay=await page.evaluate(()=>WisdomOffline.projected());assert(overlay.highlights.some(x=>x.id===h.id&&x.note==='Offline note retained and replayed.'));assert.equal(overlay.entries.find(x=>x.id===e.id).saved,desired);
 checks.fastFail=[];
 for(const p of ['wisdom/request','lookup','lookup/stream','discussions','wisdom/dives']){
  const result=await page.evaluate(async p=>{const t=performance.now();try{await api(p,{text:'not sent'});return {bad:true}}catch(e){return {ms:performance.now()-t,message:e.message}}},p);assert.equal(result.message,'Needs a connection');assert(result.ms<1000);checks.fastFail.push({path:p,...result});
 }
 // Exact live source already uses a calm inline retained-input explanation,
 // not a toast. Preserve the no-empty-modal guard and exercise the real editor.
 checks.phase='offline-discussion';fs.writeFileSync(path.join(out,'checkpoint.json'),JSON.stringify(checks,null,2));
 await page.locator('[data-wisdom-discussions]').first().click();
 await page.waitForFunction(()=>document.querySelector('.wd-list-message')?.textContent.includes('Offline. Your question is kept; retry when connected.'));
 assert.equal(await page.locator('#toast').textContent(),'');assert.equal(await page.locator(DISCUSSION_PANEL+':visible').count(),1);assert(await page.locator(QUESTION).isHidden(),'list footer/composer must stay hidden');
 checks['offline discussion is not empty']=await page.locator('.wd-list-message').textContent();await page.locator('.wd-close').click();
 await page.evaluate(()=>{void WisdomDiscussion.open({scope:'chapter'})});
 await page.waitForFunction(()=>document.querySelector('.wd-notice')?.textContent.includes('Offline. Your question is kept; retry when connected.'));
 const draft='Synthetic offline question kept unsent';assert.equal(await page.locator(DISCUSSION_PANEL+':visible').count(),1);assert(await page.locator(QUESTION).isVisible());assert(await page.locator(QUESTION).isEnabled());await page.locator(QUESTION).fill(draft);await page.locator('.wd-close').click();
 const disconnectedReload=await page.reload();assert(disconnectedReload.fromServiceWorker(),'genuinely offline reload served from scoped worker');assert.equal(await page.evaluate(()=>navigator.onLine),false);await page.waitForSelector('.wb-reader');await page.evaluate(()=>{void WisdomDiscussion.open({scope:'chapter'})});
 await page.waitForFunction(()=>document.querySelector('.wd-notice')?.textContent.includes('Offline. Your question is kept; retry when connected.'));
 assert.equal(await page.locator(DISCUSSION_PANEL+':visible').count(),1);assert.equal(await page.locator(QUESTION).inputValue(),draft);await page.locator('.wd-close').click();checks['offline Ask AI draft survives disconnected reload']=true;
 await page.locator('[data-wisdom-reader-back]').click();await page.waitForSelector('.wb-collection');await page.goBack().catch(()=>{});assert(page.url().startsWith(info.url));checks.offlineNestedBack='reader → collection → in-app';
 await page.evaluate(id=>api('wisdom/reaction',{kind:'entry',id,field:'progress',value:37}),e.id);
 await context.setOffline(false);await page.evaluate(()=>WisdomOffline.flush());
 await page.waitForFunction(async()=>{const s=await WisdomOffline.status();return s.pending===0});
 const after=await page.evaluate(async()=>(await(await fetch('api/wisdom')).json()));const actual=after.highlights.find(x=>x.entry_id===e.id&&x.text===h.text&&x.note==='Offline note retained and replayed.');assert(actual&&actual.id>0);assert.equal(after.entries.find(x=>x.id===e.id).saved,desired);assert.equal(after.entries.find(x=>x.id===e.id).progress,37);checks.readback={highlight:actual.id,note:actual.note,reaction:desired,progress:37};
 // A Note sheet opened before reconnect can still save using its old temporary id.
 const aliasReply=await page.evaluate(id=>api('wisdom/highlight',{action:'note',id,note:'Offline note retained and replayed.'}),h.id);assert.equal(aliasReply.id,actual.id);checks.reconnectedDraftAlias='old temporary highlight id resolved after replay';
 // Completing a chapter offline updates the local collection summary immediately.
 await context.setOffline(true);
 const finished=selected[0];await page.evaluate(id=>api('wisdom/reaction',{kind:'entry',id,field:'done',value:true}),finished.e.id);
 const localDone=await page.evaluate(()=>WisdomOffline.projected());assert.equal(localDone.entries.find(x=>x.id===finished.e.id).progress,100);assert.notEqual(localDone.collections.find(x=>x.id===finished.c.id).next_id,finished.e.id);
 await context.setOffline(false);await page.evaluate(()=>WisdomOffline.flush());checks.offlineCompletion='100% and next chapter projected, then synced';
 // zero-width pinned reader: collapsed frame geometry must never persist null/NaN progress.
 await page.evaluate(id=>Wisdom.navigate('/read/'+id),e.id);await page.waitForSelector('.wb-reader');await page.waitForTimeout(500);const beforeCollapse=await page.locator('.wb-count').textContent();
 await page.locator('.wb-stage').evaluate(el=>el.style.width='0px');await page.evaluate(()=>dispatchEvent(new Event('resize')));await page.waitForTimeout(700);assert.equal(await page.locator('.wb-count').textContent(),beforeCollapse);
 await page.locator('.wb-stage').evaluate(el=>el.style.width='');await page.evaluate(()=>dispatchEvent(new Event('resize')));await page.waitForTimeout(500);await page.evaluate(()=>WisdomOffline.flush());assert.equal((await page.evaluate(()=>WisdomOffline.status())).failed.length,0);checks['zero-width pinned reader']='no invalid progress saved';
 // private.35 legacy position failures are silently removed; next valid position wins.
 await page.evaluate(async id=>{try{await api('wisdom/reaction',{kind:'entry',id,field:'progress',value:null})}catch{}await api('wisdom/reaction',{kind:'entry',id,field:'progress',value:37});await WisdomOffline.flush()},e.id);
 await page.waitForFunction(async()=>!(await WisdomOffline.status()).failed.some(i=>i.body.field==='progress'));assert.equal((await page.evaluate(async()=>await(await fetch('api/wisdom')).json())).entries.find(x=>x.id===e.id).progress,37);checks.failedPositionSuperseded=true;
 // Permanent failure is retained with the quote/note and cannot silently disappear.
 await context.setOffline(true);
 await page.evaluate(async e=>{await api('wisdom/highlight',{action:'add',entry_id:e.id,start:50000,end:50006,text:'before',note:'Keep this failed note',body_sha256:'0'.repeat(64)})},e);
 await context.setOffline(false);await page.evaluate(()=>WisdomOffline.flush());
 const failed=await page.evaluate(()=>WisdomOffline.status());assert(failed.failed.some(x=>x.body.note==='Keep this failed note'));
 // No popups while reading; failures are available ONLY on My library, never Home or a collection.
 for(const route of ['/read/'+e.id,'/collection/'+selected[2].c.id,'/']){await page.evaluate(r=>Wisdom.navigate(r),route);assert(await page.locator('#wisdom-offline').isHidden());assert.equal(await page.locator('[data-offline-failures]').count(),0)}
 await page.evaluate(()=>Wisdom.navigate('/shelf/private'));await page.waitForSelector('[data-offline-failures] a');assert((await page.locator('[data-offline-failures]').innerText()).includes('1 note couldn’t be saved'));assert.equal(await page.locator('[data-offline-failures]').evaluate(e=>getComputedStyle(e).position),'static');
 await page.reload();await page.waitForSelector('[data-offline-failures] a'); // survives reload until explicit dismissal
 await page.locator('[data-offline-failures] a').click();await page.waitForSelector('[data-offline-failure-view]');assert((await page.locator('[data-offline-failure-view]').innerText()).includes('Keep this failed note'));assert(!(await page.locator('body').innerText()).includes('edition changed'));
 await page.getByRole('button',{name:'Dismiss offline saving notice',exact:true}).click();await page.waitForSelector('.wb-library-shelf');assert.equal(new URL(page.url()).hash,'#/shelf/private');assert.equal((await page.evaluate(()=>WisdomOffline.status())).failed.length,0);checks.permanentFailure='retained across reload; inline My library → View → one-tap Dismiss back';
 // Build A → B while an unsaved Note sheet is open: activation never reloads it.
 await page.evaluate(id=>Wisdom.navigate('/read/'+id),e.id);await page.waitForSelector('.wb-reader');await selectWord();await page.locator('[data-hl-act="note"]').click();await page.waitForSelector('#wb-note-text');await page.locator('#wb-note-text').fill('Draft must survive the worker update.');
 const before=await page.evaluate(()=>({build:window.__offlineBuild,time:performance.timeOrigin,hold:!!document.querySelector('#wb-note-text')}));assert.equal(before.build,'A');
 await context.request.post(new URL('/__qa/build-b',info.url).href);
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});await page.waitForTimeout(1800);
 assert.equal(await page.locator('#wb-note-text').inputValue(),'Draft must survive the worker update.');assert.equal(await page.evaluate(()=>performance.timeOrigin),before.time);checks.noForcedReload=true;
 const fresh=await context.newPage();await fresh.goto(info.url);await fresh.waitForFunction(()=>window.__offlineBuild==='B');await fresh.waitForSelector('.wb-home');await fresh.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.startsWith('Ready offline'),{},{timeout:120000});checks.nextOnlineBuild=await fresh.evaluate(()=>window.__offlineBuild);
 // Two standalone Appearance skins; phone home ready, transition, reader settled.
 for(const skin of ['dark','light']){
  const worn=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,colorScheme:skin});const phone=await worn.newPage();phone.on('pageerror',e=>errors.push(e.message));
  await phone.goto(info.url);await phone.waitForSelector('.wb-home');await phone.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.startsWith('Ready offline'),{},{timeout:120000});await phone.waitForTimeout(4000);assert(await phone.locator('#wisdom-offline').isHidden());await phone.evaluate(s=>{document.documentElement.dataset.theme=s},skin);checks[skin+'Theme']=await phone.evaluate(()=>({theme:document.documentElement.dataset.theme,base:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()}));
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:path.join(out,'home-ready-'+skin+'.png')});
  await worn.setOffline(true);await phone.waitForFunction(()=>document.querySelector('[data-offline-status]').textContent.startsWith('Offline'));assert(await phone.locator('#wisdom-offline').isHidden());
  await phone.screenshot({path:path.join(out,'offline-no-popup-'+skin+'.png')});
  await phone.evaluate(id=>Wisdom.navigate('/read/'+id),e.id);await phone.waitForSelector('.wb-reader');for(let turn=0;turn<8&&await phone.locator('.wb-reader').getAttribute('data-at')!=='text';turn++){await phone.keyboard.press('ArrowRight');await phone.waitForTimeout(250)}assert.equal(await phone.locator('.wb-reader').getAttribute('data-at'),'text');await phone.waitForTimeout(1200);assert(await phone.locator('#wisdom-offline').isHidden());await phone.screenshot({path:path.join(out,'reader-offline-'+skin+'.png')});
  // No popups while reading (owner request, 26 Oct 2026): losing and regaining signal mid-chapter shows nothing over the page.
  await worn.setOffline(false);await phone.waitForTimeout(300);await worn.setOffline(true);await phone.waitForTimeout(800);assert(await phone.locator('#wisdom-offline').isHidden());checks[skin+'NoPopupWhileReading']=true;
  await worn.close();
 }
 const desktop=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});const wide=await desktop.newPage();await wide.goto(info.url);await wide.waitForSelector('.wb-home');await wide.waitForTimeout(4200);await wide.screenshot({path:path.join(out,'desktop-ready-dark.png')});assert(await wide.evaluate(()=>{const r=document.querySelector('.w-layout').getBoundingClientRect();return r.width<=720&&Math.abs((r.left+r.right)/2-innerWidth/2)<2}));await desktop.close();
 assert.deepEqual(await page.evaluate(()=>__offlinePopups),[]);checks['no offline popups anywhere']='passed';
 assert.deepEqual(errors,[]);checks.errors=errors;checks.status='passed';
 fs.writeFileSync(path.join(out,'offline-acceptance.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
})().catch(async e=>{console.error(e);if(page){console.error(await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(out,'FAIL.png')}).catch(()=>{})}let offlineState;try{offlineState=await page.evaluate(async()=>({status:await WisdomOffline.status(),highlights:(await WisdomOffline.projected())?.highlights,url:location.href}))}catch{}fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,errors,checks,offlineState},null,2));process.exitCode=1}).finally(async()=>{if(context){await context.tracing.stop({path:path.join(out,'trace.zip')}).catch(()=>{});await context.close()}if(browser)await browser.close();fixture.kill('SIGTERM')});
