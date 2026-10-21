'use strict';
// Look up popover streaming at phone widths against qa/browser_lookup_fixture.py.
// PLAYWRIGHT_DIR=… FIXTURE_URL=… EVIDENCE=… node qa/browser_lookup.cjs
const {chromium,devices}=require(process.env.PLAYWRIGHT_DIR),fs=require('fs'),assert=require('assert');
const base=process.env.FIXTURE_URL,ev=process.env.EVIDENCE;assert(base&&ev,'FIXTURE_URL and EVIDENCE required');
const ANSWER='Here the word names the specific idea the passage is discussing, read in its own context. It points at what the author means in this sentence.';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.CHANNEL||undefined});const out=[];
 try{for(const width of [360,390,412]){
  const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width,height:860}});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('.wb-home');
  const entry=await page.evaluate(async()=>(await(await fetch('api/wisdom')).json()).entries.find(e=>e.body&&e.enabled!==false).id);
  await page.evaluate(id=>Wisdom.navigate('/read/'+id),entry);await page.waitForSelector('.wb-reader');await page.waitForTimeout(600);
  const words=()=>page.locator('.wb-flow').evaluate(flow=>{const st=document.querySelector('.wb-stage').getBoundingClientRect(),w=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT),o=[];let n;while(n=w.nextNode())for(const m of n.nodeValue.matchAll(/[A-Za-z]{4,}/g)){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);for(const q of r.getClientRects())if(q.width&&q.left>=st.left&&q.right<=st.right&&q.top>=st.top+20&&q.bottom<st.bottom-160){o.push({x:q.x+q.width/2,y:q.y+q.height/2,w:m[0]});break}}return o});
  const turn=async()=>{const b=await page.locator('.wb-stage').boundingBox();await page.touchscreen.tap(b.x+b.width-15,b.y+b.height*.5);await page.waitForTimeout(450)};
  let v=[];for(let i=0;i<8;i++){v=await words();if(v.length>25)break;await turn()}assert(v.length>20,'visible words '+v.length);
  const cdp=await ctx.newCDPSession(page),touch=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[p]:[]});
  const lookUp=async p=>{await touch('touchStart',p);await page.waitForTimeout(650);await touch('touchEnd');await page.waitForTimeout(250);
   const b=await page.locator('[data-hl-act="lookup"]:visible').boundingBox();assert(b,'Look up action visible');await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2)};
  const popText=()=>page.evaluate(()=>{const p=document.querySelector('.wb-glosspop');return p&&!p.hidden?p.querySelector('.wb-gp-en')?.textContent||'':null});
  // 1. Streams progressively, then the validated final replaces the provisional text.
  const t0=Date.now();await lookUp(v[12]);const timeline=[];let last;
  for(;;){const t=await popText();if(t!==last){timeline.push({ms:Date.now()-t0,text:t});last=t;if(t===ANSWER)break;if(t!==null&&t!=='Explaining…'&&!t.endsWith(' …'))break}
   if(Date.now()-t0>8000)break;if(timeline.filter(x=>x.text&&x.text.endsWith(' …')).length===2)await page.screenshot({path:`${ev}/stream-mid-${width}.png`});await page.waitForTimeout(30)}
  const partials=timeline.filter(x=>x.text&&x.text.endsWith(' …'));
  assert.equal(last,ANSWER,'final validated text shown: '+JSON.stringify(timeline));
  assert(partials.length>=2,'progressive partials: '+JSON.stringify(timeline));
  assert(partials[0].ms<timeline.at(-1).ms);
  const box=await page.locator('.wb-glosspop').boundingBox();
  assert(box.x>=11&&box.x+box.width<=width-11&&box.y>=11&&box.y+box.height<=860-11,'popover inside viewport '+JSON.stringify(box));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert(!overflow,'no horizontal overflow');
  const label=await page.locator('.wb-glosspop small').textContent();assert.equal(label,'AI explanation');
  await page.screenshot({path:`${ev}/stream-final-${width}.png`});
  // 2. Closing mid-stream hides the popover, keeps it closed, and cancels the server run.
  await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(250);assert.equal(await popText(),null,'closed');
  const before=(await(await page.request.get(base+'qa/cancels')).json()).cancels.length;
  await lookUp(v[20]);
  for(let i=0;i<100;i++){const t=await popText();if(t&&t.endsWith(' …'))break;await page.waitForTimeout(30)}
  const midText=await popText();assert(midText&&midText.endsWith(' …'),'mid-stream before close: '+midText);
  const gb=await page.locator('.wb-glosspop').boundingBox();await page.touchscreen.tap(gb.x+gb.width/2,gb.y+gb.height/2);
  await page.waitForTimeout(2500);assert.equal(await popText(),null,'stays closed after stream would have finished');
  const after=(await(await page.request.get(base+'qa/cancels')).json()).cancels.length;
  assert(after>before,'server cancelled the broker run after close ('+before+'→'+after+')');
  // 3. Back closes the popover and keeps the reader open (cached result is instant).
  const tc=Date.now();await lookUp(v[12]);await page.waitForFunction(a=>document.querySelector('.wb-glosspop .wb-gp-en')?.textContent===a,ANSWER);const cachedMs=Date.now()-tc;
  await page.evaluate(()=>history.back());await page.waitForTimeout(400);
  assert.equal(await popText(),null,'Back closed popover');assert(await page.locator('.wb-reader').count(),'reader still open after Back');
  out.push({width,term:v[12].w,first_partial_ms:partials[0].ms,final_ms:timeline.at(-1).ms,partials:partials.length,popover:box,cancelled_on_close:after-before,cached_reopen_ms:cachedMs,back_keeps_reader:true,errors});
  assert.deepEqual(errors,[]);await ctx.close();
 }}finally{await browser.close()}
 fs.writeFileSync(ev+'/browser-lookup.json',JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));
})().catch(e=>{console.error(e);process.exitCode=1});
