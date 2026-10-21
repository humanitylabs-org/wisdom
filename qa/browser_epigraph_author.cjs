// Synthetic data only; exercise the actual reader and preserve selection text.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
(async()=>{
 const out=process.env.WISDOM_QA_EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_epigraph_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 const exited=new Promise(resolve=>fixture.once('exit',resolve));let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture timeout')),15000);fixture.once('exit',c=>reject(Error('Fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',s=>{clearTimeout(timer);resolve(JSON.parse(s))})});
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const results=[];
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width<600,hasTouch:true});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cases=[['absent',undefined,'Example Author'],['explicit','A. E. Waite','A. E. Waite'],['empty','','Example Author'],['blank','  \n ','Example Author'],['null',null,'Example Author'],['object',{name:'wrong'},'Example Author'],['number',42,'Example Author'],['escaped','<img src=x onerror="window.attributionInjected=1"> & Writer','<img src=x onerror="window.attributionInjected=1"> & Writer']];
   let value;let baseline;
   await page.route('**/api/wisdom',async route=>{const response=await route.fetch();const data=await response.json();if(value!==undefined)data.entries[0].epigraph_author=value;await route.fulfill({response,json:data})});
   for(const [name,author,expected] of cases){
    value=author;await page.goto('about:blank');await page.goto(info.url+'#/read/example-chapter');await page.waitForSelector('.wb-epigraph .wb-attrib',{state:'attached',timeout:10000}).catch(async e=>{console.error({errors,body:await page.locator('body').innerText(),url:page.url()});throw e});
    assert.equal(await page.locator('.wb-epigraph .wb-attrib').textContent(),'— '+expected,name);
    assert.equal(await page.locator('.wb-top-title strong').textContent(),'Example Author');
    const texts=await page.evaluate(()=>({flow:document.querySelector('.wb-flow').textContent,quote:document.querySelector('.wb-epigraph blockquote').textContent,sha:document.querySelector('.wb-reader').dataset.bodySha256}));
    if(!baseline)baseline=texts;else assert.deepEqual(texts,baseline,'Attribution must not change body/quote offsets or edition');
    assert.equal(await page.locator('.wb-attrib img').count(),0);assert.equal(await page.evaluate(()=>window.attributionInjected),undefined);
    if(name==='explicit'){await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'epigraph-author-'+width+'.png')})}
    results.push({width,case:name,attribution:expected,pass:true});
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  const asset=fs.readFileSync(process.env.WISDOM_QA_ASSET||'static/wisdom.js');
  fs.writeFileSync(path.join(out,'epigraph-author.json'),JSON.stringify({host:require('os').hostname(),wisdom_js_sha256:crypto.createHash('sha256').update(asset).digest('hex'),results},null,2));
  console.log('PASS epigraph author: '+results.length+' cases; fallback, escaping, thinker identity, unchanged quote/body text and edition');
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM');await exited}
})().catch(e=>{console.error(e);process.exitCode=1});
