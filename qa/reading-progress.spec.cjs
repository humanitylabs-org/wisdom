/* Read-only home regression in the real Wizard shell; run on Thales.
 * WISDOM_HOST_URL, PLAYWRIGHT_MODULE, QA_OUT required. QA_ASSET_DIR stages candidate JS.
 */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[];
 const out=process.env.QA_OUT;fs.mkdirSync(out,{recursive:true});
 try{for(const width of [360,412,1280]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:'dark',isMobile:width<900,hasTouch:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({contentType:'application/json',body:'{}'}));
  if(process.env.QA_ASSET_DIR)await page.route('**/wisdom.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(process.env.QA_ASSET_DIR,'wisdom.js'),'utf8')}));
  await page.goto(process.env.WISDOM_HOST_URL);await page.locator('iframe[src*="/wisdom/"]').waitFor({timeout:30000});
  await page.frameLocator('iframe[src*="/wisdom/"]').locator('.wb-home').waitFor({timeout:30000});
  const frame=page.frames().find(f=>f.url().includes('/wisdom/'));assert(frame);
  const d=await frame.evaluate(async()=>await(await fetch('api/wisdom')).json());
  // Contract (18 Oct): Continue reading = most recently opened collection at its open chapter; Currently reading = the rest, latest first.
  const E=id=>d.entries.find(e=>e.id===id),touched=e=>[e?.opened_at,e?.read_at].filter(Boolean).sort().pop()||'';
  const lastTouch=c=>c.entries.map(E).filter(Boolean).map(touched).sort().pop()||'';
  const resumeOf=c=>{const last=c.entries.map(E).filter(e=>e&&touched(e)).sort((a,b)=>touched(b).localeCompare(touched(a)))[0];return last&&(Number(last.progress)||0)<100&&!(last.read&&!last.opened_at)?last.id:c.next_id};
  const all=d.collections.filter(c=>(c.read>0||lastTouch(c))&&resumeOf(c)).sort((a,b)=>lastTouch(b).localeCompare(lastTouch(a))||(b.last_read_at||'').localeCompare(a.last_read_at||''));
  const expected=all.slice(1);
  assert.equal(await frame.locator('.wb-home>section').first().getAttribute('aria-label'),'Continue reading');
  assert.equal(await frame.locator('.wb-continue .wb-hero').getAttribute('href'),'#/read/'+resumeOf(all[0])+'/'+all[0].id);
  const links=await frame.locator('.wb-reading .wb-pick').evaluateAll(es=>es.map(e=>e.getAttribute('href')));
  assert.deepEqual(links,expected.map(c=>'#/read/'+resumeOf(c)+'/'+c.id));
  assert.equal(await frame.locator('.wb-reading .wb-head>span').innerText(),String(expected.length));
  const sugg=await frame.locator('.wb-suggested .wb-head').innerText();
  checks.push({width,continue:all[0].id+'/'+resumeOf(all[0]),reading:expected.map(c=>c.id),suggestedHead:sugg});
  await page.screenshot({path:path.join(out,`${width}-home.png`)});
  if(await frame.locator('.wb-suggested .wb-head-link').count()){await frame.locator('.wb-suggested .wb-head-link').click();await frame.locator('.wb-suggested-all').waitFor();
   const n=await frame.locator('.wb-suggested-all .wb-cover').count();await page.screenshot({path:path.join(out,`${width}-suggested-all.png`)});
   await frame.evaluate(()=>Wisdom.back());await frame.locator('.wb-home').waitFor();checks.push({width,viewAll:n});}
  const bars=await frame.locator('.wb-reading .wb-reading-bar').evaluateAll(es=>es.map(e=>({pct:Number(e.getAttribute('aria-valuenow')),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,fill:e.firstElementChild.getBoundingClientRect().width,color:getComputedStyle(e.firstElementChild).backgroundColor})));
  assert.equal(bars.length,expected.length);
  for(let i=0;i<expected.length;i++){
   const c=expected[i],es=c.entries.filter(id=>id!==c.overview).map(id=>d.entries.find(e=>e.id===id)).filter(Boolean);
   const pct=Math.round(100*es.reduce((s,e)=>s+(e.read?1:Math.max(0,Math.min(100,Number(e.progress)||0))/100),0)/es.length);
   assert.equal(bars[i].pct,pct);assert(bars[i].width>100&&bars[i].height>=3);assert(Math.abs(bars[i].fill-bars[i].width*pct/100)<1,JSON.stringify({width,bar:bars[i],pct}));
   const rgb=bars[i].color.match(/\d+/g).map(Number);assert(rgb[0]>rgb[1]&&rgb[1]>rgb[2]&&rgb[0]>170,'Progress fill must be yellow/gold');
  }
  if(expected.length){const first=frame.locator('.wb-reading .wb-pick').first();const href=await first.getAttribute('href');await first.click();await frame.locator('.wb-reader').waitFor();
   assert.equal('#'+(await frame.evaluate(()=>location.hash)).slice(1),href);await page.waitForTimeout(600);await frame.evaluate(()=>Wisdom.back());await page.waitForTimeout(900);const landed=await frame.evaluate(()=>({hash:location.hash,home:!!document.querySelector('.wb-home'),col:!!document.querySelector('.wb-collection'),reader:!!document.querySelector('.wb-reader')}));checks.push({width,backLanded:landed});await page.screenshot({path:path.join(out,`${width}-after-back.png`)});
   assert(landed.col&&!landed.reader,JSON.stringify(landed));await frame.evaluate(()=>Wisdom.back());await frame.locator('.wb-home').waitFor();assert.equal(await frame.locator('.wb-reading .wb-pick').count(),expected.length);}
  assert(!errors.length,errors.join('\n'));
  checks.push({width,bars:bars.length,resumeAndBack:true,errors});await context.close();
 }
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({mode:process.env.QA_ASSET_DIR?'candidate':'live',checks},null,2));console.log(JSON.stringify(checks));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
