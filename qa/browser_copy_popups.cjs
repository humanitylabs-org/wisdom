'use strict';
// Pop-up text (Look up / translation) is selectable and copyable, against qa/browser_lookup_fixture.py.
// PLAYWRIGHT_DIR=… FIXTURE_URL=… EVIDENCE=… node qa/browser_copy_popups.cjs
const {chromium,devices}=require(process.env.PLAYWRIGHT_DIR),fs=require('fs'),assert=require('assert');
const base=process.env.FIXTURE_URL,ev=process.env.EVIDENCE;assert(base&&ev,'FIXTURE_URL and EVIDENCE required');
const ANSWER='Here the word names the specific idea the passage is discussing, read in its own context. It points at what the author means in this sentence.';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.CHANNEL||undefined});const out=[];
 try{for(const width of [360,412]){
  const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width,height:860}});
  await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(base).origin});
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
  const open=()=>page.evaluate(()=>{const p=document.querySelector('.wb-glosspop');return !!(p&&!p.hidden)});
  await lookUp(v[12]);await page.waitForFunction(a=>document.querySelector('.wb-glosspop .wb-gp-en')?.textContent===a,ANSWER,{timeout:10000});
  // 1. The pop-up text is a reading surface: selectable, with the native long-press callout.
  const css=await page.evaluate(()=>{const s=getComputedStyle(document.querySelector('.wb-glosspop .wb-gp-en'));return {userSelect:s.userSelect||s.webkitUserSelect,webkitUserSelect:s.webkitUserSelect,callout:s.webkitTouchCallout??null}});
  assert.equal(css.userSelect,'text','pop-up text user-select '+JSON.stringify(css));
  // 2. The native long-press menu is allowed in the pop-up; the page keeps its own selection menu.
  const menu=await page.evaluate(()=>{const fire=el=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented};
   return {popup:fire(document.querySelector('.wb-glosspop .wb-gp-en')),page:fire(document.querySelector('.wb-flow p'))}});
  assert.equal(menu.popup,false,'pop-up long-press menu not suppressed');assert.equal(menu.page,true,'page keeps its own long-press selection');
  // 3. A native selection in the pop-up survives a tap inside it (dismissing handles never closes the pop-up).
  await page.evaluate(()=>{const t=document.querySelector('.wb-glosspop .wb-gp-en').firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,24);getSelection().removeAllRanges();getSelection().addRange(r)});
  const gb=await page.locator('.wb-glosspop').boundingBox();
  await page.touchscreen.tap(gb.x+gb.width/2,gb.y+gb.height-8);await page.waitForTimeout(250);
  assert.equal(await open(),true,'pop-up stays open while text is selected in it');
  // 4. Without a selection, a tap still closes it (existing contract).
  await page.evaluate(()=>getSelection().removeAllRanges());
  await page.touchscreen.tap(gb.x+gb.width/2,gb.y+gb.height-8);await page.waitForTimeout(250);
  assert.equal(await open(),false,'plain tap closes pop-up');
  // 5. Real pointer drag selects pop-up text and Copy puts it on the clipboard.
  await lookUp(v[12]);await page.waitForFunction(a=>document.querySelector('.wb-glosspop .wb-gp-en')?.textContent===a,ANSWER);
  const span=await page.evaluate(()=>{const t=document.querySelector('.wb-glosspop .wb-gp-en').firstChild,r=document.createRange(),q=(i,j)=>{r.setStart(t,i);r.setEnd(t,j);return r.getBoundingClientRect()};const a=q(0,1),b=q(15,16);return {x1:a.left+1,y1:a.top+a.height/2,x2:b.right-1,y2:b.top+b.height/2}});
  await page.mouse.move(span.x1,span.y1);await page.mouse.down();await page.mouse.move(span.x2,span.y2,{steps:8});await page.mouse.up();await page.waitForTimeout(200);
  const sel=await page.evaluate(()=>getSelection().toString());
  assert(sel.length>=10&&ANSWER.startsWith(sel),'drag selected pop-up text: '+JSON.stringify(sel));
  assert.equal(await open(),true,'pop-up stays open after drag-select');
  await page.evaluate(()=>document.execCommand('copy'));
  const clip=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(clip,sel,'clipboard holds the selected pop-up text');
  await page.screenshot({path:`${ev}/copy-popup-${width}.png`});
  // 6. Back closes the pop-up, clears its selection and keeps the reader open.
  await page.evaluate(()=>history.back());await page.waitForTimeout(400);
  assert.equal(await open(),false,'Back closed pop-up');assert.equal(await page.evaluate(()=>getSelection().toString()),'','selection cleared');
  assert(await page.locator('.wb-reader').count(),'reader still open after Back');
  out.push({width,css,menu,selected:sel,clipboard:clip,errors});
  assert.deepEqual(errors,[]);await ctx.close();
 }}finally{await browser.close()}
 fs.writeFileSync(ev+'/browser-copy-popups.json',JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));
})().catch(e=>{console.error(e);process.exitCode=1});
