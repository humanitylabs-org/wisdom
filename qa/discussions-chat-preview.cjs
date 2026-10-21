/* Hosted candidate preview of the chat-style Discuss with AI sheet (Thales, real tailnet shell).
 * Candidate discussions.{css,js} are intercepted from QA_ASSET_DIR; every non-GET is intercepted,
 * so owner data is untouched. Captures empty, typing and conversation states at phone widths.
 * PLAYWRIGHT_DIR=... QA_ASSET_DIR=.../static EVIDENCE=... node qa/discussions-chat-preview.cjs
 */
const {chromium,devices}=require(process.env.PLAYWRIGHT_DIR),fs=require('fs'),path=require('path'),assert=require('assert');
const BASE=process.env.WISDOM_HOST_URL||'https://wizard.tailc0f369.ts.net/wizard-os-home/?open=wisdom';
const out=process.env.EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
const thread=(post,messages)=>({id:'chat-preview',entry_id:post.entry_id,chapter_title:'The name is not the thing',quote:'',body_sha256:post.body_sha256,start:0,end:0,scope:'chapter',messages,active:false,web_enabled:true,configured:true,model:'Claude'});
const convo=[{id:'u1',role:'user',state:'done',content:'What is the one big idea of this chapter, in plain language?'},
 {id:'a1',role:'assistant',state:'done',content:'Words point at reality; they are not reality.\n\nLaozi opens by warning that any **name** you give the Way is already smaller than the Way itself. The label is useful for talking, but it can trick you into thinking you have grasped the thing.\n\n- Naming creates the “ten thousand things”\n- Desire lets you see the edges; stillness lets you see the mystery',sources:[{title:'The chapter',text:'Stored chapter excerpt'}]},
 {id:'u2',role:'user',state:'done',content:'How would I apply that this week?'}];
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});const receipt=[];
 try{for(const width of [360,412]){
  const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width,height:860}});let withMessages=false;const blocked=[];
  for(const ext of ['css','js'])await ctx.route(`**/wisdom/discussions.${ext}*`,r=>r.fulfill({contentType:ext==='css'?'text/css':'application/javascript',body:fs.readFileSync(path.join(process.env.QA_ASSET_DIR,`discussions.${ext}`),'utf8')}));
  await ctx.route('**/wisdom/api/**',async route=>{const q=route.request();const p=new URL(q.url()).pathname.replace(/^\/wisdom\//,'');
   if(q.method()==='GET'&&p==='api/discussions/chat-preview')return route.fulfill({contentType:'application/json',body:JSON.stringify(thread({},withMessages?convo:[]))});
   if(q.method()==='GET')return route.continue();blocked.push(p);
   if(p==='api/discussions')return route.fulfill({contentType:'application/json',body:JSON.stringify(thread(q.postDataJSON(),withMessages?convo:[]))});
   return route.fulfill({contentType:'application/json',body:'{}'})});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE);let el=await page.waitForSelector('iframe[src*="/wisdom/"]');let frame=await el.contentFrame();await frame.waitForSelector('.wb-home',{timeout:30000});
  for(const h of await page.locator('iframe[src*="/wisdom/"]').elementHandles()){const b=await h.boundingBox();if(b&&b.x>=0&&b.x<width){el=h;frame=await h.contentFrame();break}}
  const served=await frame.evaluate(async()=>(await(await fetch('discussions.css',{cache:'no-store'})).text()).includes('Chat layout'));assert(served,'candidate css not intercepted');
  const d=await frame.evaluate(async()=>await(await fetch('api/wisdom')).json());const col=d.collections.find(c=>c.entries.length>=2);const A=col.entries[0];
  await frame.locator(`[data-wisdom-route="/collection/${col.id}"]`).first().tap();await frame.waitForSelector(`[data-wisdom-route="/read/${A}/${col.id}"]`,{timeout:15000});
  await frame.locator(`[data-wisdom-route="/read/${A}/${col.id}"]`).first().tap();await frame.waitForSelector(`.wb-reader[data-read="${A}"]`,{timeout:15000});await page.waitForTimeout(800);
  const open=async()=>{await frame.evaluate(()=>WisdomDiscussion.open({scope:'chapter'}));await frame.waitForFunction(()=>!document.querySelector('.wd-composer textarea').disabled);await page.waitForTimeout(500)};
  await open();
  const m=await frame.evaluate(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();const st=document.querySelector('.wd-status');
   return{vh:innerHeight,panel:r('.wd-panel'),composer:r('.wd-composer'),send:r('.wd-send'),web:r('.wd-web'),textarea:r('.wd-composer textarea'),statusVisible:!st.hidden&&!!st.textContent,status:st.textContent,
    disclaimer:document.body.innerText.includes('AI can be mistaken'),sendLabel:document.querySelector('.wd-send').textContent,chips:[...document.querySelectorAll('.wd-chip')].map(b=>b.textContent)}});
  await page.screenshot({path:path.join(out,`${width}-empty.png`)});
  assert(!m.disclaimer,'disclaimer still present');assert(m.panel.height<m.vh*0.5,'empty sheet should be compact: '+m.panel.height);
  assert(m.composer.height<=56,'composer should be one line: '+m.composer.height);assert.equal(m.sendLabel,'Send');
  await frame.locator('.wd-chip').first().tap();await page.waitForTimeout(400);await page.screenshot({path:path.join(out,`${width}-chip-filled.png`)});
  const filled=await frame.evaluate(()=>({value:document.querySelector('.wd-composer textarea').value,send:!document.querySelector('.wd-send').disabled}));assert(filled.value&&filled.send);
  await frame.locator('.wd-web').tap();const webOn=await frame.evaluate(()=>document.querySelector('.wd-web input').checked);
  await frame.locator('.wd-web').tap();
  await frame.evaluate(()=>WisdomDiscussion.close());withMessages=true;await open();await page.screenshot({path:path.join(out,`${width}-conversation.png`)});
  const c=await frame.evaluate(()=>{const u=document.querySelector('.wd-user').getBoundingClientRect(),p=document.querySelector('.wd-panel').getBoundingClientRect();return{userRight:p.right-u.right,userWidth:u.width,panelWidth:p.width,roles:document.querySelectorAll('.wd-role').length}});
  assert(c.userRight<40&&c.userWidth<c.panelWidth*0.9,'user bubble right-aligned');assert.equal(c.roles,0);
  await frame.evaluate(()=>WisdomDiscussion.back());const closed=await frame.evaluate(()=>!WisdomDiscussion.isOpen()&&!!document.querySelector('.wb-reader'));assert(closed);
  assert.deepEqual(errors,[]);receipt.push({width,metrics:m,webToggle:webOn,conversation:c,blocked});await ctx.close();
 }}finally{await browser.close()}
 fs.writeFileSync(path.join(out,'chat-preview.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt.map(r=>({w:r.width,panelH:Math.round(r.metrics.panel.height),vh:r.metrics.vh,composerH:Math.round(r.metrics.composer.height),web:r.webToggle,blocked:r.blocked}))));
})().catch(e=>{console.error(e);process.exitCode=1});
