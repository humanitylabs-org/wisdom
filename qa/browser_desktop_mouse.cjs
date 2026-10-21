// Thales: desktop reading follows Kindle (James, 19 Oct 2026). With a mouse the reader never swipes: press-and-drag
// over text selects it (Ask AI / Highlight pop appears, page unchanged), a double-click selects a word, a click on
// text never turns the page, and pages turn with the edge arrows, the arrow keys and the wheel (one page per
// gesture). Touch keeps swipe and has no edge arrows. Real HTTP fixture, disposable data, real mouse/touch via CDP.
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
  const checks=[],errors=[],base=info.url;
  const setup=async(ctx,width)=>{
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(width+': '+e.message));
   await page.goto(base);await page.waitForSelector('.wb-home');
   const data=await page.evaluate(async()=>(await fetch('api/wisdom')).json());
   const col=data.collections.find(c=>c.entries.filter(i=>i!==c.overview).length>=3);assert(col,'fixture needs a 3-chapter collection');
   const A=col.entries[1];
   const count=()=>page.evaluate(()=>+document.querySelector('.wb-reader .wb-count').textContent.split(' / ')[0]);
   // Visible words on the current text page, in reading order.
   const visibleWords=()=>page.evaluate(()=>{const st=document.querySelector('.wb-stage').getBoundingClientRect(),out=[];
    const w=document.createTreeWalker(document.querySelector('.wb-flow'),NodeFilter.SHOW_TEXT);let n;
    while((n=w.nextNode())&&out.length<60){const re=/\S+/g;let m;while((m=re.exec(n.data))&&out.length<60){const rg=document.createRange();rg.setStart(n,m.index);rg.setEnd(n,m.index+m[0].length);const b=rg.getBoundingClientRect();if(b.width>0&&b.left>=st.left&&b.right<=st.right&&b.top>st.top+60&&b.bottom<st.bottom-60)out.push({t:m[0],x:b.left+b.width/2,y:b.top+b.height/2,l:b.left,r:b.right})}}return out});
   const open=async()=>{await page.goto('about:blank');await page.goto(base+`#/read/${A}/${col.id}`);await page.waitForSelector(`.wb-reader[data-read="${A}"]`);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await page.waitForTimeout(300);
    // Past the cover and any epigraph slide, onto a page of body text.
    for(let i=0;i<6&&(await visibleWords()).length<12;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(450)}
    assert.equal(await page.evaluate(()=>document.querySelector('.wb-reader').dataset.at),'text')};
   return {page,A,col,count,open,visibleWords};
  };
  for(const width of [1280,720]){
   const ctx=await browser.newContext({viewport:{width,height:820}});
   const {page,count,open,visibleWords}=await setup(ctx,width);
   const writes=[];page.on('request',r=>{if(r.method()==='POST'&&/api\/wisdom\/highlight$/.test(r.url()))writes.push('highlight')});
   await open();
   // Edge arrows are shown, and never sit on top of the text column.
   const turn=await page.evaluate(()=>[...document.querySelectorAll('.wb-turn')].map(b=>{const q=b.getBoundingClientRect(),cs=getComputedStyle(b);return {display:cs.display,vis:cs.visibility,l:q.left,r:q.right}}));
   assert(turn.every(t=>t.display==='flex'&&t.vis==='visible'),'edge arrows visible '+JSON.stringify(turn));
   const W=await visibleWords();assert(W.length>=12,'enough words on the page');
   const minL=Math.min(...W.map(w=>w.l)),maxR=Math.max(...W.map(w=>w.r));
   assert(turn[0].r<=minL&&turn[1].l>=maxR,`arrows clear the text (${turn[0].r}<=${minL}, ${turn[1].l}>=${maxR})`);checks.push(`edge arrows visible and clear of text ${width}`);
   // 1. Press and drag across text selects it; the page does not move.
   const p0=await count(),a=W[2],b=W[9];
   await page.mouse.move(a.x,a.y);await page.mouse.down();for(let i=1;i<=10;i++){await page.mouse.move(a.x+(b.x-a.x)*i/10,a.y+(b.y-a.y)*i/10);await page.waitForTimeout(16)}await page.mouse.up();await page.waitForTimeout(500);
   assert.equal(await count(),p0,'mouse drag did not turn the page');
   const pop=await page.evaluate(()=>{const p=document.querySelector('.wb-hlpop');return {open:!!p&&!p.hidden,ask:!!p?.querySelector('[data-hl-act="ask"]')}});
   assert(pop.open&&pop.ask,'selection pop with Ask AI '+JSON.stringify(pop));
   await page.screenshot({path:path.join(evidence,`drag-select-${width}.png`)});checks.push(`mouse drag selects text with Ask AI, page unchanged ${width}`);
   // Ask AI on the mouse selection opens the passage discussion for it.
   await page.click('.wb-hlpop [data-hl-act="ask"]');await page.waitForSelector('.wd-overlay:not([hidden]) .wd-panel',{timeout:5000});
   await page.screenshot({path:path.join(evidence,`ask-ai-${width}.png`)});checks.push(`Ask AI opens on the mouse selection ${width}`);
   await page.keyboard.press('Escape');await page.waitForTimeout(400);
   // 2. A click on text (left third, right third) never turns the page.
   await open();const p1=await count(),W2=await visibleWords();
   await page.mouse.click(W2[0].x,W2[0].y);await page.waitForTimeout(400);await page.mouse.click(W2[0].x,W2[0].y);await page.waitForTimeout(400);
   const right=W2.reduce((m,w)=>w.r>m.r?w:m);await page.mouse.click(right.x,right.y);await page.waitForTimeout(400);await page.mouse.click(right.x,right.y);await page.waitForTimeout(400);
   assert.equal(await count(),p1,'clicks on text did not turn the page');checks.push(`clicks on text never turn the page ${width}`);
   // 3. Double-click selects a word.
   const dw=W2[W2.length-2];await page.mouse.dblclick(dw.x,dw.y);await page.waitForTimeout(400);
   assert(await page.evaluate(()=>!document.querySelector('.wb-hlpop').hidden),'double-click selects a word');assert.equal(await count(),p1);checks.push(`double-click selects a word ${width}`);
   await page.keyboard.press('Escape');await page.mouse.click(5,400);await page.waitForTimeout(300);
   // 4. Edge arrows, keys, wheel.
   await open();let p=await count();
   await page.click('.wb-turn-next');await page.waitForTimeout(450);assert.equal(await count(),p+1,'next arrow');
   await page.click('.wb-turn-prev');await page.waitForTimeout(450);assert.equal(await count(),p,'prev arrow');checks.push(`edge arrows turn one page each way ${width}`);
   await page.keyboard.press('ArrowRight');await page.waitForTimeout(450);assert.equal(await count(),p+1);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(450);assert.equal(await count(),p);checks.push(`arrow keys turn pages ${width}`);
   const mid=W2[5];await page.mouse.move(mid.x,mid.y);
   for(let i=0;i<8;i++){await page.mouse.wheel(0,40);await page.waitForTimeout(25)}await page.waitForTimeout(500);
   assert.equal(await count(),p+1,'one wheel gesture turns exactly one page');
   await page.mouse.wheel(0,-120);await page.waitForTimeout(500);assert.equal(await count(),p,'wheel up turns back');checks.push(`wheel turns one page per gesture ${width}`);
   assert.deepEqual(errors,[]);
   await ctx.close();
  }
  // Touch is unchanged: no edge arrows, swipe turns the page, drag never selects.
  {
   const ctx=await browser.newContext({viewport:{width:390,height:860},isMobile:true,hasTouch:true});
   const {page,count,open}=await setup(ctx,390);const cdp=await ctx.newCDPSession(page);
   await open();
   assert(await page.evaluate(()=>[...document.querySelectorAll('.wb-turn')].every(b=>getComputedStyle(b).display==='none')),'no edge arrows on touch');
   const p=await count(),x=300,y=400;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-200*i/12,y:y+i*.4}]});await page.waitForTimeout(16)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(600);assert.equal(await count(),p+1,'touch swipe still turns a page');checks.push('touch: swipe still turns a page, no edge arrows 390');
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  const result={status:'pass',host:require('os').hostname(),commit:require('child_process').execSync('git rev-parse HEAD').toString().trim(),checks};
  fs.writeFileSync(path.join(evidence,'desktop-mouse.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
