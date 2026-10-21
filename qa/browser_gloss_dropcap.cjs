// A glossed drop cap (道 opening a section) is selectable by long press, and a tap still translates it.
// Real touch events against disposable HTTP data, never owner writes.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn,execFileSync}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
(async()=>{
 const out=process.env.WISDOM_QA_EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_gloss_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 const exited=new Promise(resolve=>fixture.once('exit',resolve));let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture timeout')),15000);fixture.once('exit',c=>reject(Error('Fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',s=>{clearTimeout(t);resolve(JSON.parse(s))})});
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const results=[];
  for(const width of [360,412,1280]){
   const context=await browser.newContext({viewport:{width,height:915},isMobile:width<600,hasTouch:true,permissions:['clipboard-read','clipboard-write'],colorScheme:'dark'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const state=async()=> (await context.request.get(info.url+'api/wisdom')).json();
   await page.goto(info.url+'#/read/example-chapter');await page.waitForSelector('.wb-reader');await page.waitForTimeout(600);
   const cap='.wb-flow h2+p .wb-gloss';
   for(let i=0;i<25;i++){const b=await page.locator(cap).boundingBox();if(b&&b.x>=0&&b.x+b.width<=width+1)break;await page.keyboard.press('ArrowRight');await page.waitForTimeout(400)}
   // The glossed character really is the drop cap: its glyph box is far taller than a text line.
   const glyph=async()=>page.locator(cap).evaluate(el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const n=w.nextNode(),r=document.createRange();r.setStart(n,0);r.setEnd(n,1);const q=[...r.getClientRects()].find(x=>x.width>0)||r.getBoundingClientRect();const line=parseFloat(getComputedStyle(el.closest('p')).lineHeight);return {x:q.x+q.width/2,y:q.y+q.height/2,h:q.height,line}});
   const g=await glyph();assert(g.h>g.line*1.5,`drop cap expected, got ${g.h}px glyph vs ${g.line}px line`);
   const cdp=await context.newCDPSession(page);
   const touch=async (type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y}]:[]});
   // Long press with a jittering finger (1–2 px), as on a real phone.
   await touch('touchStart',g);for(const d of [1,-1,2,0]){await page.waitForTimeout(120);await touch('touchMove',{x:g.x+d,y:g.y-d})}await page.waitForTimeout(150);await touch('touchEnd');
   await page.waitForSelector('[data-hl-act="highlight"]:visible',{timeout:3000});
   assert.equal(await page.locator('.wb-flow mark.sel').allTextContents().then(x=>x.join('')),'道','Long press on the drop cap selects 道');
   assert.equal((await state()).highlights.length,0,'Long press must only select');
   const capPaint=()=>page.locator('.wb-flow h2+p').first().evaluate(p=>({hl:p.dataset.capHl||'',bg:getComputedStyle(p,'::first-letter').backgroundColor}));
   let cp=await capPaint();assert.equal(cp.hl,'sel');assert.notEqual(cp.bg,'rgba(0, 0, 0, 0)','Selected drop cap is visibly tinted');
   await page.screenshot({path:path.join(out,'gloss-dropcap-selected-'+width+'.png')});
   assert(await page.locator('.wb-glosspop[hidden]').count(),'Long press must not open the translation');
   await page.locator('[data-hl-act="copy"]').click();
   await page.waitForFunction(()=>navigator.clipboard.readText().then(s=>s==='道'));
   // A plain tap still translates the character.
   if(await page.locator('.wb-hlpop:not([hidden])').count()){const s=await page.locator('.wb-stage').boundingBox();await page.mouse.click(s.x+s.width/2,s.y+s.height*.8);await page.waitForSelector('.wb-hlpop[hidden]',{state:'attached'});await page.waitForTimeout(250)}
   const g2=await glyph();await touch('touchStart',g2);await page.waitForTimeout(60);await touch('touchEnd');
   await page.waitForSelector('.wb-glosspop:not([hidden])');assert.match(await page.locator('.wb-glosspop').textContent(),/way/);
   await page.goBack();await page.waitForSelector('.wb-glosspop[hidden]',{state:'attached'});assert.equal(await page.locator('.wb-reader').count(),1);
   // Long press on the drop cap and drag on into the line: saves a passage that starts with 道.
   const end=await page.locator('.wb-flow h2+p').first().evaluate(el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const at=n.nodeValue.indexOf('character');if(at<0)continue;const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+9);const q=r.getBoundingClientRect();return {x:q.x+q.width/2,y:q.y+q.height/2}}});
   const g3=await glyph();await page.mouse.move(g3.x,g3.y);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.move(end.x,end.y,{steps:12});
   const saved=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));await page.mouse.up();assert.equal((await saved).status(),200);
   const h=(await state()).highlights;assert.equal(h.length,1);assert.equal(h[0].text,'道 is a pun. The character');
   cp=await capPaint();assert(['on','1'].includes(cp.hl),'Saved highlight tints the drop cap: '+cp.hl);assert.notEqual(cp.bg,'rgba(0, 0, 0, 0)');
   await page.screenshot({path:path.join(out,'gloss-dropcap-'+width+'.png')});
   assert.deepEqual(errors,[]);
   results.push({width,pass:true,checks:['glossed drop cap renders large','jittery long press selects 道 without saving','copy 道','tap still translates','Back closes translation in place','drag from drop cap saves passage','drop cap tinted when selected and highlighted'],errors});await context.close();
   await (await browser.newContext()).request.post(info.url+'api/wisdom/highlight',{data:{action:'remove',id:h[0].id}});
  }
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const assets=Object.fromEntries(['static/wisdom.js','static/wisdom.css'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
  fs.writeFileSync(path.join(out,'gloss-dropcap-browser.json'),JSON.stringify({host:require('os').hostname(),commit:sha,assets,core_sha256:info.core_sha256,results},null,2));console.log('PASS glossed drop cap selectable at 360, 412, 1280; tap still translates');
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM');await exited}
})().catch(e=>{console.error(e);process.exitCode=1});
