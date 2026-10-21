// Thales-only acceptance. Disposable data, actual HTTP API and unmodified shared core.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const out=process.env.WISDOM_QA_EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),15000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',line=>{clearTimeout(t);resolve(JSON.parse(line))})});
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const checks=[],errors=[];
  for(const width of [412,360]){
   const context=await browser.newContext({viewport:{width,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:1});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const back=async()=>{await page.goBack({waitUntil:'commit',timeout:2500}).catch(e=>{if(e.name!=='TimeoutError')throw e})};
   const hash=()=>page.evaluate(()=>location.hash);
   const fit=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
   await page.goto(info.url);await page.waitForSelector('.wb-hero');
   const data=await page.evaluate(async()=> (await fetch('api/wisdom')).json());
   assert.equal(await page.evaluate(()=>WizardApp.version),1);
   assert.equal(await page.locator('.wb-home-tools').count(),0);assert.equal(await page.getByRole('heading',{name:'Today’s picks'}).count(),0);
   assert.deepEqual(await page.locator('.wb-home > section > .wb-head > h2').allTextContents(),['Suggested '+Math.min(6,data.collections.length-1),'Browse and search']);
   const hero=await page.locator('.wb-hero').getAttribute('data-wisdom-route');assert(hero.startsWith('/collection/'));
   await page.locator('.wb-hero').click();await page.waitForSelector('.wb-collection');
   await page.locator('.wb-book-top [data-wisdom-back]').click();await page.waitForSelector('.wb-home');assert.equal(await hash(),'');
   await page.locator('.wb-hero').click();await page.waitForSelector('.wb-collection');await back();await page.waitForSelector('.wb-home');
   const browse=page.locator('.wb-discovery .wb-browse-card');assert.equal((await browse.innerText()).replace(/\s+/g,' ').trim(),`Browse all ${data.collections.length} collections ›`);
   await fit();await page.screenshot({path:path.join(out,`home-${width}.png`),fullPage:true});
   for(const scope of ['shared','private']){
    await page.locator(`.wb-discovery [data-wisdom-route="/shelf/${scope}"]`).click();await page.waitForSelector('.wb-library-shelf');
    assert.equal(await page.locator('.wb-shelves').count(),0);
    const cols=data.collections.filter(c=>(c.library_scope||'private')===scope),c=cols[0];
    assert.equal(await page.locator('.wb-shelf-body .wb-cover').count(),cols.length);
    await page.locator('#wb-q').fill(c.title.toUpperCase());await page.waitForSelector('#wb-results .wb-cover');
    const found=await page.locator('#wb-results .wb-cover').evaluateAll(es=>es.map(e=>e.dataset.wisdomRoute.slice('/collection/'.length)));
    assert(found.includes(c.id));assert(found.every(id=>cols.some(c=>c.id===id)));assert.equal(await page.locator('#wb-results [data-wisdom-route^="/read/"]').count(),0);
    await page.locator(`#wb-results [data-wisdom-route="/collection/${c.id}"]`).click();await page.waitForSelector('.wb-collection');
    await page.locator('.wb-book-top [data-wisdom-back]').click();await page.waitForSelector('.wb-library-shelf');assert.equal(await hash(),`#/shelf/${scope}`);assert.equal(await page.locator('#wb-q').inputValue(),c.title.toUpperCase());
    await page.locator(`#wb-results [data-wisdom-route="/collection/${c.id}"]`).click();await page.waitForSelector('.wb-collection');await back();await page.waitForSelector('.wb-library-shelf');assert.equal(await hash(),`#/shelf/${scope}`);
    await page.locator('#wb-q').fill('zzzzNoCollectionMatch');assert(await page.locator('#wb-results').innerText().then(s=>s.includes('No collections')));
    await page.locator('#wb-q').fill('');assert.equal(await page.locator('.wb-shelf-body .wb-cover:visible').count(),cols.length);await fit();
    await page.screenshot({path:path.join(out,`${scope}-${width}.png`),fullPage:true});
    await page.locator('.wb-all-top [data-wisdom-back]').click();await page.waitForSelector('.wb-home');
   }
   await browse.click();await page.waitForSelector('.wb-browse');
   const byId=new Map(data.entries.map(e=>[e.id,e]));
   const members=c=>c.entries.filter(id=>id!==c.overview).map(id=>byId.get(id)).filter(Boolean);
   const views={'to-read':c=>members(c).some(e=>!e.archived),starred:c=>members(c).some(e=>e.saved),archived:c=>members(c).length>0&&members(c).every(e=>e.archived),all:()=>true};
   for(const [view,matches] of Object.entries(views)){
    const expected=data.collections.filter(matches).length;
    assert.equal(await page.locator(`.wb-lib [data-wisdom-route="/library/${view}"] b`).textContent(),String(expected));
    await page.locator(`.wb-lib [data-wisdom-route="/library/${view}"]`).click();await page.waitForSelector('.wb-lib-page');
    assert.equal(await page.locator('.wisdom-library .wb-cover').count(),expected);assert.equal(await page.locator('.wisdom-row').count(),0);
    assert.equal(await page.locator(`.wisdom-views [data-wisdom-route="/library/${view}"] span`).textContent(),String(expected));
    await page.locator('.wb-all-top [data-wisdom-back]').click();await page.waitForSelector('.wb-browse');
   }
   await page.locator('.wb-browse .wb-cover').first().click();await page.waitForSelector('.wb-collection');await back();await page.waitForSelector('.wb-browse');assert.equal(await hash(),'#/browse');
   await page.locator('#wb-q').fill(data.collections[0].title);await page.waitForSelector('#wb-results .wb-cover');assert.equal(await page.locator('#wb-results [data-wisdom-route^="/read/"]').count(),0);await fit();
   await page.screenshot({path:path.join(out,`browse-search-${width}.png`),fullPage:true});
   const direct=await context.newPage();await direct.goto(info.url+'#'+hero);await direct.waitForSelector('.wb-collection');
   await direct.locator('.wb-book-copy h1').click();await direct.goBack({waitUntil:'commit',timeout:2500}).catch(e=>{if(e.name!=='TimeoutError')throw e});await direct.waitForSelector('.wb-home');assert(direct.url().startsWith(info.url));
   const directVisible=await context.newPage();await directVisible.goto(info.url+'#'+hero);await directVisible.waitForSelector('.wb-collection');await directVisible.locator('.wb-book-top [data-wisdom-back]').click();await directVisible.waitForSelector('.wb-home');assert(directVisible.url().startsWith(info.url));
   const root=await context.newPage();await root.goto(info.url);await root.waitForSelector('.wb-home');await root.locator('.wb-head').first().click();await root.goBack({waitUntil:'commit',timeout:2500}).catch(e=>{if(e.name!=='TimeoutError')throw e});await root.waitForSelector('.wb-home');assert(root.url().startsWith(info.url));
   checks.push({width,checks:['home collection hero + both Back paths','section order and discovery counts','scoped case-insensitive collection search + empty/clear','query restored on origin Back','browse controls and collection counts','browse origin Back','direct collection Back to home','first root Back stays','no horizontal overflow']});await context.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({...info,checks,errors},null,2));console.log('PASS collection home: '+checks.length+' phone widths; '+info.core_sha256);
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
