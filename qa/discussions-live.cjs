// Thales: real reader + app API + configured first-party model, disposable data only.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const fs=require('fs'),path=require('path'),assert=require('assert'),os=require('os');
(async()=>{
 const out=process.env.WISDOM_QA_EVIDENCE,url=process.env.WISDOM_QA_URL;assert(out&&url);fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'}),checks=[];
 let lastPage;
 try{
  for(const width of [360,412,1280]){
   const ctx=await browser.newContext({viewport:{width,height:850},isMobile:width<900,hasTouch:true,colorScheme:'dark'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   lastPage=page;page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
   await page.route('**/wizard-os-home/core/app-client.js',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.WISDOM_QA_CORE)}));
   const state=await (await ctx.request.get(url+'api/wisdom')).json();
   const entry=state.entries.find(e=>e.body.includes('> '))||state.entries[0];assert(entry);
   await page.goto(url+'#/read/'+entry.id);await page.waitForSelector('.wb-reader');await page.waitForTimeout(700);
   const target=await page.locator('.wb-epigraph blockquote').count()?'.wb-epigraph blockquote':'.wb-flow p';
   for(let i=0;i<20;i++){const b=await page.locator(target).first().boundingBox();if(b&&b.x>=0&&b.x+b.width<=width+1)break;await page.keyboard.press('ArrowRight');await page.waitForTimeout(380);}
   const point=await page.locator(target).first().evaluate(el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const m=/\b[A-Za-z]{4,}\b/.exec(n.nodeValue);if(!m)continue;const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);const b=r.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,text:m[0]}}});
   assert(point&&point.x>=0&&point.x<width);
   const cdp=await ctx.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});await page.waitForTimeout(600);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.locator('[data-hl-act="ask"]').waitFor({state:'visible'});
   const toolbar=await page.locator('.wb-hlpop').boundingBox();assert(toolbar.x>=0&&toolbar.x+toolbar.width<=width+1);
   const before=await page.locator('.wb-track').evaluate(e=>e.style.transform);
   const countBefore=(await (await ctx.request.get(url+'api/discussions')).json()).threads.reduce((n,t)=>n+t.message_count,0);
   await page.locator('[data-hl-act="ask"]').click();await page.waitForFunction(()=>document.querySelector('.wd-composer textarea')&&!document.querySelector('.wd-composer textarea').disabled);
   assert((await page.locator('.wd-quote').textContent()).includes(point.text));
   assert.equal((await (await ctx.request.get(url+'api/discussions')).json()).threads.reduce((n,t)=>n+t.message_count,0),countBefore);
   assert.equal(await page.locator('.wb-track').evaluate(e=>e.style.transform),before);
   checks.push(width+': real touch selection -> idle anchored discussion; no generation or reader movement');
   await page.screenshot({path:path.join(out,width+'-idle.png')});
   await page.locator('textarea').fill('A draft to keep');await page.locator('.wd-close').click();await page.waitForTimeout(400);
   assert.equal(await page.locator('.wb-track').evaluate(e=>e.style.transform),before);
   await page.locator('[data-wisdom-discussions]').click();await page.locator('.wd-thread-row').first().click();await page.waitForFunction(()=>!document.querySelector('textarea').disabled);
   assert.equal(await page.locator('textarea').inputValue(),'A draft to keep');
   const threads=(await (await ctx.request.get(url+'api/discussions')).json()).threads;const id=threads[0].id;
   await page.reload();await page.waitForSelector('.wb-reader');await page.evaluate(id=>WisdomDiscussion.open({id}),id);
   assert.equal(await page.locator('textarea').inputValue(),'A draft to keep');
   if(width===412){
    await page.locator('.wd-web input').uncheck();await page.locator('textarea').fill('Explain this passage in two sentences, using its chapter context and citing the chapter.');
    await page.locator('.wd-send').click();await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Stop',{},{timeout:15000});
    await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Send'&&!document.querySelector('.wd-turn-error'),{},{timeout:180000});
    let t=await (await ctx.request.get(url+'api/discussions/'+id)).json();assert.equal(t.messages.at(-1).state,'complete');assert.equal(t.messages.at(-1).model,'claude-sonnet-5');assert(t.messages.at(-1).content.length>50);assert(t.messages.at(-1).sources.some(s=>s.kind==='chapter'));
    fs.writeFileSync(path.join(out,'real-chapter-answer.json'),JSON.stringify(t,null,2));
    await page.locator('.wd-citation').first().click();assert(await page.locator('.wd-sources[open]').count());
    checks.push('Real Claude answer streamed and persisted with cited immutable chapter snapshot');
    await page.locator('.wd-web input').check();await page.locator('textarea').fill('Search the web for one reliable source that helps explain this passage. Explain how it relates to your previous answer in two sentences, and cite the web URL.');
    await page.locator('.wd-send').click();await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Stop',{},{timeout:15000});
    await page.locator('.wd-close').click();
    // Server-owned inference continues while the overlay is closed; inspect through the real app API.
    for(let i=0;i<90;i++){t=await (await ctx.request.get(url+'api/discussions/'+id)).json();if(!t.active)break;await page.waitForTimeout(2000);}
    assert(!t.active);assert.equal(t.messages.at(-1).state,'complete');assert(t.messages.at(-1).sources.some(s=>s.url.startsWith('http')),'A real retrieved web source must be cited');
    fs.writeFileSync(path.join(out,'real-search-followup.json'),JSON.stringify(t,null,2));
    await page.evaluate(id=>WisdomDiscussion.open({id}),id);await page.screenshot({path:path.join(out,'412-real-answer.png')});
    checks.push('Real web-search follow-up cites retrieved evidence and finishes while closed');
   }else await page.locator('textarea').fill('');
   await page.locator('textarea').blur();
   // Real shared Back: close source detail first, then overlay, retain reader.
   for(let i=0;i<4&&await page.evaluate(()=>WisdomDiscussion.isOpen());i++){await page.goBack();await page.waitForTimeout(200);}
   assert.equal(await page.evaluate(()=>WisdomDiscussion.isOpen()),false);assert.equal(await page.locator('.wb-reader').count(),1);
   assert.deepEqual(errors,[]);checks.push(width+': draft reload, saved-thread reopen and browser Back retain reader');
   await ctx.close();
  }
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({host:os.hostname(),type:'real API and first-party model acceptance; isolated starter library',checks},null,2));console.log(JSON.stringify(checks));
 }catch(e){if(lastPage&&!lastPage.isClosed()){await lastPage.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.html'),await lastPage.content());}throw e;}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
