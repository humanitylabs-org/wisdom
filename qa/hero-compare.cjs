// Compare the Home top card: private.7 hero (before) vs candidate Continue reading card, in the live Wizard shell.
// Assets are swapped via route; every non-GET is intercepted. Writes compare.json + screenshots.
const {chromium,devices}=require(process.env.PLAYWRIGHT_DIR),fs=require('fs'),path=require('path');
const URL0='https://wizard.tailc0f369.ts.net/wizard-os-home/?open=wisdom',OUT=process.env.OUT;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),res={};
 try{for(const variant of ['before','after'])for(const width of [390,360]){
  const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width,height:915}});
  await ctx.route('**/wisdom/**',async r=>{const q=r.request(),u=new URL(q.url()).pathname;
   if(q.method()!=='GET')return r.fulfill({status:200,contentType:'application/json',body:'{}'});
   for(const f of ['wisdom.js','wisdom.css'])if(u.endsWith('/'+f))return r.fulfill({contentType:f.endsWith('.js')?'application/javascript':'text/css',body:fs.readFileSync(path.join(process.env[variant.toUpperCase()],f),'utf8')});
   return r.continue()});
  const page=await ctx.newPage();await page.goto(URL0);
  let el=await page.waitForSelector('iframe[src*="/wisdom/"]'),frame=await el.contentFrame();await frame.waitForSelector('.wb-home .wb-hero',{timeout:30000});
  for(const h of await page.locator('iframe[src*="/wisdom/"]').elementHandles()){const b=await h.boundingBox();if(b&&b.x>=0&&b.x<width){frame=await h.contentFrame();break}}
  await frame.evaluate(()=>document.fonts.ready);await page.waitForTimeout(800);
  res[variant+'-'+width]=await frame.evaluate(()=>{const h=document.querySelector('.wb-home .wb-hero'),b=h.getBoundingClientRect(),s=h.querySelector('strong'),q=s=>getComputedStyle(s);
   return {height:Math.round(b.height),width:Math.round(b.width),titleSize:q(s).fontSize,titleFont:q(s).fontFamily.split(',')[0],deck:!!h.querySelector('.wb-hero-deck')?.textContent,bar:!!h.querySelector('.wb-reading-bar'),label:h.querySelector('small').textContent,title:s.textContent,pill:h.querySelector('.wb-pill').textContent}});
  await page.screenshot({path:path.join(OUT,`${variant}-${width}.png`)});await ctx.close();
 }}finally{await browser.close()}
 fs.writeFileSync(path.join(OUT,'compare.json'),JSON.stringify(res,null,1));console.log(JSON.stringify(res,null,1));
})().catch(e=>{console.error(e);process.exitCode=1});
