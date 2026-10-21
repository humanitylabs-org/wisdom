// Thales: (1) Back from a chapter's cover turns to the previous chapter's last page (key, left tap, swipe);
// the first chapter's cover stays put. (2) Every chapter's end page offers "Discuss with AI", which opens a
// whole-chapter discussion (no passage), closes on Back and leaves the reader open.
// Real HTTP fixture + shared WizardApp core, disposable data. James, 18 Oct 2026.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const evidence=process.env.WISDOM_QA_EVIDENCE;fs.mkdirSync(evidence,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),15000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',l=>{clearTimeout(t);resolve(JSON.parse(l))})});
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const checks=[],errors=[];
  for(const width of [390,360]){
   const ctx=await browser.newContext({viewport:{width,height:860},isMobile:true,hasTouch:true});
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(width+': '+e.message));
   const posts=[];page.on('request',r=>{if(r.method()==='POST'&&/api\/discussions$/.test(r.url()))posts.push(r.postDataJSON())});
   const base=info.url;
   await page.goto(base);await page.waitForSelector('.wb-home');
   const data=await page.evaluate(async()=>(await fetch('api/wisdom')).json());
   const col=data.collections.find(c=>c.entries.filter(i=>i!==c.overview).length>=3);assert(col,'fixture needs a 3-chapter collection');
   const at=i=>col.entries[i],first=col.entries[0];
   const [A,B]=[at(1),at(2)];
   const ready=async id=>{await page.waitForSelector(`.wb-reader[data-read="${id}"]`);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await page.waitForTimeout(300)};
   const state=()=>page.evaluate(()=>{const r=document.querySelector('.wb-reader');return {id:r?.dataset.read,at:r?.dataset.at,count:r?.querySelector('.wb-count')?.textContent,hash:location.hash}});
   const open=async id=>{await page.goto('about:blank');await page.goto(base+`#/read/${id}/${col.id}`);await ready(id)};
   const atEnd=async(id,how)=>{await page.waitForFunction(id=>document.querySelector('.wb-reader')?.dataset.read===id&&document.querySelector('.wb-reader')?.dataset.at==='end',id,{timeout:5000});await page.waitForTimeout(500);const s=await state();const [p,n]=s.count.split(' / ');assert.equal(p,n,`${how}: lands on the last page (${s.count})`);assert(s.hash.startsWith(`#/read/${id}/`),s.hash);return s};
   // Key: ArrowLeft on B's cover → A's last page.
   await open(B);assert.equal((await state()).at,'opener');
   await page.keyboard.press('ArrowLeft');const k=await atEnd(A,'key');
   // Forward from A's end goes to B's cover again, and Back again returns to A's end (no drift).
   await page.keyboard.press('ArrowRight');await ready(B);assert.equal((await state()).at,'opener');
   const stage=page.locator('.wb-stage'),box=await stage.boundingBox();
   // Left-edge tap on B's cover.
   // Touch input (a mouse no longer taps or swipes pages: desktop uses edge arrows, keys and wheel, James 19 Oct).
   await page.touchscreen.tap(box.x+20,box.y+box.height/2);await atEnd(A,'left tap');
   // Swipe right on B's cover.
   await page.keyboard.press('ArrowRight');await ready(B);
   const y=box.y+box.height*.4,cdp=await ctx.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+80,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+80+i*30,y}]});await page.waitForTimeout(16)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await atEnd(A,'swipe');
   // Ordinary Back within a chapter is unchanged: from A's end, one step back stays in A.
   await page.keyboard.press('ArrowLeft');await page.waitForTimeout(450);const inA=await state();assert.equal(inA.id,A);assert.notEqual(inA.at,'end');
   // The collection's first chapter has no previous chapter: its cover stays put.
   await open(first);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(500);const s0=await state();assert.equal(s0.id,first);assert.equal(s0.at,'opener');
   // End page: Discuss with AI.
   await open(A);await page.keyboard.press('End').catch(()=>{});
   for(let i=0;i<80&&(await state()).at!=='end';i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(60)}
   await atEnd(A,'read through');
   const btn=page.locator('.wb-end [data-wisdom-discuss-chapter]');
   assert.equal((await btn.innerText()).replace(/\s+/g,' ').trim(),'Discuss with AI →');
   await btn.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`end-${width}.png`)});
   const fit=await page.evaluate(()=>{const e=document.querySelector('.wb-end'),b=e.querySelector('.wb-discuss').getBoundingClientRect();return {scroll:e.scrollWidth<=e.clientWidth,inside:b.left>=0&&b.right<=innerWidth}});assert(fit.scroll&&fit.inside,JSON.stringify(fit));
   await btn.tap();
   await page.waitForSelector('.wd-overlay:not([hidden]) .wd-panel');await page.waitForFunction(()=>document.querySelector('.wd-subtitle')?.textContent&&!/Opening/.test(document.querySelector('.wd-subtitle').textContent),null,{timeout:8000});
   const ov=await page.evaluate(()=>({title:document.querySelector('.wd-header h2').textContent,sub:document.querySelector('.wd-subtitle').textContent,quote:document.querySelector('.wd-quote').hidden,chips:[...document.querySelectorAll('.wd-chip')].map(b=>b.textContent),ph:document.querySelector('.wd-composer textarea').placeholder,label:document.querySelector('.wd-panel').getAttribute('aria-label')}));
   const entry=data.entries.find(e=>e.id===A);
   assert.equal(ov.title,'Discuss with AI');assert.equal(ov.sub,entry.title);assert.equal(ov.quote,true,'no passage box');
   assert.deepEqual(ov.chips,['Big idea','Apply it','Challenge']);assert.equal(ov.ph,'Ask about this chapter…');assert.equal(ov.label,'Chapter discussion');
   assert.deepEqual(posts.at(-1),{entry_id:A,body_sha256:entry.body_sha256,scope:'chapter'});
   await page.screenshot({path:path.join(evidence,`discuss-${width}.png`)});
   // Back closes the discussion and keeps the reader on the end page.
   await page.locator('.wd-panel').focus();await page.keyboard.press('Escape');await page.waitForTimeout(400);
   assert(await page.evaluate(()=>document.querySelector('.wd-overlay').hidden),'Escape closes');let s=await state();assert.equal(s.id,A);assert.equal(s.at,'end');
   await btn.tap();await page.waitForSelector('.wd-overlay:not([hidden])');await page.waitForTimeout(500);
   await page.evaluate(()=>history.back());await page.waitForTimeout(700);
   assert(await page.evaluate(()=>document.querySelector('.wd-overlay').hidden),'history Back closes');s=await state();assert.equal(s.id,A,'reader still open after Back');
   // Same chapter + edition reuses one thread; a passage discussion still gets the passage UI.
   const ids=await page.evaluate(async b=>{const f=()=>fetch('api/discussions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());return [(await f()).id,(await f()).id]},posts.at(-1));assert.equal(ids[0],ids[1]);
   const list=await page.evaluate(async()=>(await fetch('api/discussions')).json());const row=list.threads.find(t=>t.id===ids[0]);assert.equal(row.scope,'chapter');
   await page.locator('.wb-top [data-wisdom-discussions]').tap();await page.waitForSelector('.wd-thread-row');
   assert.equal(await page.locator('.wd-thread-row .wd-row-scope').first().innerText().then(t=>t.toLowerCase()),'whole chapter');
   await page.screenshot({path:path.join(evidence,`list-${width}.png`)});
   await page.keyboard.press('Escape');
   checks.push({width,key:k.count,first_cover_stays:true,discuss:ov,thread:ids[0]});
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  const head=require('child_process').execSync('git rev-parse HEAD').toString().trim();
  fs.writeFileSync(path.join(evidence,'chapter-end.json'),JSON.stringify({head,core_sha256:info.core_sha256,checks},null,1));
  console.log('PASS chapter end: Back from cover → previous end (key/tap/swipe), first cover stays, Discuss with AI whole-chapter thread, Back closes it');
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exit(1)});
