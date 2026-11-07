// Go deeper card on a live library (read-only): every chapter in a multi-thinker collection whose thinker has a
// single-thinker collection shows the card, it fits a phone, and tapping it opens that collection.
// Usage: [STATIC_DIR=static] PLAYWRIGHT_DIR=... WISDOM_URL=https://<host>/wisdom/ node qa/browser_go_deeper_live.cjs [outdir]
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const base=process.env.WISDOM_URL,out=process.argv[2]||'/tmp/go-deeper';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true});const errors=[],rows=[];let blocked=0;
 const ctx=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true});
 await ctx.route('**/*',r=>{const q=r.request();if(q.method()!=='GET'){blocked++;return r.abort()}
  const u=new URL(q.url());
  if(process.env.STATIC_DIR&&/\.(css|js)$/.test(u.pathname)&&!u.pathname.startsWith('/wizard-os-home/')){const f=path.join(process.env.STATIC_DIR,u.pathname.replace(/^\/(wisdom\/)?/,''));if(fs.existsSync(f))return r.fulfill({path:f,contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript'})}
  return r.continue()});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base);await page.waitForSelector('.wb-hero',{timeout:20000});
 const d=await page.evaluate(async()=>await (await fetch('api/wisdom')).json());
 const own=t=>d.collections.filter(c=>c.thinkers.length===1&&c.thinkers[0]===t&&c.count>0);
 const want=[];for(const c of d.collections.filter(c=>c.thinkers.length>1))for(const id of c.entries){const e=d.entries.find(x=>x.id===id);if(e)want.push({c:c.id,e:id,deep:own(e.thinker).map(x=>x.id)})}
 const only=process.env.ONLY_COLLECTION;
 for(const w of want.filter(w=>!only||w.c===only)){
  await page.goto('about:blank');await page.goto(base+`#/read/${w.e}/${w.c}`);await page.waitForSelector(`.wb-reader[data-read="${w.e}"]`,{timeout:10000});
  const got=await page.evaluate(()=>{const a=document.querySelector('.wb-end [data-wisdom-go-deeper]');return a&&{id:a.dataset.wisdomGoDeeper,text:a.innerText.replace(/\s+/g,' ').trim()}});
  if(w.deep.length)assert(got&&w.deep.includes(got.id),`${w.c}/${w.e}: expected one of ${w.deep}, got ${JSON.stringify(got)}`);else assert.equal(got,null,`${w.c}/${w.e}: unexpected card`);
  rows.push({...w,card:got});
 }
 // Visual + tap on the first sampler chapter that has a card.
 const hit=rows.find(r=>r.card);assert(hit,'no chapter with a card');
 await page.goto('about:blank');await page.goto(base+`#/read/${hit.e}/${hit.c}`);await page.waitForSelector('.wb-reader');
 for(let i=0;i<120&&await page.evaluate(()=>document.querySelector('.wb-reader')?.dataset.at)!=='end';i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(50)}
 await page.waitForTimeout(500);await page.waitForFunction(()=>[...document.querySelectorAll('.wb-end img')].every(i=>i.complete),null,{timeout:8000}).catch(()=>{});await page.waitForTimeout(300);const card=page.locator('.wb-end [data-wisdom-go-deeper]');await card.scrollIntoViewIfNeeded();
 const fit=await page.evaluate(()=>{const e=document.querySelector('.wb-end'),b=e.querySelector('.wb-go-deeper').getBoundingClientRect();return {scroll:e.scrollWidth<=e.clientWidth,inside:b.left>=0&&b.right<=innerWidth,height:Math.round(b.height)}});
 assert(fit.scroll&&fit.inside,JSON.stringify(fit));
 await page.screenshot({path:path.join(out,'go-deeper-end.png')});
 await card.tap();await page.waitForFunction(id=>location.hash==='#/collection/'+id,hit.card.id,{timeout:6000});await page.waitForSelector('.wb-collection',{timeout:6000});
 await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'go-deeper-target.png')});
 await page.evaluate(()=>history.back());await page.waitForFunction(e=>!!document.querySelector(`.wb-reader[data-read="${e}"]`),hit.e,{timeout:6000});
 assert.deepEqual(errors,[]);
 const res={ok:true,checked:rows.length,with_card:rows.filter(r=>r.card).length,fit,tapped:hit,back_returns_to_reader:true,blocked_writes:blocked};
 fs.writeFileSync(path.join(out,'go-deeper.json'),JSON.stringify({...res,rows},null,1));console.log(JSON.stringify(res));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
