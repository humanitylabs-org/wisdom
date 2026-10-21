// Thales: Home leads with Continue reading (last chapter open, at its page), then Currently reading by most
// recently opened, then Suggested newest first with View all. Real HTTP fixture + shared WizardApp, disposable data.
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
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   const base=info.url;
   await page.goto(base);await page.waitForSelector('.wb-home');
   const data=await page.evaluate(async()=>(await fetch('api/wisdom')).json());
   // Two chapters in two different collections; the second one opened last.
   const cols=data.collections.filter(c=>c.entries.length>1).slice(0,2);assert.equal(cols.length,2,'fixture needs two collections');
   const pick=c=>c.entries.find(i=>i!==c.overview)||c.entries[0];
   const ready=async()=>{await page.waitForSelector('.wb-reader');await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent)};
   const visit=async(c,turns)=>{await page.goto('about:blank');await page.goto(base+`#/read/${pick(c)}/${c.id}`);await ready();for(let i=0;i<turns;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(250)}await page.waitForTimeout(400);return page.locator('.wb-count').innerText()};
   await visit(cols[0],2);await page.waitForTimeout(1100);
   const at=await visit(cols[1],3);
   // A fresh launch (no hash) lands on Home rather than inside the book.
   // A launch more than a minute after leaving (stale checkpoint) lands on Home rather than inside the book.
   await page.goto(base+'api/wisdom');await page.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.endsWith(':open'));if(!k)throw Error('no checkpoint');const v=JSON.parse(sessionStorage.getItem(k));v.at-=120000;sessionStorage.setItem(k,JSON.stringify(v))});
   await page.goto(base);await page.waitForSelector('.wb-home .wb-continue');
   const heads=await page.locator('.wb-home > section .wb-head > h2').allTextContents();
   assert.equal(await page.locator('.wb-home > section').first().getAttribute('aria-label'),'Continue reading');
   assert(heads[0].startsWith('Currently reading')&&heads[1].startsWith('Suggested'),heads.join('|'));
   assert.equal(await page.locator('.wb-continue .wb-hero').getAttribute('data-wisdom-route'),`/read/${pick(cols[1])}/${cols[1].id}`);
   const current=await page.locator('.wb-reading .wb-pick').evaluateAll(as=>as.map(a=>a.dataset.wisdomRoute));
   assert.equal(current[0],`/read/${pick(cols[0])}/${cols[0].id}`,'currently reading: most recently opened first');
   assert(!current.includes(`/read/${pick(cols[1])}/${cols[1].id}`),'continue card is not repeated');
   assert.equal(await page.locator('.wb-suggested .wb-cover').filter({has:page.locator(`[data-wisdom-route="/collection/${cols[1].id}"]`)}).count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);
   // Same layout as the original hero: description line, no extra progress bar, no layout overrides.
   assert.equal(await page.locator('.wb-continue .wb-hero-deck').count(),1);assert.equal(await page.locator('.wb-continue .wb-reading-bar').count(),0);
   await page.screenshot({path:path.join(evidence,`continue-home-${width}.png`)});checks.push('home order + continue target '+width);
   const frac=await page.evaluate(id=>Object.entries(localStorage).filter(([k])=>k.endsWith(':pos:'+id)),pick(cols[1]));
   const route=await page.locator('.wb-continue .wb-hero').getAttribute('data-wisdom-route');
   await page.locator('.wb-continue .wb-hero').focus();await page.keyboard.press('Enter');await ready();await page.waitForTimeout(800);const viaHash=await page.locator('.wb-count').innerText();await page.evaluate(()=>history.back());await page.waitForSelector('.wb-home .wb-continue');
   await page.locator('.wb-continue .wb-hero').click();await ready();const t0=await page.locator('.wb-count').innerText();await page.waitForTimeout(800);const t1=await page.locator('.wb-count').innerText();
   assert.equal(t1,at,JSON.stringify({frac,width,viaHash,t0,t1}));checks.push('continue resumes exact page '+width);
   await page.evaluate(()=>Wisdom.back());await page.waitForSelector('.wb-collection, .wb-home');
   // Suggested View all lists every unopened collection newest first.
   await page.goto('about:blank');await page.goto(base+'#/');await page.waitForSelector('.wb-home');
   const link=page.locator('.wb-suggested .wb-head-link');
   if(await link.count()){await link.click();await page.waitForSelector('.wb-suggested-all');
    const ids=await page.locator('.wb-suggested-all .wb-cover').evaluateAll(as=>as.map(a=>(a.dataset.wisdomRoute||a.querySelector('[data-wisdom-route]')?.dataset.wisdomRoute||'').split('/').pop()));
    const added=ids.map(id=>data.collections.find(c=>c.id===id)?.added_at||'');assert.deepEqual(added,[...added].sort().reverse(),'newest first');
    await page.evaluate(()=>history.back());await page.waitForSelector('.wb-home');checks.push('view all newest first, Back to Home '+width);
   }else checks.push('fixture has <=6 suggestions; View all hidden '+width);
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'continue.json'),JSON.stringify({checks},null,1));console.log(JSON.stringify({status:'pass',checks}));
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
