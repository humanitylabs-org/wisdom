'use strict';
// Completion cases reuse the exact current-shell host and owning navigation.
const assert=require('node:assert/strict');
exports.exercise=async({transition,page,frame,c,control,data,entry,DID,SID,net,arm,release,checkpoint})=>{
 const done=async()=>{release();await frame.waitForFunction(async()=>{const s=await WisdomOffline.projected();return s&&!s.metadata_only},null,{timeout:5000})};
 const browse=async()=>{await frame.locator('.wb-browse-card').click();await frame.locator('.wb-browse').waitFor()};
 const collection=async()=>{await browse();await frame.locator('.wb-cover').first().click();await frame.locator('.wb-collection').waitFor()};
 const read=async()=>{await collection();await frame.locator(`[data-wisdom-route="/read/${entry.id}/${data.collections[0].id}"]`).first().click();await frame.locator('.wb-reader').waitFor({timeout:5000})};
 checkpoint('transition-'+transition);
 if(transition==='home'){await done();await frame.locator('.wb-home').waitFor()}
 else if(transition==='collection-scroll'){
  await collection();const before=await frame.evaluate(()=>{scrollTo(0,250);return {y:scrollY,hash:location.hash}});assert(before.y>0,'fixture must really scroll');await done();const after=await frame.evaluate(()=>({y:scrollY,hash:location.hash}));assert.deepEqual(after,before);c.preservedScroll=after;
 }else if(transition==='browse-search'){
  await browse();const search=frame.locator('#wb-q');await search.fill('Quiet');await search.focus();await frame.evaluate(()=>{const q=document.querySelector('#wb-q');q.setSelectionRange(1,3);q.dispatchEvent(new CompositionEvent('compositionstart',{data:'synthetic'}));window.__qaFocused=q;scrollTo(0,90)});
  const before=await frame.evaluate(()=>({y:scrollY,hash:location.hash,start:__qaFocused.selectionStart,end:__qaFocused.selectionEnd}));await done();const after=await frame.evaluate(()=>({same:__qaFocused===document.activeElement,connected:__qaFocused.isConnected,value:__qaFocused.value,y:scrollY,hash:location.hash,start:__qaFocused.selectionStart,end:__qaFocused.selectionEnd}));assert(after.same&&after.connected);assert.equal(after.value,'Quiet');for(const k of Object.keys(before))assert.equal(after[k],before[k]);await frame.evaluate(()=>__qaFocused.dispatchEvent(new CompositionEvent('compositionend',{data:'synthetic'})));c.preservedFocus=after;
 }else if(['reader','pending-rating','changed-edition','cached-edition','chapter-mismatch'].includes(transition)){
  await read();await frame.evaluate(()=>window.__qaReader=document.querySelector('.wb-reader'));
  const before=await frame.evaluate(()=>({sha:__qaReader.dataset.bodySha256,count:__qaReader.querySelector('.wb-count').textContent}));
  if(transition==='pending-rating'){
   // Exact native handler through the chapter-end button, not a fake API call.
   await frame.locator('[data-wisdom-rate][data-value="1"]').evaluate(el=>el.click());
   await frame.waitForFunction(()=>document.querySelector('[data-wisdom-rate][data-value="1"]').getAttribute('aria-pressed')==='true');
  }
  if(transition==='cached-edition'||transition==='chapter-mismatch')assert.equal(before.sha,control.chapter.body_sha256,'new edition hydrated before full');
  await done();await frame.locator('.wb-reader').waitFor();
  const after=await frame.evaluate(()=>{const r=document.querySelector('.wb-reader');return {same:r===__qaReader,sha:r.dataset.bodySha256,count:r.querySelector('.wb-count').textContent,rating:r.querySelector('[data-wisdom-rate][data-value="1"]').getAttribute('aria-pressed')}});
  if(transition==='changed-edition'){assert.equal(after.sha,control.chapter.body_sha256);assert.notEqual(after.sha,before.sha);assert.equal(after.same,false)}else{assert.equal(after.same,true);assert.equal(after.count,before.count)}
  if(transition==='pending-rating'){assert.equal(after.rating,'true');const rows=await frame.evaluate(()=>new Promise((resolve,reject)=>{const o=indexedDB.open('wisdom-offline-v1',1);o.onsuccess=()=>{const db=o.result,tx=db.transaction('outbox','readonly'),r=tx.objectStore('outbox').getAll();tx.oncomplete=()=>{db.close();resolve(r.result)};tx.onerror=()=>reject(tx.error)};o.onerror=()=>reject(o.error)}));assert(rows.some(i=>i.body?.field==='rating'&&i.body?.value===1),'actual durable pending rating survives stale full')}
  c.readerTransition={before,after};
 }else if(transition==='discussion-close'){
  await read();await frame.evaluate(id=>WisdomDiscussion.list(id),entry.id);await frame.locator('.wd-overlay:not([hidden])').waitFor();
  c.overlayAppearance=await require('./library-appearance.cjs').captureAppearance({page,frame,skin:c.skin,shell:process.env.QA_SHELL});assert(c.overlayAppearance.panels.some(p=>p.className.includes('wd-panel')),'actual discussion panel checked');
  await done();await frame.getByRole('dialog',{name:'Passage discussion',exact:true}).getByRole('button',{name:'Close discussion',exact:true}).click();
  await frame.waitForFunction(sha=>document.querySelector('.wd-overlay')?.hidden&&document.querySelector('.wb-reader')?.dataset.bodySha256===sha,control.chapter.body_sha256,{timeout:5000});c.resumedAfterDiscussionClose=true;
 }else if(transition==='metadata-404'){
  await frame.waitForFunction(async()=>!!(await WisdomOffline.projected())?.entries?.[0]?.body);assert(c.fullResponse);assert(c.requests.some(x=>x.path.endsWith('/api/wisdom/metadata')));c.metadata404Fallback=true;
 }else if(transition==='refresh-retry'){
  await frame.waitForFunction(async()=>!(await WisdomOffline.projected())?.metadata_only);assert(control.fullAttempts>=2);c.retry={attempts:control.fullAttempts,productionDelayMs:30000,acceleratedOnlyRetryTimerMs:100};
 }else if(transition==='ask-ai-chats'){
  await read();net.create=250;net.bind=900;arm();await frame.locator('[data-wisdom-discuss-chapter]').evaluate(el=>el.click());
  const composer=frame.getByRole('textbox',{name:'Your question'});await composer.waitFor();await composer.fill('Synthetic unsent hydration question');
  const chat=page.locator('.ch-compose textarea').filter({visible:true}).last();await chat.waitFor({timeout:7000});await page.waitForFunction(()=>[...document.querySelectorAll('.ch-compose textarea')].some(x=>x.value==='Synthetic unsent hydration question'),null,{timeout:5000});
  assert(c.requests.some(x=>x.path.includes('/wizard/hermes/api/sessions/'+SID)));assert(!c.requests.some(x=>x.method==='POST'&&x.path.startsWith('/wizard/hermes/')),'never send a message or call a model');c.syntheticAskAIToRealChats=true;
 }else throw Error('Unknown hydration case: '+transition);
 c.appearance=await require('./library-appearance.cjs').captureAppearance({page,frame,skin:c.skin,shell:process.env.QA_SHELL});c.completedScenario=transition;
 await page.screenshot({path:require('node:path').join(process.env.QA_OUT,c.id+'-settled-transition.png')});
};
