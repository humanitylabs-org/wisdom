// Thales-only browser regression: real Wisdom HTTP API and unmodified WizardApp.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const evidence=process.env.WISDOM_QA_EVIDENCE;assert(evidence);fs.mkdirSync(evidence,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_history_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 const exited=new Promise(resolve=>fixture.once('exit',resolve));let browser,release;
 try{
  const info=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Fixture timeout')),15000);fixture.once('exit',code=>reject(Error('Fixture exit '+code)));createInterface({input:fixture.stdout}).once('line',line=>{clearTimeout(timeout);resolve(JSON.parse(line))})});
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:1,permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=()=>page.evaluate(async()=> (await fetch('api/wisdom')).json());
  const highlights=async()=>{await page.evaluate(()=>location.hash='#/highlights');await page.waitForSelector('.wb-hl-page')};
  await page.goto(info.url+'#/highlights');await page.waitForSelector('.wb-hl-page');
  assert.equal(await page.evaluate(()=>WizardApp.version),1);
  const original=(await state()).highlights;assert.equal(original.length,4);
  assert.equal(await page.locator('.wb-hl-item figcaption').count(),4);
  for(const h of original){const item=page.locator(`[data-highlight-id="${h.id}"]`);assert((await item.innerText()).includes('Earlier edition'));assert.equal(await item.locator('blockquote').innerText(),h.text);assert.equal(await item.locator('a').count(),0)}
  await page.locator(`[data-wisdom-copy="${info.ids[0]}"]`).click();
  await page.waitForFunction(text=>navigator.clipboard.readText().then(s=>s===text),original.find(h=>h.id===info.ids[0]).text);
  await page.screenshot({path:path.join(evidence,'earlier-edition.png'),fullPage:true});
  await page.locator('.wb-hl-src').click();await page.waitForSelector('.wb-reader');
  await page.waitForTimeout(450); // Let reader font measurement/layout settle.
  assert.equal(await page.locator('mark.wb-hl').count(),0);
  assert.equal(await page.locator('.wb-handle:not([hidden])').count(),0);
  // Select a real word whose current coordinates overlap an unresolved old range.
  const wordPoint=()=>page.evaluate(()=>{const flow=document.querySelector('.wb-flow'),walker=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT);let n,pos=0;while(n=walker.nextNode()){const at=n.nodeValue.indexOf('Quiet');if(at>=0){const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+5);const q=r.getBoundingClientRect();return {s:pos+at,e:pos+at+5,x:q.x+q.width/2,y:q.y+q.height/2}}pos+=n.nodeValue.length}throw Error('No synthetic word')});
  const showWord=async()=>{for(let i=0;i<12;i++){const w=await wordPoint();if(w.x>0&&w.x<412)return w;await page.keyboard.press(w.x<0?'ArrowLeft':'ArrowRight');await page.waitForTimeout(450)}throw Error('Word never reached viewport')};
  let word=await showWord();
  assert(original.some(h=>h.start<word.e&&h.end>word.s));
  await page.mouse.click(word.x,word.y);
  assert.equal(await page.locator('.wb-hlpop:not([hidden])').count(),0);
  assert.equal(await page.locator('.wb-handle:not([hidden])').count(),0);
  await page.waitForTimeout(450);word=await showWord(); // A normal edge tap may turn the page.
  // Observe optimistic UI while delaying transport, without replacing any response.
  let sent,hit;const requested=new Promise(r=>hit=r),gate=new Promise(r=>release=r);
  await page.route('**/api/wisdom/highlight',async route=>{const payload=route.request().postDataJSON();if(payload.action==='add'&&!sent){sent=payload;hit();await gate}await route.continue()});
  await page.mouse.move(word.x,word.y);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.up();
  await page.waitForSelector('[data-hl-act="highlight"]:visible');
  await page.locator('[data-hl-act="highlight"]').click();await requested;
  assert.equal(sent.start,word.s);assert.equal(sent.end,word.e);assert.equal(sent.text,'Quiet');
  await highlights();assert.equal(await page.locator('.wb-hl-item').count(),5);assert.equal(await page.locator('.wb-hl-item figcaption').count(),4);
  for(const h of original)assert.equal(await page.locator(`[data-highlight-id="${h.id}"] blockquote`).innerText(),h.text);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight')&&r.request().postDataJSON().action==='add');release();
  const saved=await (await response).json();assert.equal(saved.merged,0);assert.equal(saved.highlights.length,5);
  await page.reload();await page.waitForSelector('.wb-hl-page');
  assert.deepEqual((await state()).highlights.filter(h=>h.anchor_status==='unresolved'),original);
  await page.locator('.wb-hl-src').click();await page.waitForSelector('.wb-reader');
  if(await page.locator('mark.wb-hl').count()===0)throw Error('Current highlight not painted');
  for(const id of info.ids)assert.equal(await page.locator(`mark[data-hl="${id}"]`).count(),0);
  await page.waitForTimeout(450);await showWord();
  await page.locator(`mark[data-hl="${saved.id}"]`).first().click();
  assert.equal(await page.locator('.wb-handle:not([hidden])').count(),2);
  await page.screenshot({path:path.join(evidence,'current-anchor-only.png'),fullPage:true});
  await highlights();
  await page.locator(`[data-wisdom-remove-highlight="${info.ids[0]}"]`).click();
  await page.waitForFunction(id=>!document.querySelector(`[data-highlight-id="${id}"]`),info.ids[0]);
  await page.reload();await page.waitForSelector('.wb-hl-page');
  const final=(await state()).highlights;
  assert.equal(final.length,4);assert.equal(final.filter(h=>h.anchor_status==='unresolved').length,3);
  assert(!final.some(h=>h.id===info.ids[0]));assert(final.some(h=>h.id===saved.id));
  assert.deepEqual(errors,[]);
  fixture.kill('SIGTERM');await exited;
  const db=JSON.parse(fs.readFileSync(path.join(evidence,'history-db.json')));
  assert.deepEqual(db.after,db.before.filter(h=>h.seq!==info.ids[0]));
  assert.equal(db.highlights.length,4);
  const checks=['4 earlier-edition quotes labelled and exact','copy original quote','no stale anchor links','no invalid marks/activation/handles','frontend overlapping selection stays exact','optimistic state retains all historical quotes','backend overlap preserves all history','current anchor paints and activates','explicit Remove persists','only explicitly deleted history removed'];
  fs.writeFileSync(path.join(evidence,'browser.json'),JSON.stringify({...info,checks,errors,initial_history:4,final_history:3,final_highlights:4,sent},null,2));
  console.log('PASS: '+checks.length+' history checks; real shared core '+info.core_sha256);
 }finally{release?.();if(browser)await browser.close();fixture.kill('SIGTERM');await exited}
})().catch(e=>{console.error(e);process.exitCode=1});
