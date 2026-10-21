// Thales: actual app HTTP fixture + actual shared WizardApp, disposable storage.
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
  const checks=[];
  for(const viewport of [{width:412,height:915},{width:1280,height:900}]){
   const ctx=await browser.newContext({viewport,isMobile:viewport.width<500,hasTouch:true});
   let page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const base=info.url,route='#/read/example-chapter/example-collection';
   const ready=async()=>{await page.waitForSelector('.wb-reader');await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);};
   await page.goto('about:blank');await page.goto(base+'#/collection/example-collection');await page.waitForSelector('.wb-collection');
   await page.locator('[data-wisdom-route="/read/example-chapter/example-collection"]').first().click();await ready();
   await page.keyboard.press('ArrowRight');
   const before=await page.locator('.wb-count').innerText();assert(!before.startsWith('1 /'));
   await page.reload();await ready();assert.equal(await page.locator('.wb-count').innerText(),before);checks.push('document reload retains chapter and page '+viewport.width);
   await page.goto('about:blank');await page.goto(base);await ready();assert.equal(new URL(page.url()).hash,route);assert.equal(await page.locator('.wb-count').innerText(),before);checks.push('base URL frame recreation retains chapter/collection/page '+viewport.width);
   const saved=await ctx.storageState();await ctx.close();
   const next=await browser.newContext({viewport,storageState:saved});page=await next.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('about:blank');await page.goto(base);await page.waitForSelector('.wb-home .wb-continue');assert.equal(await page.locator('.wb-continue .wb-hero').getAttribute('data-wisdom-route'),'/read/example-chapter/example-collection');
   await page.locator('.wb-continue .wb-hero').click();await ready();assert.equal(await page.locator('.wb-count').innerText(),before);checks.push('fresh launch opens Home; Continue reading resumes the chapter and page '+viewport.width);
   // Real browser Back through the shared standalone guard, never an app exit.
   await page.locator('.wb-top-title').click();await page.goBack();await page.waitForSelector('.wb-home');assert(page.url().startsWith(base));checks.push('Back from Continue reading returns Home '+viewport.width);
   await page.goto('about:blank');await page.goto(base+'#/collection/example-collection');await page.waitForSelector('.wb-collection');
   await page.goto('about:blank');await page.goto(base);await page.waitForSelector('.wb-collection');checks.push('frame recreation restores open collection '+viewport.width);
   await page.evaluate(()=>Wisdom.back());await page.waitForSelector('.wb-home');
   await page.goto('about:blank');await page.goto(base);await page.waitForSelector('.wb-home');assert.equal(await page.evaluate(()=>localStorage.getItem('wisdom:/:open')),null);checks.push('deliberate Home clears resume '+viewport.width);
   await page.goto('about:blank');await page.goto(base+route);await ready();
   await page.goto('about:blank');await page.goto(base+'#/collection/example-collection');await page.waitForSelector('.wb-collection');assert.equal(new URL(page.url()).hash,'#/collection/example-collection');
   await page.goto('about:blank');await page.goto(base+'#/');await page.waitForSelector('.wb-home');checks.push('explicit deep link and Home win '+viewport.width);
   await page.evaluate(()=>localStorage.setItem('wisdom:/:open','#/read/missing/missing'));await page.goto('about:blank');await page.goto(base);await page.waitForSelector('.wb-home');assert.equal(await page.evaluate(()=>localStorage.getItem('wisdom:/:open')),null);checks.push('removed book safely falls back '+viewport.width);
   await page.evaluate(()=>localStorage.setItem('wisdom:/:open','https://example.com'));await page.goto('about:blank');await page.goto(base);await page.waitForSelector('.wb-home');assert(page.url().startsWith(base));checks.push('malformed checkpoint ignored '+viewport.width);
   await page.goto('about:blank');await page.goto(base+route);await ready();
   await page.evaluate(async()=>{const r=await fetch('api/wisdom/reaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'entry',id:'example-chapter',field:'done',value:true})});if(!r.ok)throw Error('Completion failed');const d=await (await fetch('api/wisdom')).json();if(!d.entries.find(e=>e.id==='example-chapter')?.read)throw Error('Chapter not completed');localStorage.setItem('wisdom:/:pos:example-chapter','0.5')});
   await page.goto('about:blank');await page.goto(base);await ready();assert(!((await page.locator('.wb-count').innerText()).startsWith('1 /')));checks.push('rereading a completed chapter retains position '+viewport.width);
   await page.evaluate(()=>localStorage.setItem('wisdom:/:pos:example-chapter','1'));await page.reload();await ready();assert.equal(await page.locator('.wb-reader').getAttribute('data-at'),'end');checks.push('last page survives reload '+viewport.width);
   assert.deepEqual(errors,[]);await page.screenshot({path:path.join(evidence,'resume-'+viewport.width+'.png')});await next.close();
  }
  const blocked=await browser.newContext();await blocked.addInitScript(()=>{Storage.prototype.getItem=Storage.prototype.setItem=Storage.prototype.removeItem=()=>{throw Error('storage denied')}});const p=await blocked.newPage();await p.goto(info.url+'#/collection/example-collection');await p.waitForSelector('.wb-collection');checks.push('blocked storage does not break navigation');await blocked.close();
  fs.writeFileSync(path.join(evidence,'resume.json'),JSON.stringify({host:require('os').hostname(),...info,checks},null,2));console.log(JSON.stringify({status:'pass',checks}));
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
