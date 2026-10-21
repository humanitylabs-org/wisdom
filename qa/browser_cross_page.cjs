// Real CDP touch input, actual HTTP persistence, synthetic disposable library only.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn,execFileSync}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
(async()=>{
 const out=process.env.WISDOM_QA_EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-c','from qa.browser_epigraph_fixture import main; main(300)'],{env:process.env,stdio:['ignore','pipe','inherit']});
 const exited=new Promise(r=>fixture.once('exit',r));let browser;
 const results=[];
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture timeout')),15000);fixture.once('exit',c=>reject(Error('Fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',s=>{clearTimeout(t);resolve(JSON.parse(s))})});
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  for(const width of [390,360,1280]){
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width<600,hasTouch:true});
   const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/wisdom/highlight'))writes.push(r.postDataJSON())});
   await page.addInitScript(()=>{window.touchProof=[];for(const name of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(name,e=>window.touchProof.push({type:e.type,trusted:e.isTrusted,pointerType:e.pointerType,time:performance.now(),x:e.clientX,y:e.clientY}),true)});
   const state=async()=> (await context.request.get(info.url+'api/wisdom')).json();
   const cdp=await context.newCDPSession(page);
   const wait=ms=>page.waitForTimeout(ms);
   const touch=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y}]:[]});
   const move=p=>touch('touchMove',p),lift=()=>touch('touchEnd');
   const count=async()=> (await page.locator('.wb-count').textContent()).split(' / ').map(Number);
   const number=async()=> (await count())[0];
   const seek=async n=>{while(await number()!==n){await page.keyboard.press(await number()<n?'ArrowRight':'ArrowLeft');await wait(360)}};
   const visible=()=>page.locator('.wb-flow').evaluate(flow=>{
    const walker=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT),out=[];let n,pos=0;
    while(n=walker.nextNode()){
     const para=n.parentElement.closest('p');
     for(const m of n.nodeValue.matchAll(/\S+/g)){
      const rg=document.createRange();rg.setStart(n,m.index);rg.setEnd(n,m.index+m[0].length);
      const q=[...rg.getClientRects()].find(q=>q.width&&q.left>=0&&q.right<=innerWidth&&q.top>70&&q.bottom<innerHeight-55);
      if(q&&para?.textContent.startsWith('Read slowly'))out.push({x:q.x+q.width/2,y:q.y+q.height/2,start:pos+m.index,end:pos+m.index+m[0].length,text:m[0]});
     }pos+=n.nodeValue.length;
    }return out;
   });
   const corner={x:width-12,y:880},leftCorner={x:12,y:880};
   const fresh=async()=>{
    for(const h of (await state()).highlights){const r=await context.request.post(info.url+'api/wisdom/highlight',{data:{action:'remove',id:h.id}});assert.equal(r.status(),200)}
    await page.goto('about:blank');await page.goto(info.url+'#/read/example-chapter');await page.waitForSelector('.wb-reader');await wait(550);await seek(3);writes.length=0;
   };
   // A real finger never holds perfectly still: 1-2 px moves during the hold transfer the browser's
   // implicit pointer capture. They must not cancel the selection (regression of 17 Oct 2026).
   const begin=async p=>{await touch('touchStart',p);await wait(150);await move({x:p.x+1,y:p.y});await wait(150);await move({x:p.x+1,y:p.y+1});await wait(200);await move({x:p.x,y:p.y+1});await wait(60);assert(await page.locator('mark.sel').count()>0,'long press with finger jitter enters blue pending selection')};
   const saveCheck=async(a,b)=>{
    await lift();await page.waitForFunction(()=>!!document.querySelector('[data-hl-act="remove"]:not([hidden])'));
    for(let i=0;i<30&&(await state()).highlights.length===0;i++)await wait(50);
    const all=(await state()).highlights;assert.equal(all.length,1);assert.equal(writes.length,1);
    const h=all[0];assert.equal(h.start,Math.min(a.start,b.start));assert.equal(h.end,Math.max(a.end,b.end));
    const expected=await page.locator('.wb-flow').evaluate((f,h)=>f.textContent.slice(h.start,h.end),h);assert.equal(h.text,expected);
    return h;
   };
   const report=async(name,extra={})=>{assert.deepEqual(errors,[]);const events=await page.evaluate(()=>window.touchProof);assert((events.length||name.startsWith('reload'))&&events.every(e=>e.trusted&&e.pointerType==='touch'));results.push({width,name,pass:true,...extra,events});console.log('PASS',width,name)};
   await fresh();let words=await visible(),a=words[10];assert(a);await begin(a);await move(corner);const before=await number(),started=Date.now();
   await wait(850);assert.equal(await number(),before,'must not turn before dwell');assert.equal(writes.length,0);
   const noTurnElapsedMs=Date.now()-started;
   await wait(220);assert.equal(await number(),before+1,'must turn without lifting');assert.equal(writes.length,0);
   const turnedElapsedMs=Date.now()-started;
   let b=(await visible())[14];assert(b);await move(b);await wait(30);
   await page.screenshot({path:path.join(out,`drag-${width}.png`)});
   const saved=await saveCheck(a,b);await wait(1100);assert.equal(await number(),before+1,'lift cancels repeated dwell');
   await page.screenshot({path:path.join(out,`saved-${width}.png`)});
   assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true);assert.equal(await page.locator('.wb-flow').evaluate(f=>getComputedStyle(f).userSelect),'none');
   await report('cross-page contiguous save',{before,after:before+1,range:{start:saved.start,end:saved.end},noTurnElapsedMs,turnedElapsedMs});
   await page.reload();await page.waitForSelector('.wb-reader');await wait(550);assert.equal(await number(),before+1);assert.equal((await state()).highlights[0].id,saved.id);assert(await page.locator('mark.wb-hl').count()>0);
   await report('reload retains range and page');
   if(width!==390){await context.close();continue}
   for(const length of [4,5]){
    await fresh();words=await visible();a=words[10];b=words[10+length-1];await begin(a);await move(b);await lift();await wait(200);
    assert.equal(writes.length,length<5?0:1);assert.equal((await state()).highlights.length,length<5?0:1);
    assert.equal(await page.locator('mark.sel').count()>0,length<5);assert.equal(await number(),3);await report(length+' word direct selection threshold unchanged');
   }
   await fresh();words=await visible();await begin(words[10]);await move(corner);await wait(450);await touch('touchCancel');await wait(1100);assert.equal(await number(),3);assert.equal(writes.length,0);assert.equal(await page.locator('mark[data-hl="live"]').count(),0);await report('pointercancel inside corner cancels armed dwell without save');
   await fresh();words=await visible();a=words[10];await begin(a);await move(corner);await wait(500);await move(words[18]);await wait(650);assert.equal(await number(),3);assert.equal(writes.length,0);await touch('touchCancel');await wait(1050);assert.equal(await number(),3);assert.equal(writes.length,0);assert.equal(await page.locator('mark[data-hl="live"]').count(),0);
   await report('leaving corner and pointercancel cancel dwell without save');
   await fresh();words=await visible();await begin(words[10]);await move(corner);await wait(450);await lift();await wait(1100);assert.equal(await number(),3);assert.equal(writes.length,1);
   await report('lift before dwell saves current range but never turns');
   await fresh();words=await visible();a=words[10];await begin(a);await lift();assert.equal(writes.length,0);assert.equal(await page.locator('.wb-handle:not([hidden])').count(),2);
   let handle=await page.locator('.wb-handle.e').boundingBox();await touch('touchStart',{x:handle.x+handle.width/2,y:handle.y+handle.height/2});await move(corner);await wait(1070);assert.equal(await number(),4);b=(await visible())[16];await move({...b,y:b.y+24});await lift();await wait(1100);assert.equal(writes.length,0);assert.equal((await state()).highlights.length,0);assert(await page.locator('mark.sel').count()>0);assert.equal(await page.locator('.wb-handle:not([hidden])').count(),2);assert(await page.locator('[data-hl-act="highlight"]').isVisible());
   await page.screenshot({path:path.join(out,'pending-handles.png')});await report('pending handle cross-page expansion stays blue and never autosaves');
   // Explicit save, then adjust a saved handle across another page.
   {const button=await page.locator('[data-hl-act="highlight"]').boundingBox();await page.touchscreen.tap(button.x+button.width/2,button.y+button.height/2)}await wait(250);assert.equal((await state()).highlights.length,1);writes.length=0;
   handle=await page.locator('.wb-handle.e').boundingBox();await touch('touchStart',{x:handle.x+handle.width/2,y:handle.y+handle.height/2});await move(corner);await wait(1070);assert.equal(await number(),5);b=(await visible())[15];await move({...b,y:b.y+24});await lift();await wait(250);assert.equal(writes.length,1);assert.equal((await state()).highlights.length,1);assert.equal((await state()).highlights[0].start,a.start);assert((await state()).highlights[0].end>b.start);
   await report('saved handle extends across page with one merged save');
   await fresh();words=await visible();a=words[10];await begin(a);await move(corner);await wait(2050);assert.equal(await number(),5);b=(await visible())[12];await move(b);await saveCheck(a,b);await report('stationary multi-page continuation');
   await fresh();await seek(5);words=await visible();a=words[15];await begin(a);await move(leftCorner);await wait(1070);assert.equal(await number(),4);b=(await visible())[12];await move(b);await saveCheck(a,b);await report('previous corner preserves reverse contiguous range');
   await fresh();await seek((await count())[1]-1);words=await visible();assert(words.length);await begin(words[0]);await move(corner);const last=await number();await wait(2050);assert.equal(await number(),last);assert.equal(new URL(page.url()).hash,'#/read/example-chapter');await touch('touchCancel');assert.equal(writes.length,0);await report('last body page never opens end card or wraps chapter');
   await fresh();words=await visible();await begin(words[10]);await move(leftCorner);await wait(1070);assert.equal(await number(),3);await touch('touchCancel');await report('first body page cannot cross into epigraph');
   await fresh();await touch('touchStart',{x:width-15,y:400});await lift();await wait(450);assert.equal(await number(),4);await touch('touchStart',{x:70,y:450});await move({x:200,y:450});await lift();await wait(450);assert.equal(await number(),3);assert.equal(writes.length,0);await report('normal touch tap and swipe unaffected');
   await fresh();words=await visible();await begin(words[10]);await move(corner);await wait(350);await page.keyboard.press('ArrowRight');await wait(1100);assert.equal(await number(),4);await lift();assert.equal(writes.length,0);await report('page navigation cancels active dwell and gesture');
   await fresh();words=await visible();await begin(words[10]);await move(corner);await wait(350);await page.setViewportSize({width:width+20,height:900});await wait(350);const resized=await number();await wait(1000);assert.equal(await number(),resized);await lift();assert.equal(writes.length,0);await report('resize cancels stale gesture geometry');await page.setViewportSize({width,height:900});
   await fresh();words=await visible();await begin(words[10]);await move(corner);await wait(350);await page.goBack();await wait(1100);await lift();assert.equal(writes.length,0);assert(!new URL(page.url()).hash.includes('/read/'));assert(await page.locator('body').isVisible());await report('browser Back cancels dwell and remains in app');
   assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true);await context.close();
  }
  const assets=Object.fromEntries(['static/wisdom.js','static/wisdom.css','qa/browser_cross_page.cjs'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
  const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  fs.writeFileSync(path.join(out,'cross-page.json'),JSON.stringify({host:require('os').hostname(),commit,assets,core_sha256:info.core_sha256,results},null,2));
  console.log('PASS all',results.length,'cross-page checks');
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM');await exited}
})().catch(e=>{console.error(e);process.exitCode=1});
