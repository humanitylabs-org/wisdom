/* Read-only hosted regression: use an existing discussion; never submit model work.
 * WISDOM_HOST_URL=https://host/wizard-os-home/?open=wisdom
 * PLAYWRIGHT_MODULE=/path/to/playwright QA_OUT=/path/to/evidence node qa/discussions-appearance.spec.cjs
 * Optional QA_ASSET_DIR intercepts candidate discussions.{css,js}; omit for deployed proof.
 */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const url=process.env.WISDOM_HOST_URL;assert(url,'WISDOM_HOST_URL required');
 const out=process.env.QA_OUT;assert(out,'QA_OUT required');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[];
 try {for(const width of [360,412,1280]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<900,hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
  // Reading may save progress: keep this visual regression read-only.
  await page.route('**/wisdom/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({contentType:'application/json',body:'{}'}));
  if(process.env.QA_ASSET_DIR)for(const ext of ['css','js'])await page.route(`**/discussions.${ext}*`,r=>r.fulfill({contentType:ext==='css'?'text/css':'application/javascript',body:fs.readFileSync(path.join(process.env.QA_ASSET_DIR,`discussions.${ext}`),'utf8')}));
  await page.goto(url);await page.locator('iframe[src*="/wisdom/"]').waitFor({timeout:30000});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('iframe')).some(f=>f.src.includes('/wisdom/')&&f.contentWindow?.WisdomDiscussion));let frame=await (await page.locator('iframe[src*="/wisdom/"]').elementHandle()).contentFrame();assert(frame);
  await frame.locator('[data-wisdom-discussions]').first().waitFor();
  if(width>=900){await page.goto(frame.url());frame=page.mainFrame();await frame.waitForFunction(()=>!!window.WisdomDiscussion);await frame.locator('[data-wisdom-discussions]').first().waitFor();}
  const thread=await frame.evaluate(async()=>{const d=await(await fetch('api/discussions')).json();return d.threads.find(t=>!t.active&&t.message_count===0)});assert(thread,'An existing empty discussion is required');
  await frame.evaluate(id=>Wisdom.navigate('/read/'+id),thread.entry_id);await frame.locator('.wb-reader').waitFor();
  // Exercise text behind the sheet, not an empty list or book cover.
  await frame.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
  await page.waitForTimeout(250);
  await frame.evaluate(id=>WisdomDiscussion.open(id),thread.id);await frame.locator('.wd-quote blockquote').waitFor();await page.waitForTimeout(300);
  const metrics=await frame.evaluate(()=>{const p=document.querySelector('.wd-panel'),b=document.querySelector('.wd-body'),s=getComputedStyle(p);return{background:s.backgroundColor,backgroundImage:s.backgroundImage,frameWidth:innerWidth,panel:p.getBoundingClientRect().toJSON(),body:b.getBoundingClientRect().toJSON(),jump:!document.querySelector('.wd-jump').hidden}});
  assert(!metrics.jump,'No Latest reply control before a reply exists');
  assert(metrics.body.height>170,'Passage and starter area must have readable space');
  if(width>=900){assert(metrics.frameWidth>=900,'Desktop must really exercise side-panel breakpoint');assert.equal(metrics.panel.width,400);}
  const box=await frame.locator('.wd-body').boundingBox();const clip={x:Math.ceil(box.x)+2,y:Math.ceil(box.y)+2,width:Math.floor(box.width)-4,height:Math.floor(box.height)-4};
  const before=await page.screenshot({clip,animations:'disabled'});
  await frame.locator('.wb-reader').evaluate(el=>el.style.visibility='hidden');
  const behindHidden=await page.screenshot({clip,animations:'disabled'});
  await frame.locator('.wb-reader').evaluate(el=>el.style.visibility='');
  fs.writeFileSync(path.join(out,`${width}-pixels-visible.png`),before);fs.writeFileSync(path.join(out,`${width}-pixels-hidden.png`),behindHidden);
  const pixels=await page.evaluate(async({a,b})=>{const decode=async s=>{const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return x.getImageData(0,0,c.width,c.height).data};const x=await decode(a),y=await decode(b);let max=0;for(let i=0;i<x.length;i++)max=Math.max(max,Math.abs(x[i]-y[i]));return{maxDelta:max}}, {a:before.toString('base64'),b:behindHidden.toString('base64')});
  assert(pixels.maxDelta<=2,'Reader pixels bleed through the discussion body: '+pixels.maxDelta);
  await page.screenshot({path:path.join(out,`${width}-passage.png`)});
  const text='Explain the distinction in this passage.';
  await frame.locator('.wd-composer textarea').fill(text);await page.waitForTimeout(250);
  await page.screenshot({path:path.join(out,`${width}-composer.png`)});
  await frame.locator('.wd-close').click();assert.equal(await frame.locator('.wd-overlay:not([hidden])').count(),0);
  await frame.evaluate(id=>WisdomDiscussion.open(id),thread.id);
  assert.equal(await frame.locator('.wd-composer textarea').inputValue(),text);
  await frame.evaluate(()=>WisdomDiscussion.back());assert.equal(await frame.locator('.wd-overlay:not([hidden])').count(),0);assert.equal(await frame.locator('.wb-reader').count(),1);
  checks.push({width,...metrics,opaquePixelProof:true,draftPreserved:true,backRetainsReader:true});await context.close();
 }
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({scope:process.env.QA_ASSET_DIR?'candidate assets in actual hosted shell':'deployed hosted shell, no candidate interception',checks},null,2));console.log(JSON.stringify(checks));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
