// Collection hero must leave room for its floating Back button: no overlap with the kicker/title for ANY collection.
// Usage: [STATIC_DIR=static] PLAYWRIGHT_DIR=... WISDOM_URL=http://127.0.0.1:<port>/ CORE_DIR=<wizard-os-home/web/core> node qa/browser_collection_hero_room.cjs [outdir]
// Read-only: every non-GET request is aborted so owner data is never touched.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const fs=require('fs'),path=require('path');
(async()=>{
 const base=process.env.WISDOM_URL,out=process.argv[2]||'/tmp/hero-room';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true});const failures=[],rows=[];let blocked=0;
 for(const [w,h] of [[412,708],[360,640],[412,915]]){
  const ctx=await browser.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await ctx.route('**/*',r=>{const q=r.request();if(q.method()!=='GET'){blocked++;return r.abort()}
   const u=new URL(q.url());if(process.env.CORE_DIR&&u.pathname.startsWith('/wizard-os-home/core/')){const f=path.join(process.env.CORE_DIR,u.pathname.slice('/wizard-os-home/core/'.length));if(fs.existsSync(f))return r.fulfill({path:f,contentType:'text/javascript'})}
   // STATIC_DIR overlays candidate CSS/JS onto a running server's real data (read-only preview of a fix).
   if(process.env.STATIC_DIR&&/\.(css|js)$/.test(u.pathname)&&!u.pathname.startsWith('/wizard-os-home/')){const f=path.join(process.env.STATIC_DIR,u.pathname.replace(/^\/(wisdom\/)?/,''));if(fs.existsSync(f))return r.fulfill({path:f,contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript'})}
   return r.continue()});
  const page=await ctx.newPage();
  await page.goto(base);await page.waitForSelector('.wb-hero',{timeout:20000});
  const cols=await page.evaluate(async()=>(await (await fetch('api/wisdom')).json()).collections.map(c=>c.id));
  for(const id of cols){
   await page.goto('about:blank');await page.goto(base+'#/collection/'+id);
   const ok=await page.waitForSelector('.wb-collection .wb-book-copy h1',{timeout:8000}).then(()=>1,()=>0);if(!ok){failures.push(`${w}x${h} ${id}: collection page did not render (${await page.evaluate(()=>location.hash+' '+(document.querySelector('#app')||{}).className)})`);continue}await page.waitForTimeout(150);
   const m=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect();const b=r(document.querySelector('.wb-book-top [data-wisdom-back]')),k=r(document.querySelector('.wb-book-copy small')),t=r(document.querySelector('.wb-book-copy h1')),hero=r(document.querySelector('.wb-book-hero'));
    return {backBottom:Math.round(b.bottom),backRight:Math.round(b.right),kickerTop:Math.round(k.top),titleTop:Math.round(t.top),heroTop:Math.round(hero.top),overflowX:document.documentElement.scrollWidth>innerWidth}});
   const clear=m.kickerTop-m.backBottom;rows.push({w,h,id,...m,clear});
   if(clear<12)failures.push(`${w}x${h} ${id}: kicker ${clear}px below back button`);
   if(m.overflowX)failures.push(`${w}x${h} ${id}: horizontal overflow`);
   if(id==='thinking-in-arrows'||id==='wisdom-of-tarot')await page.screenshot({path:path.join(out,`${id}-${w}x${h}.png`)});
  }
  // Back from a collection still stays inside Wisdom.
  await page.locator('.wb-book-top [data-wisdom-back]').click();await page.waitForTimeout(400);
  if(!(await page.locator('.wb-home').count())||page.url()==='about:blank')failures.push(`${w}x${h}: Back did not land on Wisdom home`);
  await ctx.close();
 }
 await browser.close();
 fs.writeFileSync(path.join(out,'hero-room.json'),JSON.stringify({failures,blocked,rows},null,1));
 const bad=rows.filter(r=>r.clear<12);
 console.log(JSON.stringify({collections:new Set(rows.map(r=>r.id)).size,checks:rows.length,failing:bad.length,failingIds:[...new Set(bad.map(r=>r.id))].length,minClear:Math.min(...rows.map(r=>r.clear)),blockedWrites:blocked,failures:failures.slice(0,8)}));
 process.exit(failures.length?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
