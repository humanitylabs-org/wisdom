/* Thales-only isolated UI contract fixture. NOT real model/backend evidence.
 * PLAYWRIGHT_DIR=/.../playwright WISDOM_QA_CORE=/.../app-client.js
 * WISDOM_QA_EVIDENCE=/Volumes/ThalesMedia/... node qa/discussions-ui.spec.cjs
 */
const {chromium} = require(process.env.PLAYWRIGHT_DIR);
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const crypto = require('crypto'), os = require('os');
const source = path.resolve(__dirname, '..'), out = process.env.WISDOM_QA_EVIDENCE;
assert(out && process.env.WISDOM_QA_CORE, 'Explicit evidence and approved core paths required');
fs.mkdirSync(out, {recursive:true});
const core = fs.readFileSync(process.env.WISDOM_QA_CORE);
const threads = new Map(), asks = [], checks = [];
let failDelivery = false, failPoll = false, detached = false;
const fixture = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/base.css"><link rel="stylesheet" href="/static/discussions.css"><style>body{margin:0}#reader{width:100%;height:1800px;padding:30px;box-sizing:border-box}#position{margin-top:280px}</style><body><main id="reader"><button id="open">Ask AI</button><h1 id="position">A reader that must not move</h1><p>Isolated UI fixture — deterministic responses, no model.</p></main><script src="/wizard-os-home/core/app-client.js"></script><script>window.held=0;const real=WizardApp;window.WizardApp={...real,update:{...real.update,hold(reason){held++;const h=real.update.hold(reason);let done=false;return {release(){if(!done){done=true;held--;h.release()}}}}}};</script><script src="/static/discussions.js"></script><script>WizardApp.back.register({canGoBack:()=>WisdomDiscussion.isOpen(),back:()=>WisdomDiscussion.back()});WisdomDiscussion.configure({base:"/",navigateTo(t){window.navigated=t.id}});window.anchor={entry_id:"chapter",body_sha256:"a".repeat(64),start:0,end:19,text:"Pay close attention."};document.querySelector("#open").onclick=()=>WisdomDiscussion.open(anchor);</script></body></html>';
function reply(res, data, code=200) {res.writeHead(code, {'Content-Type':'application/json'});res.end(JSON.stringify(data));}
const server = http.createServer(async(req,res)=>{
  if (req.url === '/') {res.setHeader('Content-Type','text/html');return res.end(fixture);}
  if (req.url === '/wizard-os-home/core/app-client.js') {res.setHeader('Content-Type','application/javascript; charset=utf-8');return res.end(core);}
  if (req.url.startsWith('/static/')) {
    const file = path.join(source, req.url); res.setHeader('Content-Type', file.endsWith('.js')?'application/javascript':'text/css'); return res.end(fs.readFileSync(file));
  }
  if (!req.url.startsWith('/api/discussions')) {res.statusCode=404;return res.end();}
  let raw='';for await(const chunk of req)raw+=chunk; const data=raw?JSON.parse(raw):{};
  const parts=req.url.split('/').filter(Boolean), id=parts[2], action=parts[3];
  if(req.method==='GET'&&!id)return reply(res,{configured:true,model:'Fixture model',threads:[...threads.values()].map(t=>({...t,message_count:t.messages.length,preview:t.messages.at(-1)?.content||''}))});
  if(req.method==='POST'&&!id){
    const key=String(data.entry_id); if(!threads.has(key))threads.set(key,{id:key,...data,quote:data.text,chapter_title:'On attention',messages:[],active:false,web_enabled:false,detached:false,model:'Fixture model'});
    return reply(res,threads.get(key));
  }
  const t=threads.get(id);if(!t)return reply(res,{error:'Not found'},404);
  if(req.method==='GET'){
    if(failPoll){failPoll=false;return reply(res,{error:'Fixture network outage'},503);}
    if(t.active){t.ticks=(t.ticks||0)+1;t.messages.at(-1).content+='\nA streamed observation.';}
    return reply(res,{...t,detached});
  }
  if(action==='ask'){
    asks.push({...data,id});
    if(!t.requests)t.requests=[];
    if(!t.requests.includes(data.request_id)){
      t.requests.push(data.request_id);t.web_enabled=data.web_enabled;t.active=true;
      t.messages.push({id:crypto.randomUUID(),role:'user',content:data.question,state:'done'}, {id:crypto.randomUUID(),role:'assistant',state:'streaming',content:'A **careful** reading. [Reference](https://example.com/source) [unsafe](javascript:alert(1)) <img src=x onerror="window.pwned=1">',sources:[{title:'The chapter',text:'Stored chapter excerpt'},{title:'Reference',url:'https://example.com/source'}]});
    }
    if(failDelivery){failDelivery=false;return reply(res,{error:'Fixture lost acknowledgement'},503);}
    return reply(res,t);
  }
  if(action==='stop'){t.active=false;t.messages.at(-1).state='stopped';return reply(res,t);}
  reply(res,{error:'No route'},404);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  for(const width of [360,412,1280]){
   const context=await browser.newContext({viewport:{width,height:850},hasTouch:width<900,isMobile:width<900});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const url='http://127.0.0.1:'+server.address().port+'/';await page.goto(url);
   const id='chapter-'+width;await page.evaluate(id=>{anchor.entry_id=id},id);
   const geometry=()=>page.locator('#reader').boundingBox();const before=await geometry();
   await page.locator('#open').click();await page.waitForFunction(()=>!document.querySelector('.wd-composer textarea').disabled);
   assert.equal(threads.get(id).messages.length,0);
   assert.deepEqual(await geometry(),before);checks.push(width+': idle open does not reflow reader or generate');
   await page.locator('.wd-chip').first().click();assert.equal(threads.get(id).messages.length,0);
   await page.locator('textarea').fill('Keep my draft');
   await page.locator('.wd-close').click();assert(await page.evaluate(()=>held>0));
   await page.evaluate(()=>WisdomDiscussion.open(anchor));assert.equal(await page.locator('textarea').inputValue(),'Keep my draft');
   await page.reload();await page.evaluate(id=>WisdomDiscussion.open({id}),id);assert.equal(await page.locator('textarea').inputValue(),'Keep my draft');
   checks.push(width+': draft survives close, reopen, reload; update held');
   await page.locator('.wd-web input').check();await page.locator('.wd-send').click();await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Stop');
   assert.equal(asks.at(-1).web_enabled,true);
   await page.locator('textarea').fill('Follow up with care');await page.locator('textarea').evaluate(e=>{e.focus();e.setSelectionRange(4,7)});
   const initial=threads.get(id).ticks;await page.waitForFunction(()=>document.querySelectorAll('.wd-assistant p').length>2);
   await page.waitForTimeout(1200);assert(threads.get(id).ticks>initial);
   assert.deepEqual(await page.locator('textarea').evaluate(e=>[document.activeElement===e,e.selectionStart,e.selectionEnd,e.value]),[true,4,7,'Follow up with care']);
   assert.equal(await page.locator('.wd-messages img').count(),0);assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
   assert.equal(await page.evaluate(()=>window.pwned),undefined);
   await page.locator('.wd-sources summary').click();assert(await page.locator('.wd-sources').getAttribute('open')!==null);
   checks.push(width+': polling preserves composer focus/cursor; Markdown and citations are safe');
   await page.screenshot({path:path.join(out,width+'-light.png')});
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');
   assert.equal(await page.locator('textarea').inputValue(),'Follow up with care');await page.screenshot({path:path.join(out,width+'-dark.png')});
   const bounds=await page.locator('.wd-panel').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   assert((await page.locator('.wd-send').boundingBox()).y<850);
   await page.locator('.wd-send').click();await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Send');
   assert.equal(threads.get(id).active,false);assert(await page.locator('.wd-turn-error').count());
   const lastRequest=asks.at(-1).request_id;
   await page.getByRole('button',{name:'Retry this question'}).click();await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Stop');
   assert.notEqual(asks.at(-1).request_id,lastRequest);await page.locator('.wd-send').click();
   await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Send');
   checks.push(width+': stop preserves partial reply; explicit retry has fresh request identity');
   // Back through keyboard, expanded sources, sheet, then standalone root guard.
   await page.locator('textarea').focus();await page.evaluate(()=>history.back());await page.waitForTimeout(100);
   assert(await page.evaluate(()=>WisdomDiscussion.isOpen()));
   await page.evaluate(()=>history.back());await page.waitForTimeout(100);
   if(await page.evaluate(()=>WisdomDiscussion.isOpen())){await page.evaluate(()=>history.back());await page.waitForTimeout(100);}
   assert.equal(await page.evaluate(()=>WisdomDiscussion.isOpen()),false);assert.equal(page.url(),url);assert.deepEqual(await geometry(),before);
   checks.push(width+': real shared-client browser Back closes nested state without leaving reader');
   await page.evaluate(()=>WisdomDiscussion.list('nonexistent'));assert((await page.locator('.wd-body').innerText()).includes('A conversation starts'));
   await page.evaluate(id=>WisdomDiscussion.list(id),id);assert.equal(await page.locator('.wd-thread-row').count(),1);
   await page.locator('.wd-thread-row').click();await page.waitForFunction(()=>!document.querySelector('textarea').disabled);assert.equal(await page.evaluate(()=>navigated),id);
   checks.push(width+': chapter filter, list, and navigate/reopen');
   assert.deepEqual(errors,[]);await context.close();
  }
  const context=await browser.newContext({viewport:{width:412,height:850}}),page=await context.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#open').click();await page.locator('textarea').fill('Lost delivery');failDelivery=true;
  await page.locator('.wd-send').click();await page.getByRole('button',{name:'Retry delivery'}).waitFor();
  const request=asks.at(-1).request_id;await page.getByRole('button',{name:'Retry delivery'}).click();await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Stop');
  assert.equal(asks.at(-1).request_id,request);assert.equal(threads.get('chapter').messages.filter(m=>m.role==='user').length,1);
  checks.push('lost acknowledgement retries same durable request without duplicate user turn');
  failPoll=true;await page.getByRole('button',{name:'Reconnect'}).waitFor();await page.getByRole('button',{name:'Reconnect'}).click();await page.waitForFunction(()=>!document.querySelector('.wd-notice').textContent.includes('Connection lost'));
  await page.locator('.wd-send').click();await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Send');
  await page.locator('textarea').fill('offline draft');await context.setOffline(true);assert.equal(await page.locator('.wd-send').textContent(),'Offline');await context.setOffline(false);
  checks.push('poll error/reconnect and offline composer retain honest state');
  await page.locator('textarea').fill('');assert.equal(await page.evaluate(()=>held),0);
  checks.push('update hold releases after confirmed stop and draft discard');
  // Long answer must not pull someone away from earlier paragraphs.
  threads.get('chapter').messages.at(-1).content='Paragraph.\n'.repeat(160);
  threads.get('chapter').active=true;threads.get('chapter').messages.at(-1).state='streaming';
  await page.evaluate(()=>WisdomDiscussion.open({id:'chapter'}));
  await page.locator('.wd-body').evaluate(e=>{e.scrollTop=100});
  const readingAt=await page.locator('.wd-body').evaluate(e=>e.scrollTop);
  await page.waitForTimeout(1400);assert.equal(await page.locator('.wd-body').evaluate(e=>e.scrollTop),readingAt);
  await page.locator('.wd-jump').click();await page.waitForTimeout(1200);
  assert(await page.locator('.wd-body').evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<90));
  await page.locator('.wd-close').click();const ticks=threads.get('chapter').ticks;
  await page.waitForTimeout(1300);assert.equal(threads.get('chapter').ticks,ticks);
  await page.evaluate(()=>WisdomDiscussion.open({id:'chapter'}));
  assert.equal(await page.locator('.wd-send').textContent(),'Stop');await page.locator('.wd-send').click();
  await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Send');
  checks.push('scroll stays put away from bottom; latest follows; close pauses polling and reopen resumes');
  // Delayed older GET must not resurrect a stopped run.
  await page.locator('textarea').fill('Race check');await page.locator('.wd-send').click();
  await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Stop');
  let release, arrived, intercepted=false;const delayed=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);
  await page.route('**/api/discussions/chapter',async route=>{
    if(intercepted)return route.continue();intercepted=true;
    const response=await route.fetch();arrived();await gate;await route.fulfill({response});
  });
  await delayed;await page.locator('.wd-send').click();
  await page.waitForFunction(()=>document.querySelector('.wd-send').textContent==='Send');release();await page.waitForTimeout(200);
  assert.equal(await page.locator('.wd-send').textContent(),'Send');assert.equal(await page.evaluate(()=>held),0);
  checks.push('late in-flight poll cannot revive stopped run or leak update hold');
  detached=true;await page.evaluate(()=>WisdomDiscussion.open({id:'chapter'}));assert(!(await page.locator('textarea').isDisabled()));assert((await page.locator('.wd-notice').innerText()).includes('original passage'));detached=false;
  checks.push('detached edition retains original context and remains discussable');
  threads.get('chapter').active=true;threads.get('chapter').messages.at(-1).state='streaming';
  await page.evaluate(()=>WisdomDiscussion.open({id:'chapter'}));await page.locator('.wd-close').click();
  threads.get('chapter').active=false;threads.get('chapter').messages.at(-1).state='complete';
  await page.waitForFunction(()=>held===0,{},{timeout:6000});
  checks.push('closed discussion releases update hold after server completion');
  await context.close();
  const receipt={type:'isolated UI contract fixture; NOT real model/backend or live release proof',host:os.hostname(),checks,core_sha256:crypto.createHash('sha256').update(core).digest('hex'),files:Object.fromEntries(['static/discussions.js','static/discussions.css'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,f))).digest('hex')]))};
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
