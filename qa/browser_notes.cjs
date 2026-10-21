// Thales-only browser regression for passage Notes: real Wisdom HTTP API, unmodified WizardApp,
// and the shell's real focused-field dictation module (the code path the orb uses to type into a field).
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert');
const FIELD=fs.readFileSync(process.env.WISDOM_QA_FIELD,'utf8');
async function run(width,browser,info,evidence){
 const context=await browser.newContext({viewport:{width,height:800},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const state=()=>page.evaluate(async()=>(await (await fetch('api/wisdom')).json()).highlights);
 const shot=n=>page.screenshot({path:path.join(evidence,`${width}-${n}.png`)});
 await page.goto(info.url+'#/read/jobs-focus');await page.waitForSelector('.wb-reader .wb-flow');await page.waitForTimeout(600);
 const before=(await state()).length;
 // A visible word of at least six letters on the current page.
 const findWord=()=>page.evaluate(()=>{const flow=document.querySelector('.wb-flow'),w=innerWidth,walker=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT);let n;
  while(n=walker.nextNode()){const re=/[A-Za-z]{6,}/g;let m;while(m=re.exec(n.nodeValue)){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);const q=r.getBoundingClientRect();if(q.width&&q.left>20&&q.right<w-20&&q.top>120&&q.bottom<innerHeight-160)return {text:m[0],x:q.x+q.width/2,y:q.y+q.height/2}}}return null});
 // Chapters open on a cover page; turn to the first page of text.
 let word=null;for(let i=0;i<4&&!(word=await findWord());i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(500)}
 if(!word){await shot('0-no-word');throw Error('no visible word')}
 await page.mouse.move(word.x,word.y);await page.mouse.down();await page.waitForTimeout(520);await page.mouse.up();
 await page.waitForSelector('[data-hl-act="note"]:visible');
 assert.deepEqual(await page.locator('.wb-hlpop button:visible').evaluateAll(bs=>bs.map(b=>b.dataset.hlAct)),['highlight','note','copy','lookup','ask'],'selection popup order');
 // Every action fits on a phone-width popup.
 const pop=await page.evaluate(()=>{const p=document.querySelector('.wb-hlpop'),b=p.getBoundingClientRect();return {left:b.left,right:b.right,height:b.height,buttons:[...p.querySelectorAll('button')].filter(x=>!x.hidden).map(x=>x.textContent.trim())}});
 assert(pop.left>=0&&pop.right<=width,`popup overflows at ${width}: ${JSON.stringify(pop)}`);assert(pop.height<60,'popup wrapped: '+pop.height);
 assert(pop.buttons.includes('Note'),pop.buttons);
 await shot('1-popup');
 await page.locator('[data-hl-act="note"]').click();
 await page.waitForSelector('.wb-note #wb-note-text');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'wb-note-text','note field is focused for typing/dictation');
 assert.equal(await page.locator('.wb-note-quote').innerText(),word.text);
 assert(await page.locator('[data-note-save]').isDisabled(),'empty note cannot be saved');
 await page.keyboard.type('Typed thought.');
 // Orb dictation: the shell captures the focused field, transcribes, then inserts at the caret.
 const dictated=await page.evaluate(src=>{(0,eval)(src);const f=WizCore.focusedField.create({document});const seal=f.capture();if(!seal)return 'no-seal';return f.insert(seal,' Dictated by the orb.')?'ok':'refused'},FIELD);
 assert.equal(dictated,'ok');
 assert.equal(await page.locator('#wb-note-text').inputValue(),'Typed thought. Dictated by the orb.');
 assert(!(await page.locator('[data-note-save]').isDisabled()),'dictated text enables Save');
 await shot('2-note-sheet');
 // Back closes the sheet only; the reader stays open on the same chapter. The draft is kept.
 const hash=await page.evaluate(()=>location.hash);
 await page.goBack();await page.waitForSelector('.wb-note',{state:'detached'});
 assert.equal(await page.evaluate(()=>location.hash),hash);assert(await page.locator('.wb-reader').isVisible());
 assert.equal((await state()).length,before,'Back saves nothing');
 await page.waitForTimeout(400);await shot('2b-after-back');
 const again=await findWord();assert(again&&again.text===word.text,'same word still on the page after Back: '+JSON.stringify(again));
 await page.mouse.move(again.x,again.y);await page.mouse.down();await page.waitForTimeout(520);await page.mouse.up();
 await page.waitForSelector('[data-hl-act="note"]:visible');await page.locator('[data-hl-act="note"]').click();
 assert.equal(await page.locator('#wb-note-text').inputValue(),'Typed thought. Dictated by the orb.','draft survived Back');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/wisdom/highlight'));
 await page.locator('[data-note-save]').click();const add=await (await saved).json();
 await page.waitForSelector('.wb-note',{state:'detached'});
 assert.equal(await page.evaluate(()=>location.hash),hash,'Save stays on the chapter');
 let hs=await state();const h=hs.find(x=>x.id===add.id);
 assert.equal(h.note,'Typed thought. Dictated by the orb.');assert.equal(h.text,word.text);assert.equal(hs.length,before+1);
 assert(await page.locator(`mark.wb-hl[data-hl="${add.id}"][data-noted]`).count()>0,'noted highlight is marked');
 await shot('3-saved');
 // Reopen from the highlight itself and edit.
 const mark=page.locator(`mark.wb-hl[data-hl="${add.id}"]`).first();await mark.click();
 await page.waitForSelector('[data-hl-act="note"].has:visible');
 assert.deepEqual(await page.locator('.wb-hlpop button:visible').evaluateAll(bs=>bs.map(b=>b.dataset.hlAct)),['note','copy','lookup','ask','remove'],'saved popup order');
 assert.equal(await page.locator('[data-hl-act="note"]').getAttribute('aria-label'),'Edit note');
 // Remove asks again when a note would be lost.
 await page.locator('[data-hl-act="remove"]').click();
 assert.equal(await page.locator('[data-hl-act="remove"]').innerText(),'Remove highlight and note?');
 const pop2=await page.evaluate(()=>{const p=document.querySelector('.wb-hlpop');return {left:p.offsetLeft,w:p.offsetWidth,h:p.offsetHeight,sw:p.scrollWidth,cw:p.clientWidth}});
 assert(pop2.h<60&&pop2.sw<=pop2.cw&&pop2.left+pop2.w<=width,'saved popup fits: '+JSON.stringify(pop2));await shot('3b-confirm');assert.equal((await state()).length,before+1);
 await page.locator('[data-hl-act="note"]').click();await page.waitForSelector('.wb-note #wb-note-text');
 await page.locator('#wb-note-text').fill('Edited note.');await page.locator('[data-note-save]').click();
 await page.waitForSelector('.wb-note',{state:'detached'});
 assert.equal((await state()).find(x=>x.id===add.id).note,'Edited note.');
 // Highlights page shows and edits the note; Back from its sheet stays on Highlights.
 // System Back from the chapter after using notes still steps to its collection, never out of the app.
 await page.goBack();await page.waitForFunction(()=>location.hash.startsWith('#/collection/'));assert(!(await page.locator('.wb-reader').count()));
 // (Typed hash changes count as Back under the shared client's guard, so load Highlights as a fresh page.)
 await page.goto('about:blank');await page.goto(info.url+'#/highlights');await page.waitForSelector('.wb-hl-page');
 assert.equal(await page.locator(`[data-highlight-id="${add.id}"] .wb-hl-note`).innerText(),'Edited note.');
 await shot('4-highlights');
 await page.locator(`[data-wisdom-note="${add.id}"]`).click();await page.waitForSelector('.wb-note #wb-note-text');
 await page.goBack();await page.waitForSelector('.wb-note',{state:'detached'});assert.equal(await page.evaluate(()=>location.hash),'#/highlights');
 await page.locator(`[data-wisdom-note="${add.id}"]`).click();await page.waitForSelector('[data-note-delete]');
 await page.locator('[data-note-delete]').click();await page.waitForSelector('.wb-note',{state:'detached'});
 await page.waitForFunction(id=>!document.querySelector(`[data-highlight-id="${id}"] .wb-hl-note`),add.id);
 hs=await state();assert.equal(hs.find(x=>x.id===add.id).note,'');assert.equal(hs.length,before+1,'deleting the note keeps the highlight');
 assert.equal(await page.locator(`[data-wisdom-note="${add.id}"] span`).innerText(),'Note');
 // Reload proves durability.
 await page.reload();await page.waitForSelector('.wb-hl-page');assert.equal(await page.locator(`[data-highlight-id="${add.id}"]`).count(),1);
 assert.deepEqual(errors,[]);await context.close();
 return {width,word:word.text,popup:pop,highlight:add.id};
}
(async()=>{
 const evidence=process.env.WISDOM_QA_EVIDENCE;assert(evidence);fs.mkdirSync(evidence,{recursive:true});
 const results=[];
 for(const width of [360,390]){
  const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
  const exited=new Promise(r=>fixture.once('exit',r));let browser;
  try{
   const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture timeout')),20000);fixture.once('exit',c=>reject(Error('Fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',l=>{clearTimeout(t);resolve(JSON.parse(l))})});
   browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
   results.push({...await run(width,browser,info,evidence),core_sha256:info.core_sha256});
  }finally{if(browser)await browser.close();fixture.kill('SIGTERM');await exited}
 }
 const checks=['Note fits the phone popup','field focused on open','typing + shell focused-field dictation insert','Back closes sheet, stays on chapter, keeps draft, saves nothing','selection + note saved in one write','noted mark painted','Edit note from the highlight','Remove asks again when a note exists','Highlights page shows/edits note; Back stays','Delete note keeps highlight','durable after reload','no page errors'];
 fs.writeFileSync(path.join(evidence,'notes.json'),JSON.stringify({checks,results},null,2));
 console.log('PASS: '+checks.length+' note checks at '+results.map(r=>r.width).join(' and ')+'px');
})().catch(e=>{console.error(e);process.exitCode=1});
