// Cover title and summary are selectable like the body (James, 18 Oct). Disposable fixture, real touch.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn,execFileSync}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
(async()=>{
 const out=process.env.WISDOM_QA_EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_epigraph_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 const exited=new Promise(resolve=>fixture.once('exit',resolve));let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture timeout')),15000);fixture.once('exit',c=>reject(Error('Fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',s=>{clearTimeout(t);resolve(JSON.parse(s))})});
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const results=[];
  for(const width of [360,412,1280]){
   const context=await browser.newContext({viewport:{width,height:915},isMobile:width<600,hasTouch:true,permissions:['clipboard-read','clipboard-write'],colorScheme:'dark'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const state=async()=> (await context.request.get(info.url+'api/wisdom')).json();
   const post=async d=>{const r=await context.request.post(info.url+'api/wisdom/highlight',{data:d});assert.equal(r.status(),200,await r.text());return r.json()};
   for(const h of (await state()).highlights)await post({action:'remove',id:h.id});
   const open=async()=>{await page.goto('about:blank');await page.goto(info.url+'#/read/example-chapter');await page.waitForSelector('.wb-reader');await page.waitForTimeout(1200)};
   await open();
   const entry=(await state()).entries[0];
   // Seed body + epigraph highlights; both must keep their exact rows.
   const idx=await page.evaluate(()=>{const f=document.querySelector('.wb-flow').textContent,q=document.querySelector('.wb-epigraph blockquote').textContent;return {body:f.length,quote:q.length,s:f.indexOf('Existing highlights'),q:q.indexOf('attention')}});
   await post({action:'add',entry_id:entry.id,start:idx.s,end:idx.s+19,text:'Existing highlights',body_sha256:entry.body_sha256});
   const seeded=await post({action:'add',entry_id:entry.id,start:idx.body+idx.q,end:idx.body+idx.q+9,text:'attention',body_sha256:entry.body_sha256});
   const before=seeded.highlights;
   await open();
   const title='.wb-opener-copy h1',deck='.wb-opener-copy p';
   const point=async (selector,text)=>page.locator(selector).evaluate((el,text)=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const at=n.nodeValue.indexOf(text);if(at<0)continue;const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+text.length);const q=r.getBoundingClientRect();return {x:q.x+q.width/2,y:q.y+q.height/2}}throw Error('Missing word '+text)},text);
   const cdp=await context.newCDPSession(page);
   const touch=async (type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y}]:[]});
   // A real finger jitters 1-2 px during the hold.
   const hold=async (sel,text)=>{const p=await point(sel,text);await touch('touchStart',p);for(const d of [1,-1,2,0]){await page.waitForTimeout(110);await touch('touchMove',{x:p.x+d,y:p.y-d})}await page.waitForTimeout(150);await touch('touchEnd');await page.waitForSelector('[data-hl-act="highlight"]:visible')};
   await hold(title,'quiet');
   assert.equal(await page.locator(title+' mark.sel').textContent(),'quiet');
   assert.equal((await state()).highlights.length,2,'Long press only selects');
   assert.equal(await page.locator('.wb-handle:not([hidden])').count(),2);
   const bar=await page.locator('.wb-hlpop').boundingBox();assert(bar.x>=0&&bar.x+bar.width<=width);
   await page.locator('[data-hl-act="copy"]').click();
   await page.waitForFunction(()=>navigator.clipboard.readText().then(s=>s==='quiet'));
   await hold(deck,'reader');
   const saved1=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));
   await page.locator('[data-hl-act="highlight"]').click();assert.equal((await saved1).status(),200);
   let s=(await state()).highlights.find(h=>h.text==='reader');assert(s&&s.start>=idx.body+idx.quote,'Cover offsets follow body and quote');
   await open();
   assert.equal(await page.locator(deck+' mark.wb-hl').textContent(),'reader');
   await page.locator(deck+' mark.wb-hl').click();await page.waitForSelector('[data-hl-act="remove"]:visible');
   const rem=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));
   await page.locator('[data-hl-act="remove"]').click();assert.equal((await rem).status(),200);
   assert.deepEqual((await state()).highlights,before);
   // Long press + drag from the title into the summary: five words auto-save on lift.
   const a=await point(title,'A '),b=await point(deck,'reader');
   await page.mouse.move(a.x-4,a.y);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.move(b.x,b.y,{steps:12});
   const dragSaved=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));
   await page.mouse.up();assert.equal((await dragSaved).status(),200);
   s=(await state()).highlights.find(h=>!before.some(o=>o.id===h.id));
   assert.equal(s.text,'A quiet beginning\n\nTest reader');
   await page.screenshot({path:path.join(out,'opener-'+width+'.png')});
   await open();
   assert.equal(await page.locator(`${title} mark.wb-hl,${deck} mark.wb-hl`).allTextContents().then(x=>x.join('|')),'A quiet beginning|Test reader');
   // Ask AI accepts the cover passage (discussion creation is a server check).
   const disc=await context.request.post(info.url+'api/discussions',{data:{entry_id:entry.id,body_sha256:entry.body_sha256,start:s.start,end:s.end,text:s.text,highlight_id:s.id}});
   const discText=await disc.text();assert(!/absent/.test(discText),discText);
   // Older rows untouched and painted where they were.
   for(const o of before)assert.deepEqual((await state()).highlights.find(h=>h.id===o.id),o);
   assert.equal(await page.locator('.wb-epigraph blockquote mark.wb-hl').textContent(),'attention');
   assert.equal(await page.locator('.wb-flow mark.wb-hl').textContent(),'Existing highlights');
   assert.deepEqual(errors,[]);
   results.push({width,pass:true,discussion_status:disc.status(),checks:['touch long press with jitter selects title word','copy','summary word explicit save','reload paints','remove','title-to-summary drag auto-save','discussion accepts cover quote','body and epigraph anchors unchanged'],errors});await context.close();
  }
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const assets=Object.fromEntries(['static/wisdom.js','static/wisdom.css'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
  fs.writeFileSync(path.join(out,'opener-browser.json'),JSON.stringify({host:require('os').hostname(),commit:sha,assets,core_sha256:info.core_sha256,results},null,2));console.log('PASS opener title/summary highlighting at 360, 412, 1280');
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM');await exited}
})().catch(e=>{console.error(e);process.exitCode=1});
