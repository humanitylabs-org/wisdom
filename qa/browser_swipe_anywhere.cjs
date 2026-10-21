// Thales: a page swipe registers anywhere on the reader, including when the finger starts on a control
// (Discuss with AI, the Next chapter card, Keep reading, a rating button). The swipe turns the page and the
// control does not fire; a plain tap (with small finger jitter) still fires the control.
// Real HTTP fixture + shared WizardApp core, disposable data, real touch input via CDP. James, 19 Oct 2026.
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
  const checks=[],errors=[];
  for(const width of [390,360]){
   const ctx=await browser.newContext({viewport:{width,height:860},isMobile:true,hasTouch:true});
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(width+': '+e.message));
   const cdp=await ctx.newCDPSession(page);
   // Control side effects only: opening a discussion or rating. Reading progress writes are expected.
   const writes=[];page.on('request',r=>{if(r.method()!=='POST')return;if(/api\/discussions$/.test(r.url()))writes.push('discussion');else if(/api\/wisdom\/reaction$/.test(r.url())&&r.postDataJSON()?.field==='rating')writes.push('rating')});
   const base=info.url;
   await page.goto(base);await page.waitForSelector('.wb-home');
   const data=await page.evaluate(async()=>(await fetch('api/wisdom')).json());
   const col=data.collections.find(c=>c.entries.filter(i=>i!==c.overview).length>=3);assert(col,'fixture needs a 3-chapter collection');
   const [A,B]=[col.entries[1],col.entries[2]];
   const state=()=>page.evaluate(()=>{const r=document.querySelector('.wb-reader');return {id:r?.dataset.read,at:r?.dataset.at,count:r?.querySelector('.wb-count')?.textContent,overlay:!!document.querySelector('.wd-overlay:not([hidden]) .wd-panel')}});
   const ready=async id=>{await page.waitForSelector(`.wb-reader[data-read="${id}"]`);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await page.waitForTimeout(300)};
   const openEnd=async()=>{await page.goto('about:blank');await page.goto(base+`#/read/${A}/${col.id}`);await ready(A);
    // Earlier checks share the fixture's saved progress; start B on its cover each time.
    await page.evaluate(B=>localStorage.setItem('wisdom:'+new URL('.',location.href).pathname+':pos:'+B,'0'),B);
    for(let i=0;i<80&&(await state()).at!=='end';i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(60)}
    assert.equal((await state()).at,'end');await page.waitForTimeout(450);writes.length=0};
   // A real finger: touchStart on the control, ~12 moves, touchEnd.
   const swipe=async(sel,dir,where=.5)=>{const b=await page.locator(sel).first().boundingBox();assert(b,sel+' visible');const x=b.x+b.width*where,y=b.y+b.height/2,dist=dir*Math.min(200,width*.5);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dist*i/12,y:y+i*.4}]});await page.waitForTimeout(16)}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})};
   // Only ratings promise a 20px roll: Chrome drops ordinary control clicks above ~15px.
   const jitterTap=async(sel,travel=20)=>{const b=await page.locator(sel).first().boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-travel/2,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+travel*.15,y:y+2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+travel/2,y:y+3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})};
   const landsOnB=async how=>{await page.waitForFunction(id=>document.querySelector('.wb-reader')?.dataset.read===id,B,{timeout:5000}).catch(()=>{});await page.waitForTimeout(500);const s=await state();assert.equal(s.id,B,how+': next chapter opened '+JSON.stringify(s));assert.equal(s.at,'opener',how+' '+s.count);assert.equal(s.overlay,false,how+': no discussion sheet');assert.deepEqual(writes,[],how+': no owner writes');checks.push(`${how} → next chapter ${width}`)};

   // 1. Swipe left starting on Discuss with AI (the reported case).
   await openEnd();await page.screenshot({path:path.join(evidence,`end-${width}.png`)});
   await swipe('.wb-end .wb-discuss',-1);await landsOnB('swipe left from Discuss with AI');
   // 2. Swipe left starting on the Next chapter card's title.
   await openEnd();await swipe('.wb-end .wb-next strong',-1,.4);await landsOnB('swipe left from Next card');
   // 3. Swipe left starting on Keep reading.
   await openEnd();await swipe('.wb-end .wb-next .wb-primary',-1);await landsOnB('swipe left from Keep reading');
   // 4. Swipe right starting on the thumbs-up turns back one page and does not rate.
   await openEnd();const before=await state();await swipe('[data-wisdom-rate][data-value="1"]',1);await page.waitForTimeout(600);
   {const s=await state();assert.equal(s.id,A);assert.notEqual(s.at,'end','swipe right went back a page');const [p]=s.count.split(' / '),[p0]=before.count.split(' / ');assert.equal(+p,+p0-1,`one page back (${before.count} → ${s.count})`);assert.deepEqual(writes,[],'swipe did not rate');checks.push('swipe right from rating button → previous page, no rating '+width)}
   // 5. Taps (with finger jitter) still work: Discuss with AI opens its sheet, rating saves.
   await openEnd();await jitterTap('.wb-end .wb-discuss',10);await page.waitForSelector('.wd-overlay:not([hidden]) .wd-panel',{timeout:5000});assert.equal((await state()).id,A);assert((await state()).at==='end');checks.push('jittery tap on Discuss with AI still opens it '+width);
   await page.keyboard.press('Escape');await page.waitForTimeout(400);
   await openEnd();await jitterTap('[data-wisdom-rate][data-value="1"]');await page.waitForTimeout(1200);assert(writes.includes('rating'),'tap rated');assert.equal((await state()).at,'end');checks.push('jittery tap on rating still rates '+width);
   // 6. Plain tap on the Next card still opens the next chapter.
   await openEnd();await page.locator('.wb-end .wb-next strong').tap();await page.waitForFunction(id=>document.querySelector('.wb-reader')?.dataset.read===id,B,{timeout:5000});checks.push('tap on Next card opens next chapter '+width);
   // 6b. A diagonal thumb swipe (~40°, up and left, eased like a real finger) from each control turns the page,
   // exactly as it does from plain text (James, 19 Oct).
   for(const [sel,label] of [['.wb-end .wb-discuss','Discuss with AI'],['.wb-end .wb-next strong','Next card title'],['.wb-end .wb-next .wb-next-copy small','Next card art']]){
    await openEnd();const b=await page.locator(sel).first().boundingBox(),x=b.x+b.width*.6,y=b.y+b.height/2,DX=-Math.min(160,width*.42),DY=DX*.84;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=12;i++){const t=i/12,e=t*t*(3-2*t);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+DX*e,y:y+DY*e}]});await page.waitForTimeout(16)}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await landsOnB('40° thumb swipe from '+label)}
   // 7. Mid-chapter swipe on plain text is unchanged.
   await page.goto('about:blank');await page.goto(base+`#/read/${A}/${col.id}`);await ready(A);await page.keyboard.press('ArrowRight');await page.waitForTimeout(450);
   {const s0=await state();await swipe('.wb-stage',-1,.7);await page.waitForTimeout(600);const s=await state();assert.equal(+s.count.split(' / ')[0],+s0.count.split(' / ')[0]+1,'text swipe turns one page');checks.push('swipe on chapter text still turns one page '+width)}
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  const result={status:'pass',host:require('os').hostname(),commit:require('child_process').execSync('git rev-parse HEAD').toString().trim(),checks};
  fs.writeFileSync(path.join(evidence,'swipe-anywhere.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
