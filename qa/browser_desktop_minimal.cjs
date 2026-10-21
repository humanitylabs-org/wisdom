// Desktop Wisdom is one quiet column like the phone: no Thinkers rail, centred, nothing overflowing.
// Usage: [STATIC_DIR=static] PLAYWRIGHT_DIR=... WISDOM_URL=http://127.0.0.1:<port>/ CORE_DIR=<wizard-os-home/web/core> node qa/browser_desktop_minimal.cjs [outdir]
// Read-only: every non-GET request is aborted so owner data is never touched.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const fs=require('fs'),path=require('path');
(async()=>{
 const base=process.env.WISDOM_URL,out=process.argv[2]||'desktop-minimal';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true});const failures=[],rows=[];let blocked=0;
 const sizes=[{w:1280,h:760,mobile:false},{w:1680,h:1000,mobile:false},{w:1024,h:700,mobile:false},{w:412,h:860,mobile:true}];
 for(const s of sizes){
  const ctx=await browser.newContext({viewport:{width:s.w,height:s.h},isMobile:s.mobile,hasTouch:s.mobile,deviceScaleFactor:s.mobile?2:1});
  await ctx.route('**/*',r=>{const q=r.request();if(q.method()!=='GET'){blocked++;return r.abort()}
   const u=new URL(q.url());if(process.env.CORE_DIR&&u.pathname.startsWith('/wizard-os-home/core/')){const f=path.join(process.env.CORE_DIR,u.pathname.slice('/wizard-os-home/core/'.length));if(fs.existsSync(f))return r.fulfill({path:f,contentType:'text/javascript'})}
   if(process.env.STATIC_DIR&&/\.(css|js)$/.test(u.pathname)&&!u.pathname.startsWith('/wizard-os-home/')){const f=path.join(process.env.STATIC_DIR,u.pathname.replace(/^\/(wisdom\/)?/,''));if(fs.existsSync(f))return r.fulfill({path:f,contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript'})}
   return r.continue()});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const tag=`${s.w}x${s.h}`;
  const measure=()=>page.evaluate(()=>{const main=document.querySelector('.w-main').getBoundingClientRect();
   const thinkersHeading=[...document.querySelectorAll('h2')].some(h=>h.textContent.trim()==='Thinkers'&&h.getBoundingClientRect().width>0);
   return {rail:!!document.querySelector('.w-rail,.rail-card'),thinkersHeading,mainLeft:Math.round(main.left),mainRight:Math.round(innerWidth-main.right),mainWidth:Math.round(main.width),overflowX:document.documentElement.scrollWidth>innerWidth}});
  // Home
  await page.goto(base);await page.waitForSelector('.wb-hero',{timeout:20000});await page.waitForTimeout(600);
  const home=await measure();rows.push({tag,view:'home',...home});
  await page.screenshot({path:path.join(out,`home-${tag}.png`)});
  // A thinker page and a collection page keep the same single column.
  const d=await page.evaluate(async()=>{const j=await (await fetch('api/wisdom')).json();return {thinker:j.thinkers[0].id,col:j.collections[0].id}});
  for(const [view,hash,sel] of [['thinker','#/thinker/'+d.thinker,'.wisdom-thinker,.wb-book'],['collection','#/collection/'+d.col,'.wb-collection']]){
   await page.goto('about:blank');await page.goto(base+hash);
   const ok=await page.waitForSelector(sel,{timeout:8000}).then(()=>1,()=>0);if(!ok){failures.push(`${tag} ${view}: did not render`);continue}
   await page.waitForTimeout(300);const m=await measure();rows.push({tag,view,...m});
   await page.screenshot({path:path.join(out,`${view}-${tag}.png`)});
  }
  for(const r of rows.filter(r=>r.tag===tag)){
   if(r.rail||r.thinkersHeading)failures.push(`${tag} ${r.view}: Thinkers rail still shown`);
   if(r.overflowX)failures.push(`${tag} ${r.view}: horizontal overflow`);
   if(!s.mobile&&Math.abs(r.mainLeft-r.mainRight)>2)failures.push(`${tag} ${r.view}: column not centred (${r.mainLeft} vs ${r.mainRight})`);
   if(!s.mobile&&r.mainWidth>720)failures.push(`${tag} ${r.view}: column wider than 720 (${r.mainWidth})`);
   if(s.mobile&&r.mainWidth!==s.w)failures.push(`${tag} ${r.view}: phone column not full width (${r.mainWidth})`);
  }
  if(errors.length)failures.push(`${tag}: page errors ${errors.slice(0,2).join(' | ')}`);
  await ctx.close();
 }
 await browser.close();
 fs.writeFileSync(path.join(out,'desktop-minimal.json'),JSON.stringify({failures,blocked,rows},null,1));
 console.log(JSON.stringify({checks:rows.length,blockedWrites:blocked,failures},null,1));
 process.exit(failures.length?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
