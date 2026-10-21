// Run on Thales: real app + shared client, disposable data; no owner mutations.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),assert=require('assert');
(async()=>{
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),15000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',l=>{clearTimeout(t);resolve(JSON.parse(l))})});
  browser=await chromium.launch({headless:true,channel:'chrome'});const checks=[];
  for(const width of [360,412]){
   const ctx=await browser.newContext({viewport:{width,height:915},isMobile:true,hasTouch:true});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   const base=info.url,id='example-chapter';
   await p.goto(base);await p.waitForSelector('.wb-home');
   await p.evaluate(()=>localStorage.setItem('wisdom:/:pos:example-chapter','1'));
   await p.evaluate(id=>Wisdom.navigate('/read/'+id+'/example-collection'),id);await p.waitForSelector('.wb-reader');await p.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await p.waitForTimeout(650);
   for(let i=0;i<20&&await p.locator('.wb-reader').getAttribute('data-at')!=='end';i++)await p.keyboard.press('ArrowRight');
   await p.waitForSelector('.wb-reader[data-at="end"]');await p.waitForTimeout(650);
   // Normalize only disposable fixture state, then reload its real saved response.
   await p.evaluate(async id=>{await fetch('api/wisdom/reaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'entry',id,field:'rating',value:0})})},id);await p.reload();await p.waitForSelector('.wb-reader[data-at="end"]');await p.waitForTimeout(600);
   let fail=false,requests=[],active=0,maxActive=0;
   await p.route('**/api/wisdom/reaction',async r=>{const d=r.request().postDataJSON();if(d.field!=='rating')return r.continue();requests.push(d.value);active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,900));if(fail){fail=false;active--;return r.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture failure"}'})}const response=await r.fetch();active--;return r.fulfill({response})});
   const up=p.locator('[data-wisdom-rate][data-value="1"]'),down=p.locator('[data-wisdom-rate][data-value="-1"]');
   await p.evaluate(()=>window.originalReader=document.querySelector('.wb-reader'));
   const t=Date.now();await up.tap();assert.equal(await up.getAttribute('aria-pressed'),'true');assert(Date.now()-t<700);assert.equal(await up.isDisabled(),false);checks.push('immediate single touch before delayed save '+width);
   await down.tap();assert.equal(await down.getAttribute('aria-pressed'),'true');await p.waitForTimeout(2300);assert.equal(maxActive,1);assert.deepEqual(requests,[1,-1]);
   const saved=()=>p.evaluate(async id=>(await(await fetch('api/wisdom')).json()).entries.find(e=>e.id===id).rating,id);
   assert.equal(await saved(),-1);assert(await p.evaluate(()=>window.originalReader===document.querySelector('.wb-reader')));checks.push('latest intent serialized, persisted, no reader replacement '+width);
   // A small finger movement must stay a button tap rather than capture a page swipe.
   const box=await up.boundingBox(),cdp=await ctx.newCDPSession(p),x=box.x+box.width/2,y=box.y+box.height/2;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-10,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+3,y:y+2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+10,y:y+3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.equal(await up.getAttribute('aria-pressed'),'true');await p.waitForTimeout(1200);assert.equal(await saved(),1);checks.push('20px thumb roll does not steal rating tap '+width);
   fail=true;await down.tap();assert.equal(await down.getAttribute('aria-pressed'),'true');await p.waitForTimeout(1200);assert.equal(await up.getAttribute('aria-pressed'),'true');assert.equal(await saved(),1);checks.push('failed save restores confirmed rating '+width);
   await down.tap();await p.waitForTimeout(1200);assert.equal(await saved(),-1);await p.reload();await p.waitForSelector('.wb-reader[data-at="end"]');assert.equal(await down.getAttribute('aria-pressed'),'true');checks.push('retry and reload retain persisted rating '+width);
   assert.deepEqual(errors,[]);await ctx.close();
  }
  const result={status:'pass',host:require('os').hostname(),checks};fs.writeFileSync(process.env.WISDOM_QA_EVIDENCE+'/ratings.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
