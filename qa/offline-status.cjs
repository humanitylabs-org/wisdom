// Adapter-only synthetic states. No owner API/data is contacted.
const {chromium}=require(process.env.PLAYWRIGHT_DIR),assert=require('assert/strict'),fs=require('fs'),path=require('path'),http=require('http');
const root=path.resolve(__dirname,'..'),out=process.env.WISDOM_QA_EVIDENCE;fs.mkdirSync(out,{recursive:true});const checks={};let browser,server;
(async()=>{
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><style>${fs.readFileSync(path.join(root,'static/app.css'),'utf8')}</style></head><body><main class="wb-home">Library home</main><script>window.WizOffline={create:c=>(window.__show=c.onStatus,{})};</script><script>${fs.readFileSync(path.join(root,'static/offline.js'),'utf8')}</script></body></html>`)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/wisdom/`);
 const state={online:true,ready:false,warming:false,done:0,total:0,pending:0,failed:[],error:''},failed=[{id:'failed-1',path:'api/wisdom/highlight',body:{text:'The quote',note:'The retained note'},error:'Internal SQL traceback secret detail'}];
 await page.evaluate(()=>{window.__visible=[];new MutationObserver(()=>{const e=document.querySelector('#wisdom-offline');if(e&&e.getBoundingClientRect().height)__visible.push(e.textContent)}).observe(document.body,{subtree:true,childList:true,attributes:true})});
 for(const kind of ['wb-home','wb-collection','wb-reader','wb-browse','wb-library-shelf']){
   await page.evaluate(kind=>{document.querySelector('main').className=kind},kind);
   for(const s of [{error:'worker raw error'},{warming:true,done:1,total:100},{ready:true},{ready:true,pending:3},{ready:true,pending:0},{ready:true,failed}]){
     await page.evaluate(s=>__show(s),{...state,...s});assert(await page.locator('#wisdom-offline').isHidden());assert(!(await page.locator('body').innerText()).includes('traceback'));
   }
   await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('[data-offline-status]').textContent.startsWith('Offline'));assert(await page.locator('#wisdom-offline').isHidden());await context.setOffline(false);
 }
 checks['no popups while reading']='passed';checks['no offline popups anywhere']='passed';
 // Only an explicit library line and View expose retained text, in normal page flow.
 await page.evaluate(()=>{document.querySelector('main').innerHTML='<p data-offline-failures></p>';WisdomOffline.renderFailures()});
 assert((await page.locator('[data-offline-failures]').innerText()).includes('1 note couldn’t be saved · View'));assert.equal(await page.locator('[data-offline-failures]').evaluate(e=>getComputedStyle(e).position),'static');
 await page.evaluate(()=>{document.querySelector('main').innerHTML='<div data-offline-failure-view></div>';WisdomOffline.renderFailures()});assert((await page.locator('body').innerText()).includes('The quote — The retained note'));assert(!(await page.locator('body').innerText()).includes('traceback'));assert.equal(await page.getByRole('button',{name:'Dismiss offline saving notice'}).count(),1);
 assert.deepEqual(await page.evaluate(()=>__visible),[]);checks.retainedTextOnlyOnExplicitView=true;checks.rawWorkerErrorsSilent=true;checks.connectivityEventsUpdateHiddenStatus=true;checks.status='passed';fs.writeFileSync(path.join(out,'offline-status.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));await context.close();
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server?.close()});
