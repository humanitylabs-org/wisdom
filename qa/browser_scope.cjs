// Thales only: actual shared core + isolated synthetic HTTP fixture, no facade stubs.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process');
const {createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
(async()=>{
 const evidence=process.env.WISDOM_QA_EVIDENCE;assert(evidence);fs.mkdirSync(evidence,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Fixture did not start')),15000);fixture.once('exit',code=>reject(Error('Fixture exited '+code)));createInterface({input:fixture.stdout}).once('line',line=>{clearTimeout(timeout);resolve(JSON.parse(line))})});
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:1,acceptDownloads:true});
  const page=await context.newPage(),errors=[],downloads=[];page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
  await page.goto(info.url);await page.waitForSelector('.wb-hero');
  assert.equal(await page.evaluate(()=>WizardApp.version),1);assert.equal(await page.evaluate(()=>WizardApp.hosted),false);
  assert.equal(await page.locator('a[data-wisdom-route="/shelf/shared"]').count(),1);
  assert.equal(await page.locator('a[data-wisdom-route="/shelf/private"]').count(),1);
  await page.screenshot({path:path.join(evidence,'home.png'),fullPage:true});
  await page.locator('a[data-wisdom-route="/shelf/shared"]').click();await page.waitForSelector('.wb-all-grid');
  assert.equal(await page.locator('.wb-all-grid .wb-cover').count(),4);
  assert.equal(await page.locator('.wb-all-grid [data-wisdom-route="/collection/example-collection"]').count(),0);
  await page.screenshot({path:path.join(evidence,'shared-shelf.png'),fullPage:true});
  await page.locator('[data-wisdom-back]').click();await page.waitForSelector('.wb-home');
  await page.locator('a[data-wisdom-route="/shelf/private"]').click();await page.waitForSelector('.wb-all-grid');
  assert.equal(await page.locator('.wb-all-grid .wb-cover').count(),2);
  assert.equal(await page.locator('.wb-all-grid [data-wisdom-route="/collection/steve-jobs"]').count(),0);
  await page.locator('.wb-all-grid [data-wisdom-route="/collection/example-collection"]').click();await page.waitForSelector('.wb-collection');
  await page.locator('[data-export-collection]').click();await page.waitForSelector('[data-confirm-export]');
  assert((await page.locator('.wm-sheet').innerText()).includes('No upload or publication'));
  assert(!(await page.locator('.wm-sheet').innerText()).includes('Other private chapter'));
  await page.screenshot({path:path.join(evidence,'export-preview.png'),fullPage:true});
  await page.goBack();await page.waitForFunction(()=>!document.querySelector('.wb-sheet'));
  assert.equal(await page.evaluate(()=>document.getElementById('app').inert),false);assert.equal(downloads.length,0);
  assert(page.url().includes('#/collection/example-collection'));
  await page.locator('[data-export-collection]').click();await page.waitForSelector('[data-confirm-export]');
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-confirm-export]').click()]);
  assert.equal(download.suggestedFilename(),'example-collection.zip');
  await download.saveAs(path.join(evidence,'selected-export.zip'));
  await page.waitForFunction(()=>!document.querySelector('.wb-sheet'));
  const state=await page.evaluate(async()=> (await fetch('api/wisdom')).json());
  assert.equal(state.collections.find(c=>c.id==='example-collection').library_scope,'private');
  await page.locator('a[data-wisdom-route="/read/example-chapter/example-collection"]').first().click();await page.waitForSelector('.wb-reader');
  await page.goBack();await page.waitForSelector('.wb-collection');assert(page.url().startsWith(info.url));
  await page.goBack();await page.waitForSelector('.wb-all-grid');assert(page.url().includes('#/shelf/private'));
  // Root route navigation first, then exactly one browser Back must stay in-app.
  const root=await context.newPage();await root.goto(info.url);await root.waitForSelector('.wb-hero');
  await root.locator('.wb-hero').click({position:{x:10,y:10}});await root.goBack();
  await root.waitForFunction(()=>!!document.getElementById('app')&&typeof Wisdom!=='undefined');
  assert(root.url().startsWith(info.url));assert.equal(await root.locator('.wb-hero').count(),1);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'browser.json'),JSON.stringify({...info,viewport:{width:412,height:915},shared:4,private:2,downloads,errors,checks:['direct shelves','scope filtering','preview exact selection','Back cancels export','confirmed ZIP download','scope unchanged','reader Back','root single Back stays in app'],export_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(evidence,'selected-export.zip'))).digest('hex')},null,2));
  console.log('PASS: shelves, exact export confirmation/download, reader/overlay/root Back; real shared core '+info.core_sha256);
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
