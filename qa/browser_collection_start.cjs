// A collection nobody has opened starts at its overview; started collections keep resuming where the reader was.
// Usage: [STATIC_DIR=static] PLAYWRIGHT_DIR=... WISDOM_URL=http://127.0.0.1:<port>/ CORE_DIR=<wizard-os-home/web/core> node qa/browser_collection_start.cjs [outdir]
// Read-only: every non-GET request is aborted so owner data is never touched. Checks every collection and thinker page.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const fs=require('fs'),path=require('path');
(async()=>{
 const base=process.env.WISDOM_URL,out=process.argv[2]||'/tmp/collection-start';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true});const failures=[],rows=[];let blocked=0;
 const ctx=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true});
 await ctx.route('**/*',r=>{const q=r.request();if(q.method()!=='GET'){blocked++;return r.abort()}
  const u=new URL(q.url());if(process.env.CORE_DIR&&u.pathname.startsWith('/wizard-os-home/core/')){const f=path.join(process.env.CORE_DIR,u.pathname.slice('/wizard-os-home/core/'.length));if(fs.existsSync(f))return r.fulfill({path:f,contentType:'text/javascript'})}
  if(process.env.STATIC_DIR&&/\.(css|js)$/.test(u.pathname)&&!u.pathname.startsWith('/wizard-os-home/')){const f=path.join(process.env.STATIC_DIR,u.pathname.replace(/^\/(wisdom\/)?/,''));if(fs.existsSync(f))return r.fulfill({path:f,contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript'})}
  return r.continue()});
 const page=await ctx.newPage();
 await page.goto(base);await page.waitForSelector('.wb-hero',{timeout:20000});
 const d=await page.evaluate(async()=>await (await fetch('api/wisdom')).json());
 const E=new Map(d.entries.map(e=>[e.id,e]));
 const touched=c=>c.entries.some(i=>{const e=E.get(i)||{};return e.opened_at||e.read_at||e.read});
 const cta=async route=>{await page.goto('about:blank');await page.goto(base+'#'+route);await page.waitForSelector('.wb-book-cta .wb-primary',{timeout:8000});
  return page.evaluate(()=>{const a=document.querySelector('.wb-book-cta .wb-primary');const next=document.querySelector('.wb-toc .is-next,.wb-toc [aria-current]');return {href:a.getAttribute('href'),text:a.textContent.trim(),next:next&&next.textContent.trim().slice(0,40)}})};
 for(const c of d.collections){
  const m=await cta('/collection/'+c.id),fresh=c.overview&&!(E.get(c.overview)||{}).read&&!touched(c);
  const row={id:c.id,overview:c.overview||null,fresh:!!fresh,...m};rows.push(row);
  if(fresh&&!m.href.includes('/read/'+c.overview+'/'))failures.push(`${c.id}: unopened collection Start goes to ${m.href}, not its overview`);
  if(fresh&&!/^Start · Overview/.test(m.text))failures.push(`${c.id}: Start label "${m.text}"`);
  if(!fresh&&c.overview&&m.href.includes('/read/'+c.overview+'/')&&(E.get(c.overview)||{}).read)failures.push(`${c.id}: started collection sends the reader back to a read overview`);
 }
 // Single-thinker collection: the thinker page's Start follows the same rule.
 for(const c of d.collections.filter(c=>c.overview&&c.thinkers.length===1&&(E.get(c.overview)||{}).thinker===c.thinkers[0])){
  const t=c.thinkers[0];if(d.collections.filter(x=>x.thinkers.includes(t)).length!==1)continue;
  const m=await cta('/thinker/'+t),fresh=!(E.get(c.overview)||{}).read&&!touched(c);rows.push({thinker:t,fresh,...m});
  if(fresh&&!m.href.includes('/read/'+c.overview+'/'))failures.push(`thinker ${t}: Start goes to ${m.href}, not the overview`);
 }
 // Tapping Start actually opens the overview reader.
 const f=d.collections.find(c=>c.overview&&!(E.get(c.overview)||{}).read&&!touched(c));
 if(f){await page.goto('about:blank');await page.goto(base+'#/collection/'+f.id);await page.waitForSelector('.wb-book-cta .wb-primary');await page.locator('.wb-book-cta .wb-primary').click();
  await page.waitForTimeout(800);const h=await page.evaluate(()=>location.hash);rows.push({tapped:f.id,hash:h});if(!h.startsWith('#/read/'+f.overview))failures.push(`tap Start on ${f.id} landed on ${h}`);
  await page.screenshot({path:path.join(out,`start-${f.id}.png`)})}
 await browser.close();
 fs.writeFileSync(path.join(out,'collection-start.json'),JSON.stringify({failures,blocked,rows},null,1));
 console.log(JSON.stringify({checked:rows.length,fresh:rows.filter(r=>r.fresh).length,failures,blockedWrites:blocked}));
 process.exit(failures.length?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
