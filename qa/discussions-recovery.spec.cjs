/* Synthetic API contract regression, not real-model or installed-shell proof.
 * Uses the real reader, shared app-client/services and appearance-host. Run on the build worker only.
 * QA_BASELINE_ASSETS points to exact live static/ for the negative control.
 */
'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const out=process.env.WISDOM_QA_EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const baseline=!!process.env.QA_BASELINE_ASSETS,checks=[],errors=[];
let browser,fixture,lastPage;
const copy=x=>JSON.parse(JSON.stringify(x));
async function word(frame){return frame.evaluate(()=>{const f=document.querySelector('.wb-flow');if(!f)return null;const w=document.createTreeWalker(f,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.parentElement.closest('mark.wb-hl,.wb-gloss,a,button'))continue;const re=/[A-Za-z]{6,}/g;let m;while(m=re.exec(n.data)){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);const b=r.getBoundingClientRect();if(b.width&&b.left>25&&b.right<innerWidth-25&&b.top>110&&b.bottom<innerHeight-170)return{text:m[0],x:b.x+b.width/2,y:b.y+b.height/2}}}return null})}
async function selectWord(page,frame,mobile){let w;for(let i=0;i<10&&!(w=await word(frame));i++){await frame.evaluate(()=>dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));await sleep(350)}assert(w,'visible reader word');
 if(mobile){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:w.x,y:w.y}]});await sleep(650);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else await page.mouse.dblclick(w.x,w.y);
 await frame.locator('[data-hl-act="ask"]:visible').waitFor();return w;
}
async function armPaint(frame){await frame.evaluate(()=>{window.__popupPaint=new Promise(resolve=>{const start=e=>{document.removeEventListener('pointerdown',start,true);const t=performance.now();let done=false;const finish=x=>{if(!done){done=true;resolve(x)}};setTimeout(()=>finish({ms:performance.now()-t,usable:false}),650);const tick=()=>{const p=document.querySelector('.wd-panel'),c=document.querySelector('.wd-composer textarea'),b=p?.getBoundingClientRect();if(p&&!p.closest('[hidden]')&&c&&!c.disabled&&b.width&&b.height){requestAnimationFrame(()=>finish({ms:performance.now()-t,usable:true,frameWidth:innerWidth}));}else if(!done)requestAnimationFrame(tick)};requestAnimationFrame(tick)};document.addEventListener('pointerdown',start,true)});})}
async function tap(page,frame,mobile,selector){await armPaint(frame);if(mobile)await frame.locator(selector).tap();else await frame.locator(selector).click();return frame.evaluate(()=>window.__popupPaint)}
async function hidden(frame){await frame.waitForFunction(()=>!WisdomDiscussion.isOpen())}
async function ready(frame){await frame.waitForFunction(()=>!document.querySelector('.wd-status')?.textContent.includes('Opening saved discussion')&&!!document.querySelector('.wd-composer textarea'))}
async function scenario(url,width,skin){
 const mobile=width<900,context=await browser.newContext({viewport:{width,height:860},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:1,serviceWorkers:'block',...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'}:{})});
 const page=await context.newPage();lastPage=page;page.on('pageerror',e=>errors.push(e.message));await context.tracing.start({screenshots:true,snapshots:true});
 const db=new Map(),requests=[],control={delay:5500,highlightDelay:5500,fault:'',configured:true,failModel:false,holdRead:false,openFault:false};let serial=0;
 const answer=(t,p)=>{if(!t.messages.some(m=>m.request_id===p.request_id)){t.messages.push({id:'u'+(++serial),role:'user',content:p.question,state:'complete',sources:[],request_id:p.request_id});t.messages.push({id:'a'+serial,role:'assistant',content:control.failModel?'':'Fixture answer: the passage can be explored.',state:control.failModel?'failed':'complete',sources:[],...(control.failModel?{error:'The model connection is unavailable. Your question is kept.',error_code:'unavailable',fix_url:'/wizard-os-home/?open=connection-router'}:{})});}t.active=false;return copy(t)};
 await page.route('**/api/discussions**',async route=>{const r=route.request(),p=new URL(r.url()).pathname.split('/api/discussions')[1],method=r.method();
  try{
   if(p===''&&method==='GET')return route.fulfill({json:{threads:[...db.values()].map(t=>({...t,message_count:t.messages.length})),configured:control.configured,model:'fixture'}});
   if(p===''&&method==='POST'){const a=r.postDataJSON();requests.push({kind:'open',payload:a});const signature=JSON.stringify([a.entry_id,a.body_sha256,a.scope,a.start,a.end,a.text]);let t=[...db.values()].find(t=>t.signature===signature);if(!t){t={...a,id:(++serial).toString(16).padStart(32,'0'),scope:a.scope||'passage',quote:a.text||'',chapter_title:'Fixture chapter',messages:[],active:false,web_enabled:false,configured:control.configured,signature};db.set(t.id,t)}const result=copy(t),fault=control.openFault;control.openFault=false;await sleep(control.delay);if(fault)return route.abort('failed');return route.fulfill({json:result});}
   const [id,action]=p.slice(1).split('/'),t=db.get(id);assert(t,'known fixture discussion '+p);
   if(action==='ask'){const payload=r.postDataJSON();requests.push({kind:'ask',payload});const fault=control.fault;control.fault='';if(fault==='drop-request')return route.abort('failed');if(fault==='503')return route.fulfill({status:503,json:{error:'Connection interrupted. Your question is kept.'}});if(fault==='hang'){await sleep(14000);return route.fulfill({json:copy(t)});}const result=answer(t,payload);if(fault==='drop-response')return route.abort('failed');if(fault==='active'){t.active=true;t.messages.at(-1).state='streaming';result.active=true;result.messages.at(-1).state='streaming';}return route.fulfill({json:result});}
   if(action==='stop'){t.active=false;if(t.messages.length)t.messages.at(-1).state='stopped';return route.fulfill({json:copy(t)});}
   requests.push({kind:'get',id});const result=copy(t);if(control.holdRead)await sleep(14000);else await sleep(control.delay);return route.fulfill({json:result});
  }catch(e){if(!page.isClosed()&&!/Target.*closed|Invalid InterceptionId|already handled/.test(String(e)))throw e;}
 });
 await page.route('**/api/wisdom/highlight',async route=>{if(route.request().method()==='POST'){await sleep(control.highlightDelay);await route.continue().catch(()=>{});}else await route.continue()});
 if(baseline)for(const file of ['wisdom.js','discussions.js','offline.js'])await page.route('**/'+file+'*',r=>r.fulfill({contentType:'application/javascript; charset=utf-8',body:fs.readFileSync(path.join(process.env.QA_BASELINE_ASSETS,file))}));
 await page.goto(url+'qa-host');const frame=await(await page.locator('iframe').elementHandle()).contentFrame();assert(frame);
 await frame.locator('.wb-home').waitFor();await page.evaluate(skin=>document.documentElement.dataset.skin=skin,skin);
 await frame.waitForFunction(skin=>document.documentElement.dataset.skin===skin,skin);
 assert.equal(await frame.evaluate(()=>innerWidth),width,'actual iframe CSS viewport');
 const data=await(await context.request.get(url+'api/wisdom')).json();const entry=data.entries.find(e=>e.body.length>1500)||data.entries[0];assert(entry);
 await frame.evaluate(id=>Wisdom.navigate('/read/'+id),entry.id);await frame.locator('.wb-reader').waitFor();await frame.evaluate(()=>document.fonts.ready);await sleep(350);
 const w=await selectWord(page,frame,mobile);const before=await frame.locator('.wb-track').evaluate(e=>e.style.transform);
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const fresh=await tap(page,frame,mobile,'[data-hl-act="ask"]');checks.push({width,skin,path:'Ask AI',delayMs:5500,cpuSlowdown:4,...fresh});
 if(!baseline){assert(fresh.usable&&fresh.ms<=150,JSON.stringify(fresh));await frame.locator('textarea').fill('A question typed before history loads');await frame.locator('textarea').evaluate(e=>e.setSelectionRange(4,12));await page.screenshot({path:path.join(out,`${width}-${skin}-immediate.png`)});}
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 await frame.waitForFunction(()=>!!document.querySelector('.wd-overlay:not([hidden])')&&!document.querySelector('.wd-composer textarea').disabled,{},{timeout:18000});await ready(frame);await sleep(600);
 if(!baseline){assert.equal(await frame.locator('textarea').inputValue(),'A question typed before history loads');assert.deepEqual(await frame.locator('textarea').evaluate(e=>[e.selectionStart,e.selectionEnd]),[4,12]);assert.equal(await frame.locator('.wb-track').evaluate(e=>e.style.transform),before);assert((await frame.locator('.wd-quote').textContent()).includes(w.text));}
 const id=[...db.keys()][0];assert(id);await frame.locator('textarea').fill('Saved draft, not a new model turn');await frame.locator('.wd-close').click();await hidden(frame);await sleep(500);
 await frame.locator('.wb-hl[data-discussed]').first().click();await frame.locator('[data-hl-act="ask"]:visible').waitFor();assert.equal(await frame.locator('[data-hl-act="ask"]').textContent(),'Open discussion');
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});const existing=await tap(page,frame,mobile,'[data-hl-act="ask"]');checks.push({width,skin,path:'Open discussion',delayMs:5500,cpuSlowdown:4,...existing});await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 if(baseline){assert(!fresh.usable||fresh.ms>150,'old Ask AI must fail the same latency criterion');assert(!existing.usable||existing.ms>150,'old Open discussion must fail the same usability criterion');await page.screenshot({path:path.join(out,`${width}-${skin}-baseline-rejected.png`)});await context.tracing.stop({path:path.join(out,`${width}-${skin}.zip`)});await context.close();return;}
 assert(existing.usable&&existing.ms<=150,JSON.stringify(existing));assert.equal(await frame.locator('textarea').inputValue(),'Saved draft, not a new model turn');
 // Cancel while loading via a real outside tap: the late response must stay closed.
 await frame.locator('textarea').blur();await page.mouse.click(6,6);await hidden(frame);await sleep(5800);assert.equal(await frame.evaluate(()=>WisdomDiscussion.isOpen()),false);
 control.delay=0;control.highlightDelay=0;
 const open=()=>frame.evaluate(id=>WisdomDiscussion.open({id}),id),textarea=frame.locator('textarea');
 await open();await textarea.fill('Recovered question');
 // Duplicate open must coalesce; late hydrations must not clobber a new edit.
 control.delay=5500;const count=requests.filter(r=>r.kind==='get').length;
 await frame.evaluate(id=>{WisdomDiscussion.open({id});WisdomDiscussion.open({id});},id);await textarea.fill('A newer unsent question');await sleep(5700);assert.equal(await textarea.inputValue(),'A newer unsent question');assert.equal(requests.filter(r=>r.kind==='get').length,count+1);control.delay=0;
 // An unavailable configured flag is advisory, never a permanent client-side lock.
 control.configured=false;db.get(id).configured=false;await open();await textarea.fill('Can I ask now?');assert.equal(await frame.locator('.wd-send').isDisabled(),false);control.configured=true;db.get(id).configured=true;
 const settle=async()=>{await frame.waitForFunction(()=>!document.querySelector('.wd-status')?.textContent.includes('Saving your question'));await sleep(150);};
 const send=async text=>{await textarea.fill(text);await frame.locator('.wd-send').click();await settle()};
 // Request lost before acceptance: retained ID survives a normal reload; exactly one accepted turn.
 control.fault='drop-request';await send('Question lost before acceptance');assert(await frame.getByText('Retry delivery',{exact:true}).count());const original=requests.filter(r=>r.kind==='ask').at(-1).payload;
 await frame.locator('.wd-close').click();await Promise.all([frame.waitForNavigation({waitUntil:'domcontentloaded'}),frame.evaluate(()=>location.reload())]);await frame.locator('.wb-reader').waitFor();await open();assert.equal(await textarea.inputValue(),'Question lost before acceptance');
 await frame.getByText('Retry delivery',{exact:true}).click();await settle();await frame.waitForFunction(()=>document.querySelector('.wd-assistant')?.textContent.includes('Fixture answer'));
 assert.equal(requests.filter(r=>r.kind==='ask').at(-1).payload.request_id,original.request_id);assert.equal(db.get(id).messages.filter(m=>m.request_id===original.request_id).length,1);
 // Lost response after acceptance: retry uses the same ID, never duplicates inference.
 control.fault='drop-response';await send('Accepted but response dropped');const accepted=requests.filter(r=>r.kind==='ask').at(-1).payload;
 await frame.getByText('Retry delivery',{exact:true}).click();await settle();assert.equal(requests.filter(r=>r.kind==='ask').at(-1).payload.request_id,accepted.request_id);assert.equal(db.get(id).messages.filter(m=>m.request_id===accepted.request_id).length,1);
 // Failed model turn keeps question+link and offers an actionable fresh-ID retry.
 control.failModel=true;await send('Could you expand on this?');await frame.locator('.wd-turn-error').last().waitFor();const failed=requests.filter(r=>r.kind==='ask').at(-1).payload.request_id;control.failModel=false;await textarea.fill('A newer draft while retrying the earlier question');
 await frame.locator('.wd-turn-error').last().getByText('Retry this question',{exact:true}).click();await settle();await frame.waitForFunction(()=>[...document.querySelectorAll('.wd-assistant')].at(-1)?.textContent.includes('Fixture answer'));assert.notEqual(requests.filter(r=>r.kind==='ask').at(-1).payload.request_id,failed);assert.equal(await textarea.inputValue(),'A newer draft while retrying the earlier question');
 // 503 and hanging fetch release busy; edits made in flight are never erased.
 control.fault='503';await send('503 question');await frame.getByText('Retry delivery',{exact:true}).click();await settle();
 control.fault='hang';await textarea.fill('Hung question');await frame.locator('.wd-send').click();await textarea.fill('Newer words written while sending');await frame.waitForFunction(()=>!document.querySelector('.wd-status')?.textContent.includes('Saving your question'),{},{timeout:14000});assert.equal(await textarea.inputValue(),'Newer words written while sending');assert.equal(await textarea.isDisabled(),false);await frame.getByText('Retry delivery',{exact:true}).click();await settle();assert.equal(await textarea.inputValue(),'Newer words written while sending');
 // Successful POST + hung readback reproduces the reported Saving… lockout.
 control.holdRead=true;await textarea.fill('Accepted with a hung readback');await frame.locator('.wd-send').click();await frame.waitForFunction(()=>!document.querySelector('.wd-status')?.textContent.includes('Saving your question'),{},{timeout:1500});assert.equal(await textarea.isDisabled(),false);control.holdRead=false;await sleep(12500);await settle();
 // Offline/online does not auto-send, but an explicit Retry can get a fixture answer.
 await context.setOffline(true);await textarea.fill('Question kept through spotty WiFi');const sent=requests.filter(r=>r.kind==='ask').length;await frame.locator('.wd-close').click();await open();assert.equal(await textarea.inputValue(),'Question kept through spotty WiFi');assert.equal(await textarea.isDisabled(),false);await context.setOffline(false);await sleep(300);assert.equal(requests.filter(r=>r.kind==='ask').length,sent);if(await frame.getByText('Try again',{exact:true}).count())await frame.getByText('Try again',{exact:true}).click();await ready(frame);await frame.locator('.wd-send').click();await settle();await frame.waitForFunction(()=>[...document.querySelectorAll('.wd-assistant')].at(-1)?.textContent.includes('Fixture answer'));
 // Storage failure is visible and recoverable in memory, never an unhandled exception.
 await frame.evaluate(()=>{const set=Storage.prototype.setItem;window.__restoreStorage=()=>Storage.prototype.setItem=set;Storage.prototype.setItem=function(k,v){if(k.startsWith('wisdom.discussions.v1:'))throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v)}});
 await textarea.fill('Keep in memory when storage is full');await frame.locator('.wd-close').click();await open();assert.equal(await textarea.inputValue(),'Keep in memory when storage is full');assert(await frame.getByText(/Draft could not be saved on this device/).count());await frame.evaluate(()=>window.__restoreStorage());
 // Stop fences stale readback; reopen never reacquires a stopped run.
 control.fault='active';await send('Stop this reply');await frame.locator('.wd-send[data-mode="stop"]').click();await settle();await frame.locator('.wd-close').click();await open();assert.equal(db.get(id).active,false);assert.equal(await frame.locator('.wd-send').getAttribute('data-mode'),'send');assert.equal(await textarea.isDisabled(),false);
 await page.screenshot({path:path.join(out,`${width}-${skin}-recovered-answer.png`)});
 // Changing chapter while the opener is loading invalidates the old generation.
 control.delay=5500;await frame.evaluate(id=>{WisdomDiscussion.open({id});},id);const other=data.entries.find(e=>e.id!==entry.id);assert(other);await frame.evaluate(id=>Wisdom.navigate('/read/'+id),other.id);await hidden(frame);await sleep(5700);assert.equal(await frame.evaluate(()=>WisdomDiscussion.isOpen()),false);
 // A newer selection owns the overlay even when an older hydration finishes last.
 control.delay=5500;const a={entry_id:other.id,body_sha256:other.body_sha256,start:0,end:16,text:'First selection.'},b={...a,start:20,end:37,text:'Second selection.'};await frame.evaluate(a=>{WisdomDiscussion.open(a)},a);await sleep(50);control.delay=0;await frame.evaluate(b=>WisdomDiscussion.open(b),b);await sleep(5700);assert.equal(await frame.locator('.wd-quote blockquote').textContent(),b.text);
 // Deliver hosted Back through the unchanged shared services/client contract.
 // These latency/recovery cases target the independent reader sheet. Connecting
 // services earlier advertises the *different* Chats bridge (threadAgents=true).
 // Mount only once sheet hydration has really started, never fake that capability
 // or replace the shared client. Existing-ui separately tests activated browser Back.
 await frame.locator('.wd-close').click();await hidden(frame);await frame.evaluate(id=>Wisdom.navigate('/read/'+id),entry.id);await frame.locator('.wb-reader').waitFor();await frame.evaluate(()=>document.fonts.ready);await sleep(350);
 const readerBefore=await frame.evaluate(()=>{window.__qaReaderDocument=document;return{url:location.href,track:document.querySelector('.wb-track').style.transform}}),hostBefore=page.url();
 control.delay=5500;const hydration=page.waitForRequest(r=>r.method()==='GET'&&new URL(r.url()).pathname==='/api/discussions/'+id);
 await frame.evaluate(id=>{WisdomDiscussion.open({id})},id);await hydration;assert((await frame.locator('.wd-status').textContent()).includes('Opening saved discussion'));
 await page.evaluate(()=>{const f=document.querySelector('iframe');window.__qaDetachServices=WizAppServices.attach(f,{appId:'wisdom-qa',path:'/index.html',isVisible:()=>true,isFront:()=>true});});
 assert.equal((await frame.evaluate(()=>WizardApp.ready())).hosted,true);assert.equal(await frame.evaluate(()=>WizardApp.hosted),true);
 assert.deepEqual(await page.evaluate(()=>{const f=document.querySelector('iframe');return{authorized:WizAppServices.authorized(f),ready:WizAppServices.inspect().find(s=>s.appId==='wisdom-qa')?.ready}}),{authorized:true,ready:true});
 const backResult=await page.evaluate(()=>WizAppServices.back(document.querySelector('iframe')));assert.equal(backResult,'handled');await hidden(frame);await sleep(5700);assert.equal(await frame.evaluate(()=>WisdomDiscussion.isOpen()),false);assert.equal(await frame.locator('.wb-reader').count(),1);assert.equal(page.url(),hostBefore);
 assert.deepEqual(await frame.evaluate(()=>({url:location.href,track:document.querySelector('.wb-track').style.transform})),readerBefore);assert.equal(await frame.evaluate(()=>window.__qaReaderDocument===document),true);
 checks.push({width,skin,backRoute:'WizAppServices.back -> registered WizardApp client',result:backResult,loading:true,lateResponseStayedClosed:true,sameReaderDocument:true});
 await page.screenshot({path:path.join(out,`${width}-${skin}-after-host-back.png`)});
 await page.evaluate(()=>window.__qaDetachServices());assert.equal((await frame.evaluate(()=>WizardApp.ready())).hosted,false);assert.equal(await frame.evaluate(()=>WizardApp.hosted),false);
 // A lost create response must not orphan the provisional anchor draft on reload.
 control.delay=200;control.openFault=true;const c={entry_id:entry.id,body_sha256:entry.body_sha256,start:80,end:97,text:'Third selection.'};await frame.evaluate(c=>{WisdomDiscussion.open(c)},c);await frame.locator('textarea').fill('Question written before the create response');await ready(frame);await Promise.all([frame.waitForNavigation({waitUntil:'domcontentloaded'}),frame.evaluate(()=>location.reload())]);await frame.locator('.wb-reader').waitFor();control.delay=0;await frame.evaluate(()=>WisdomDiscussion.refresh());await frame.evaluate(c=>WisdomDiscussion.open(c),c);assert.equal(await frame.locator('textarea').inputValue(),'Question written before the create response');
 await page.screenshot({path:path.join(out,`${width}-${skin}-anchor-draft-reloaded.png`)});
 checks.push({width,skin,recovery:'drop request/response + replay IDs; failed inference fresh ID; 503; real 12s timeout; hung readback; newer edit; offline/online; quota; Stop; chapter invalidation',acceptedTurns:db.get(id).messages.filter(m=>m.role==='user').length});
 await context.tracing.stop({path:path.join(out,`${width}-${skin}.zip`)});await context.close();
}
(async()=>{
 fixture=spawn(process.env.PYTHON||'python3',['-m','qa.discussions_recovery_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture startup timeout')),30000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',s=>{clearTimeout(t);resolve(JSON.parse(s))})});
 try{browser=await chromium.launch({headless:true});for(const width of [390,1280])for(const skin of ['nebula','signal'])await scenario(info.url,width,skin);assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({status:baseline?'baseline-rejected':'pass',fixture:info,scope:'UI contract only; synthetic discussions; real reader and shared app-client/services/appearance host proxy; late-mounted services for Back seam, not installed-shell or Chats-route proof; no provider writes',checks,errors},null,2));console.log(JSON.stringify(checks));}
 catch(e){if(lastPage&&!lastPage.isClosed())await lastPage.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(e),stack:e.stack,checks,errors},null,2));throw e;}
 finally{await browser?.close();fixture.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1});
