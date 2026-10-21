// Hosted production acceptance: real shell/assets/reads, owner writes intercepted.
const {chromium}=require(process.env.PLAYWRIGHT_DIR),assert=require('assert'),fs=require('fs');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});const checks=[];try{
 for(const width of [360,412]){
  const ctx=await browser.newContext({viewport:{width,height:915},isMobile:true,hasTouch:true});let snapshot,ratings=[];
  await ctx.route('**/wisdom/api/**',async r=>{if(r.request().method()==='GET')return r.continue();const d=r.request().postDataJSON();if(d?.field==='rating'){ratings.push(d.value);await new Promise(r=>setTimeout(r,800));}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot||{})})});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.WISDOM_QA_ORIGIN+'/wizard-os-home/?open=wisdom');
  await page.waitForFunction(()=>!!document.querySelector('iframe[src*="/wisdom/"]'));
  const element=await page.locator('iframe[src*="/wisdom/"]').elementHandle(),frame=await element.contentFrame();await frame.waitForSelector('.wb-home');
  snapshot=await frame.evaluate(async()=>await(await fetch('api/wisdom')).json());
  const entry=snapshot.entries.find(e=>e.title===process.env.WISDOM_QA_CHAPTER_TITLE);assert(entry,'reported chapter missing');
  await frame.evaluate(id=>Wisdom.navigate('/read/'+id),entry.id);await frame.waitForSelector('.wb-reader');await frame.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await page.waitForTimeout(600);
  for(let n=0;n<40&&await frame.locator('.wb-reader').getAttribute('data-at')!=='end';n++)await frame.locator('body').press('ArrowRight');await page.waitForTimeout(500);assert.equal(await frame.locator('.wb-reader').getAttribute('data-at'),'end');
  const up=frame.locator('[data-wisdom-rate][data-value="1"]'),down=frame.locator('[data-wisdom-rate][data-value="-1"]');
  const target=entry.rating===1?down:up,expected=entry.rating===1?-1:1;
  await frame.evaluate(()=>window.originalReader=document.querySelector('.wb-reader'));
  const started=Date.now();await target.tap();assert.equal(await target.getAttribute('aria-pressed'),'true');const ms=Date.now()-started;assert(ms<650);await page.waitForTimeout(1100);assert.deepEqual(ratings,[expected]);assert(await frame.evaluate(()=>window.originalReader===document.querySelector('.wb-reader')));
  checks.push({width,chapter:entry.id,instantFeedbackMs:ms,oneTapOneWrite:true,readerUnchanged:true,ownerWrites:'intercepted'});
  await page.screenshot({path:process.env.WISDOM_QA_EVIDENCE+'/live-ratings-'+width+'.png'});assert.deepEqual(errors,[]);await ctx.close();
 }
 const result={status:'pass',host:require('os').hostname(),checks};fs.writeFileSync(process.env.WISDOM_QA_EVIDENCE+'/live-ratings.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
