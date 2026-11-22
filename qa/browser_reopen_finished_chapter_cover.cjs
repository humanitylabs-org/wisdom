// James (22 Nov 2026): "If I reopen a chapter I've already finished, clearly I want to start the chapter, not look at
// its end-screen." Opening a chapter whose saved place resolves to its last page (this device's place 1 or 0.96,
// synced progress 100, or an end place on a library snapshot that predates the done write) opens its COVER (1 / N),
// and opening a finished or read chapter on its cover saves nothing (no device place or server progress overwrite) until a page is turned. A chapter left
// part-way, including a re-read in progress, still resumes. Opens: collection page (touch tap), deep link (Morning's
// Read pick and Home links are deep links) and the reload/frame-recreation resume. Also: A+/A− on the end page keeps
// the end page; Back from a chapter's cover still lands on the previous chapter's last page; one swipe = one page.
// Standalone 360 + 412 and a same-origin frame at 360 (as in Morning). Real HTTP fixture + shared WizardApp core.
// Env: PLAYWRIGHT_DIR, WISDOM_QA_CORE, WISDOM_QA_EVIDENCE [, WISDOM_QA_BROWSER, PYTHON, WIDTHS]
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert');
const SEEDS={
 local_end:{read:true,progress:100,local:'1',cover:true},
 local_near_end:{read:true,progress:100,local:'0.96',cover:true},
 server100:{read:true,progress:100,cover:true},
 local_cover:{read:true,progress:100,local:'0',cover:true}, // read; this device last left it on its cover: no progress 0 write
 stale_unread_end:{read:false,progress:0,local:'1',cover:true},
 mid:{read:false,progress:50,local:'0.5'},
 reread:{read:true,progress:40,local:'0.4'},
};
const OPENS=['collection','link','resume'];
(async()=>{
 const evidence=process.env.WISDOM_QA_EVIDENCE;fs.mkdirSync(evidence,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_chapters_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 let browser;const failures=[],rows=[];
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),15000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',l=>{clearTimeout(t);resolve(JSON.parse(l))})});
  const base=info.url;
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const widths=(process.env.WIDTHS||'360,412').split(',').map(Number);
  const cases=[];for(const framed of [false,true])for(const width of framed?widths.slice(0,1):widths){for(const [s,seed] of Object.entries(SEEDS))for(const open of OPENS)cases.push({framed,width,s,seed,open});cases.push({framed,width,flow:'size_on_end'},{framed,width,flow:'back_from_cover'})}
  for(const k of cases){
   const {framed,width}=k;const label=`${framed?'frame':'standalone'}-${width}-`+(k.flow||`${k.s}-${k.open}`);
   const ctx=await browser.newContext({viewport:{width,height:width<400?780:900},isMobile:true,hasTouch:true});
   await ctx.route(base+'qa-host.html',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name=viewport content="width=device-width"><style>body{margin:0}header{height:56px}iframe{position:fixed;top:56px;left:0;width:100%;height:calc(100% - 56px);border:0}</style><header>Morning</header><iframe id=frame></iframe>'}));
   // A reload / shell frame recreation within a minute of leaving the open chapter (restoreRoute's resume).
   await ctx.addInitScript(()=>{try{const h=location.protocol.startsWith('http')&&!location.pathname.endsWith('qa-host.html')&&localStorage.getItem('qa-resume');if(h){localStorage.removeItem('qa-resume');sessionStorage.setItem('wisdom:'+new URL('.',location.href).pathname+':open',JSON.stringify({hash:h,at:Date.now()}))}}catch{}});
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const posts=[];page.on('request',q=>{if(q.method()==='POST'&&q.url().includes('api/wisdom/reaction'))try{posts.push(q.postDataJSON())}catch{}});
   const row={label};rows.push(row);
   try{
    const data=await (await fetch(base+'api/wisdom')).json();
    const col=data.collections.find(c=>c.entries.filter(i=>i!==c.overview).length>=3);assert(col,'fixture needs a 3-chapter collection');
    const chapters=col.entries.filter(i=>i!==col.overview),A=chapters[0],B=chapters[1];
    const pk=id=>'wisdom:/:pos:'+id;
    // Seed B on the disposable server before this browser loads anything (so no cached library predates it), then
    // this device's saved places.
    const seedB=async seed=>{const post=async b=>{const r=await fetch(base+'api/wisdom/reaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});assert(r.ok,'seed '+r.status)};
     await post({kind:'entry',id:B,field:'read',value:false});await post({kind:'entry',id:B,field:'archived',value:false});
     if(seed.read)await post({kind:'entry',id:B,field:'done',value:true});
     await post({kind:'entry',id:B,field:'progress',value:seed.progress});
     await page.goto(base);await page.waitForSelector('.wb-home');
     await page.evaluate(([kA,kB,local])=>{localStorage.setItem(kA,'0');if(local===undefined)localStorage.removeItem(kB);else localStorage.setItem(kB,local)},[pk(A),pk(B),seed.local])};
    let fr=page,off={x:0,y:0};
    const openUrl=async url=>{
     await page.goto('about:blank');
     if(!framed){await page.goto(url);fr=page;return}
     await page.goto(base+'qa-host.html');await page.evaluate(src=>{document.getElementById('frame').src=src},url);
     fr=null;for(let i=0;i<100&&!(fr=page.frames().find(f=>f!==page.mainFrame()&&f.url().startsWith(base)&&!f.url().includes('qa-host')));i++)await page.waitForTimeout(50);
     assert(fr,'frame loaded');const b=await page.locator('#frame').boundingBox();off={x:b.x,y:b.y};
    };
    const state=()=>fr.evaluate(()=>{const r=document.querySelector('.wb-reader');return {id:r?.dataset.read,at:r?.dataset.at,count:r?.querySelector('.wb-count')?.textContent,hash:location.hash}});
    const ready=async id=>{await fr.waitForSelector(`.wb-reader[data-read="${id}"] .wb-count`,{timeout:10000});await fr.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350)};
    const stage=async()=>{const b=await fr.evaluate(()=>{const s=document.querySelector('.wb-stage').getBoundingClientRect();return {x:s.left,y:s.top,w:s.width,h:s.height}});return {x:b.x+off.x,y:b.y+off.y,w:b.w,h:b.h}};
    const cdp=await ctx.newCDPSession(page);
    const swipe=async(dir=1)=>{const b=await stage(),y=b.y+b.h*.45,x0=b.x+b.w*(dir>0?.8:.2);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0-dir*i*28,y:y+i%2}]});await page.waitForTimeout(16)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})};
    const num=s=>s.count.split(' / ').map(Number);
    const posOf=id=>fr.evaluate(k=>localStorage.getItem(k),pk(id));
    const openB=async open=>{
     if(open==='collection'){await openUrl(base+`#/collection/${col.id}`);const sel=`.wb-toc [data-wisdom-route="/read/${B}/${col.id}"]`;await fr.waitForSelector(sel);await fr.locator(sel).first().tap()}
     else if(open==='link')await openUrl(base+`#/read/${B}/${col.id}`);
     else{await page.evaluate(h=>localStorage.setItem('qa-resume',h),`#/read/${B}/${col.id}`);await openUrl(base)}
     await ready(B);const early=await state();await page.waitForTimeout(900);return [early,await state()];
    };
    if(!k.flow){
     const seed=k.seed;await seedB(seed);const n0=posts.length;
     const [early,s]=await openB(k.open);row.opened=s.count;
     await page.screenshot({path:path.join(evidence,label+'.png')});
     assert.equal(s.id,B);assert.equal(early.count,s.count,`${label}: no later relayout moves it (${early.count} → ${s.count})`);
     const [p,n]=num(s);
     if(seed.cover){
      assert.equal(p,1,`${label}: a finished chapter reopens on its cover (got ${s.count})`);assert.equal(s.at,'opener');
      assert.equal(await posOf(B),seed.local??null,`${label}: opening kept this device's saved place`);
      assert.deepEqual(posts.slice(n0).filter(b=>b.id===B),[],`${label}: opening wrote nothing for the chapter`);
      // The re-read starts on the first turn: one swipe = one page, and it saves as normal.
      await swipe(1);await page.waitForTimeout(500);const s2=await state();assert.equal(num(s2)[0],2,`${label}: one swipe from the cover = page 2 (${s2.count})`);
      assert.equal(Number(await posOf(B)),1/(n-1),`${label}: the first page turn saves the place`);
      await page.waitForTimeout(300);assert(posts.slice(n0).some(b=>b.id===B&&b.field==='progress'),`${label}: the first page turn syncs progress`);
     }else{
      const want=Math.round(Number(seed.local)*(n-1))+1;
      assert.equal(p,want,`${label}: a chapter left part-way resumes its place (${s.count}, want ${want})`);assert.notEqual(s.at,'end');
     }
    }else if(k.flow==='size_on_end'){
     // Finish B in this session, then change the text size on its end page: it stays on the end page. Reopening it
     // afterwards opens the cover.
     await seedB(SEEDS.mid);let [,s]=await openB('link');
     await fr.evaluate(()=>{document.body.tabIndex=-1;document.body.focus()});
     for(let i=0;i<80&&s.at!=='end';i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(80);s=await state()}
     assert.equal(s.at,'end',`${label}: reached B's end`);await page.waitForTimeout(400);
     for(const d of ['1','-1','-1','1']){const b=fr.locator(`[data-wisdom-size="${d}"]`);if(await b.isDisabled())continue;await b.tap();await fr.evaluate(()=>document.fonts.ready);await page.waitForTimeout(600);s=await state();assert.equal(s.at,'end',`${label}: A${d==='1'?'+':'−'} on the end page stayed on the end page (${s.count})`)}
     await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.waitForTimeout(500);s=await state();assert.equal(s.at,'end',`${label}: a resize on the end page stays on the end page`);row.size_end=s.count;
     await page.screenshot({path:path.join(evidence,label+'-end.png')});
     [,s]=await openB('link');assert.equal(num(s)[0],1,`${label}: reopening the chapter just finished opens its cover (${s.count})`);row.reopened=s.count;
    }else{
     // Back from B's cover (B finished, opened on its cover) lands on A's last page, not A's cover.
     await seedB(SEEDS.local_end);let [,s]=await openB('link');assert.equal(num(s)[0],1);
     await swipe(-1);await ready(A);await page.waitForTimeout(700);s=await state();row.back=s.count;
     assert.equal(s.id,A);assert.equal(s.at,'end',`${label}: Back from B's cover lands on A's last page (${s.count})`);
     await page.screenshot({path:path.join(evidence,label+'.png')});
    }
    assert.deepEqual(errors,[]);row.pass=true;
   }catch(e){row.pass=false;row.error=e.message;failures.push(label+': '+e.message.split('\n')[0]);try{await page.screenshot({path:path.join(evidence,label+'-fail.png')})}catch{}}
   console.log((row.pass?'ok   ':'FAIL ')+label+(row.opened?` → ${row.opened}`:'')+(row.back?` back → ${row.back}`:'')+(row.reopened?` end ${row.size_end}, reopened → ${row.reopened}`:'')+(row.error?' :: '+row.error.split('\n')[0]:''));
   await ctx.close();
  }
  let head='';try{head=require('child_process').execSync('git rev-parse HEAD').toString().trim()}catch{}
  fs.writeFileSync(path.join(evidence,'reopen-finished-chapter-cover.json'),JSON.stringify({head,core_sha256:info.core_sha256,rows,failures},null,1));
  if(failures.length){console.error(`FAIL reopen finished chapter cover: ${failures.length}/${rows.length}\n`+failures.join('\n'));process.exitCode=1}
  else console.log(`PASS reopen finished chapter cover: ${rows.length} cases (device end/near-end, server 100, stale unread end → cover saving nothing; mid + re-read resume; collection tap, deep link, reload resume; A+/A− on end page; Back from cover; standalone + frame)`);
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exit(1)});
