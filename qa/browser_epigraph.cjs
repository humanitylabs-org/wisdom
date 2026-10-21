// Real pointer/touch selection against disposable HTTP data, never owner writes.
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
   await page.goto(info.url+'#/read/example-chapter');await page.waitForSelector('.wb-reader');await page.waitForTimeout(600);
   const entry=(await state()).entries[0];
   const existing=await page.locator('.wb-flow').evaluate(e=>{const text=e.textContent,s=text.indexOf('Existing highlights');return {start:s,end:s+'Existing highlights'.length,text:'Existing highlights',length:text.length}});
   assert(existing.start>=0);const {length:bodyLength,...anchor}=existing;
   const seed=await post({action:'add',entry_id:entry.id,...anchor,body_sha256:entry.body_sha256});const original=seed.highlights[0];
   await page.reload();await page.waitForSelector('.wb-reader');await page.waitForTimeout(600);
   const seek=async selector=>{for(let i=0;i<25;i++){const b=await page.locator(selector).first().boundingBox();if(b&&b.x>=0&&b.x+b.width<=width+1)return;await page.keyboard.press(!b||b.x>0?'ArrowRight':'ArrowLeft');await page.waitForTimeout(400)}throw Error('Not visible: '+selector)};
   const point=async (selector,text)=>page.locator(selector).evaluate((el,text)=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const at=n.nodeValue.indexOf(text);if(at<0)continue;const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+text.length);const q=r.getBoundingClientRect();return {x:q.x+q.width/2,y:q.y+q.height/2}}throw Error('Missing word '+text)},text);
   const quote='.wb-epigraph blockquote';await seek(quote);
   const cdp=await context.newCDPSession(page);
   const touch=async (type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y}]:[]});
   const hold=async text=>{const p=await point(quote,text);await touch('touchStart',p);await page.waitForTimeout(550);await touch('touchEnd');await page.waitForSelector('[data-hl-act="highlight"]:visible')};
   await hold('attention');
   assert.equal((await state()).highlights.length,1,'Long press must only select');
   assert.equal(await page.locator(quote+' mark.sel').textContent(),'attention');
   assert.equal(await page.locator('.wb-handle:not([hidden])').count(),2);
   const toolbar=await page.locator('.wb-hlpop').boundingBox();assert(toolbar.x>=0&&toolbar.x+toolbar.width<=width);
   await page.locator('[data-hl-act="copy"]').click();
   await page.waitForFunction(()=>navigator.clipboard.readText().then(s=>s==='attention'));
   await hold('attention');
   const response=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));
   await page.locator('[data-hl-act="highlight"]').click();assert.equal((await response).status(),200);
   await page.waitForSelector(quote+' mark.wb-hl:not(.sel)');
   let saved=(await state()).highlights.find(h=>h.id!==original.id);assert.equal(saved.text,'attention');assert(saved.start>=bodyLength);
   await page.reload();await page.waitForSelector('.wb-reader');await page.waitForTimeout(600);await seek(quote);
   assert.equal(await page.locator(quote+' mark.wb-hl').textContent(),'attention');
   await page.locator(quote+' mark.wb-hl').click();await page.waitForSelector('[data-hl-act="remove"]:visible');
   const removed=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));
   await page.locator('[data-hl-act="remove"]').click();assert.equal((await removed).status(),200);
   assert.deepEqual((await state()).highlights,[original]);
   // Long press + drag across formatting and a line break: auto-save on lift.
   const a=await point(quote,'Quiet'),b=await point(quote,'Return');
   await page.mouse.move(a.x,a.y);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.move(b.x,b.y,{steps:12});
   const dragSaved=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));
   await page.mouse.up();assert.equal((await dragSaved).status(),200);
   saved=(await state()).highlights.find(h=>h.id!==original.id);
   assert.equal(saved.text,'Quiet attention begins with one thing.\nReturn');
   assert.deepEqual((await state()).highlights.find(h=>h.id===original.id),original);
   await page.screenshot({path:path.join(out,'epigraph-'+width+'.png')});
   await page.reload();await page.waitForSelector('.wb-reader');await page.waitForTimeout(600);await seek(quote);
   assert.equal(await page.locator(quote+' mark.wb-hl').allTextContents().then(x=>x.join('')),saved.text);
   // Gloss remains tappable beside the highlight; Back closes it in place.
   await page.locator(quote+' .wb-gloss').click();await page.waitForSelector('.wb-glosspop:not([hidden])');
   await page.goBack();await page.waitForSelector('.wb-glosspop[hidden]',{state:'attached'});assert.equal(await page.locator('.wb-reader').count(),1);
   await page.locator('[data-wisdom-size="1"]').click();await page.waitForTimeout(350);await seek(quote);
   assert.equal(await page.locator(quote+' mark.wb-hl').allTextContents().then(x=>x.join('')),saved.text);
   await seek('.wb-flow mark.wb-hl');assert.equal(await page.locator('.wb-flow mark.wb-hl').textContent(),original.text);
   // Body selection still saves at its pre-existing offsets.
   const p=await point('.wb-flow','exactly');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.up();await page.waitForSelector('[data-hl-act="highlight"]:visible');
   const bodySaved=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));await page.locator('[data-hl-act="highlight"]').click();assert.equal((await bodySaved).status(),200);
   assert((await state()).highlights.some(h=>h.text==='exactly'&&h.start<bodyLength));
   assert.deepEqual((await state()).highlights.find(h=>h.id===original.id),original);assert.deepEqual(errors,[]);
   results.push({width,pass:true,checks:['touch long press selects without saving','copy exact formatted word','explicit save and reload','remove','multiline drag auto-save','quote persists after resize','gloss and Back','old body anchor preserved','body selection saves'],errors});await context.close();
  }
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const assets=Object.fromEntries(['static/wisdom.js','static/wisdom.css'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
  fs.writeFileSync(path.join(out,'epigraph-browser.json'),JSON.stringify({host:require('os').hostname(),commit:sha,assets,core_sha256:info.core_sha256,results},null,2));console.log('PASS epigraph highlighting at 360, 412, 1280; touch, persistence, old anchors');
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM');await exited}
})().catch(e=>{console.error(e);process.exitCode=1});
