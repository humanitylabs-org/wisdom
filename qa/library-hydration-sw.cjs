'use strict';
// Real SW/CacheStorage/strict IDB against an isolated synthetic HTTP origin.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_DIR),source=process.env.QA_SOURCE,shell=process.env.QA_SHELL,out=process.env.QA_OUT;
const full=JSON.parse(fs.readFileSync(process.env.QA_FIXTURE)),meta=JSON.parse(fs.readFileSync(process.env.QA_METADATA)),chapter=JSON.parse(fs.readFileSync(process.env.QA_CHAPTER));
const mime=f=>({'.js':'application/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}[path.extname(f)]||'application/octet-stream');
const proof={status:'running',serviceWorkerEnabled:true,syntheticOnly:true,requests:[],errors:[]},sockets=new Set();
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://fixture.invalid').pathname;proof.requests.push({method:req.method,path:p});
 const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v))};
 if(p==='/wisdom/api/wisdom')return; // full response really remains unresolved
 if(p==='/wisdom/api/wisdom/metadata')return json(meta);
 if(p.startsWith('/wisdom/api/wisdom/chapter/'))return json(chapter);
 if(p.startsWith('/wisdom/api/'))return json(p.endsWith('/discussions')?{threads:[]}:{error:'Synthetic unavailable'},p.endsWith('/discussions')?200:503);
 const name=p.startsWith('/wisdom/')?path.join(source,'static',p.slice(8)||'index.html'):p.startsWith('/wizard-os-home/')?path.join(shell,'web',p.slice(16)):'';
 if(!name||p.includes('..')||!fs.existsSync(name))return json({error:'Synthetic route only'},404);
 res.writeHead(200,{'Content-Type':mime(name),'Service-Worker-Allowed':'/wisdom/'});res.end(fs.readFileSync(name));
});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))});
const snapshot=()=>new Promise((resolve,reject)=>{const o=indexedDB.open('wisdom-offline-v1',1);o.onsuccess=()=>{const db=o.result,tx=db.transaction(['meta','outbox'],'readonly'),state=tx.objectStore('meta').get('state'),rows=tx.objectStore('outbox').getAll();tx.oncomplete=()=>{db.close();resolve({state:state.result,rows:rows.result})};tx.onerror=()=>reject(tx.error)};o.onerror=()=>reject(o.error)});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser,ctx;
 try{
  browser=await chromium.launch({headless:true});ctx=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'allow'});await ctx.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const page=await ctx.newPage();page.on('pageerror',e=>proof.errors.push(e.message));await page.goto(base+'/wisdom/',{waitUntil:'domcontentloaded'});await page.locator('.wb-home').waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;return !!navigator.serviceWorker.controller},null,{timeout:10000});proof.controller=await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL);
  const before=await page.evaluate(snapshot);assert(before.state.metadata_only&&Array.isArray(before.state.entries));assert(!before.state.entries.some(e=>'body' in e));assert(!('id' in before.state));
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.wb-home').waitFor();
  await page.locator('.wb-browse-card').click();await page.locator('.wb-cover').first().click();await page.locator(`[data-wisdom-route="/read/${chapter.id}/${full.collections[0].id}"]`).first().click();await page.locator('.wb-reader').waitFor();
  proof.afterChapter=await page.evaluate(snapshot);const entry=proof.afterChapter.state.entries.find(x=>x.id===chapter.id);assert(proof.afterChapter.state.metadata_only);assert.equal(entry.body,chapter.body);assert.equal(entry.body_sha256,chapter.body_sha256);assert(!('id' in proof.afterChapter.state));
  proof.cacheKeys=await page.evaluate(async()=>{const rows={};for(const key of await caches.keys())rows[key]=(await (await caches.open(key)).keys()).map(r=>new URL(r.url).pathname);return rows});assert(!Object.entries(proof.cacheKeys).filter(([k])=>k.includes('data')).some(([,v])=>v.some(x=>x.includes('/metadata')||x.includes('/chapter/'))),'SW data matching is exact, not prefix');
  await ctx.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.locator('.wb-reader').waitFor({timeout:7000});assert((await page.locator('.wb-reader').textContent()).includes('Quiet attention'));
  proof.afterOfflineReload=await page.evaluate(snapshot);assert(proof.afterOfflineReload.state.metadata_only);assert.equal(proof.afterOfflineReload.state.entries.find(x=>x.id===chapter.id).body,chapter.body);assert.deepEqual(proof.errors,[]);proof.status='pass';
 }finally{if(ctx)await ctx.close();if(browser)await browser.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'library-hydration-sw.json'),JSON.stringify(proof,null,2)+'\n')}
})().catch(e=>{proof.status='fail';proof.error=String(e.stack||e);fs.writeFileSync(path.join(out,'library-hydration-sw.json'),JSON.stringify(proof,null,2)+'\n');console.error(e);process.exitCode=1});
