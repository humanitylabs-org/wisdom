// wisdom#16 (James, 18 + 22 Nov 2026): forward from a chapter's last page must open the NEXT chapter's cover
// (counter 1 / N), whatever place that chapter saved earlier. Real cause: the forward turn opened the next chapter
// through the ordinary "restore saved place" path, so a chapter read or partly read before (server progress < 100,
// or this device's `wisdom:<path>:pos:<id>` near the end) opened mid-way or on its last page.
// Covers: next chapter unread / partly read / read with progress 100 / local saved end and near-end place,
// standalone and inside a same-origin frame (as in Morning); finger swipe (CDP touch), ArrowRight and right-edge
// tap; one swipe moves exactly one page; Back from the cover still lands on the previous chapter's last page;
// opening a chapter from its collection page still resumes its saved place.
// Real HTTP fixture + shared WizardApp core, disposable data.
// Env: PLAYWRIGHT_DIR, WISDOM_QA_CORE, WISDOM_QA_EVIDENCE [, WISDOM_QA_BROWSER, PYTHON, WIDTHS]
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert');
const SEEDS={
 unread:{read:false,progress:0},
 partial:{read:false,progress:40,resume:true},
 read_mid:{read:true,progress:88},
 read100:{read:true,progress:100},
 local_end:{read:true,progress:100,local:'1'},
 local_near_end:{read:true,progress:0,local:'0.96'},
 local_mid:{read:false,progress:0,local:'0.5',resume:true},
};
const INPUTS=['swipe','arrow','tap'];
(async()=>{
 const evidence=process.env.WISDOM_QA_EVIDENCE;fs.mkdirSync(evidence,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_chapters_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 let browser;const failures=[],rows=[];
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),15000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',l=>{clearTimeout(t);resolve(JSON.parse(l))})});
  const base=info.url;
  browser=await chromium.launch({headless:true,channel:process.env.WISDOM_QA_BROWSER||'chrome'});
  const widths=(process.env.WIDTHS||'360,412').split(',').map(Number);
  for(const framed of [false,true])for(const width of framed?widths.slice(0,1):widths)for(const [seedName,seed] of Object.entries(SEEDS))for(const input of INPUTS){
   const label=`${framed?'frame':'standalone'}-${width}-${seedName}-${input}`;
   const ctx=await browser.newContext({viewport:{width,height:width<400?780:900},isMobile:true,hasTouch:true});
   await ctx.route(base+'qa-host.html',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name=viewport content="width=device-width"><style>body{margin:0}header{height:56px}iframe{position:fixed;top:56px;left:0;width:100%;height:calc(100% - 56px);border:0}</style><header>Morning</header><iframe id=frame></iframe>'}));
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const row={label};rows.push(row);
   try{
    await page.goto(base);await page.waitForSelector('.wb-home');
    const data=await page.evaluate(async()=>(await fetch('api/wisdom')).json());
    const col=data.collections.find(c=>c.entries.filter(i=>i!==c.overview).length>=3);assert(col,'fixture needs a 3-chapter collection');
    const chapters=col.entries.filter(i=>i!==col.overview),A=chapters[0],B=chapters[1];
    // Seed B on the disposable server, and this device's saved places.
    await page.evaluate(async([B,seed])=>{const post=b=>fetch('api/wisdom/reaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
     await post({kind:'entry',id:B,field:'read',value:false});await post({kind:'entry',id:B,field:'archived',value:false});
     if(seed.read)await post({kind:'entry',id:B,field:'done',value:true});
     await post({kind:'entry',id:B,field:'progress',value:seed.progress})},[B,seed]);
    await page.evaluate(([A,B,local])=>{const k=id=>'wisdom:'+new URL('.',location.href).pathname+':pos:'+id;localStorage.setItem(k(A),'0');if(local===undefined)localStorage.removeItem(k(B));else localStorage.setItem(k(B),local)},[A,B,seed.local]);
    let fr=page,off={x:0,y:0};
    const openRoute=async hash=>{
     await page.goto('about:blank');
     if(!framed){await page.goto(base+hash);fr=page;return}
     await page.goto(base+'qa-host.html');await page.evaluate(src=>{document.getElementById('frame').src=src},base+hash);
     for(let i=0;i<100&&!(fr=page.frames().find(f=>f!==page.mainFrame()&&f.url().startsWith(base)&&!f.url().includes('qa-host')));i++)await page.waitForTimeout(50);
     assert(fr,'frame loaded');const b=await page.locator('#frame').boundingBox();off={x:b.x,y:b.y};
    };
    const state=()=>fr.evaluate(()=>{const r=document.querySelector('.wb-reader');return {id:r?.dataset.read,at:r?.dataset.at,count:r?.querySelector('.wb-count')?.textContent,hash:location.hash}});
    const ready=async id=>{await fr.waitForSelector(`.wb-reader[data-read="${id}"] .wb-count`,{timeout:10000});await fr.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350)};
    const settle=async id=>{await ready(id);await page.waitForTimeout(900);return state()};
    const stage=async()=>{const b=await fr.evaluate(()=>{const s=document.querySelector('.wb-stage').getBoundingClientRect();return {x:s.left,y:s.top,w:s.width,h:s.height}});return {x:b.x+off.x,y:b.y+off.y,w:b.w,h:b.h}};
    const cdp=await ctx.newCDPSession(page);
    const swipe=async(dir=1)=>{const b=await stage(),y=b.y+b.h*.45,x0=b.x+b.w*(dir>0?.8:.2);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0-dir*i*28,y:y+i%2}]});await page.waitForTimeout(16)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})};
    const key=async k=>{await fr.evaluate(()=>{document.body.tabIndex=-1;document.body.focus()});await page.keyboard.press(k)};
    const rightTap=async()=>{const pt=await fr.evaluate(()=>{const s=document.querySelector('.wb-stage').getBoundingClientRect();for(let fy=.12;fy<.95;fy+=.03)for(const fx of [.95,.9,.85,.8]){const x=s.left+s.width*fx,y=s.top+s.height*fy,el=document.elementFromPoint(x,y);if(el&&el.closest('.wb-stage')&&!el.closest('a,button,[role="button"],input,textarea'))return {x,y}}return null});assert(pt,'free right-edge point');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pt.x+off.x,y:pt.y+off.y}]});await page.waitForTimeout(50);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})};
    const num=s=>s.count.split(' / ').map(Number);
    // Opening B from its collection page resumes its saved place (only the forward turn ignores it).
    if(seed.resume&&input==='swipe'){
     await openRoute(`#/collection/${col.id}`);await fr.waitForSelector(`[data-wisdom-route="/read/${B}/${col.id}"]`);
     await fr.locator(`.wb-toc [data-wisdom-route="/read/${B}/${col.id}"]`).first().tap();
     const s=await settle(B);row.resume=s.count;const [p,n]=num(s);const want=Math.round((seed.local!==undefined?Number(seed.local):seed.progress/100)*(n-1))+1;
     assert.equal(p,want,`${label}: opening from the collection resumes the saved place (${s.count}, want ${want})`);
     await page.evaluate(()=>{});
     await fr.evaluate(([B,local])=>{const k='wisdom:'+new URL('.',location.href).pathname+':pos:'+B;if(local===undefined)localStorage.removeItem(k);else localStorage.setItem(k,local)},[B,seed.local]);
     await page.evaluate(async([B,p])=>fetch('api/wisdom/reaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'entry',id:B,field:'progress',value:p})}),[B,seed.progress]);
    }
    // Read A to its last page, one page per swipe.
    await openRoute(`#/read/${A}/${col.id}`);let s=await settle(A);assert.equal(s.at,'opener',`${label}: A opens on its cover`);
    for(let i=0;i<120&&s.at!=='end';i++){const before=num(s)[0];await swipe(1);await page.waitForTimeout(420);s=await state();assert.equal(s.id,A);assert.equal(num(s)[0],before+1,`${label}: one swipe = one page inside A (${before} → ${s.count})`)}
    assert.equal(s.at,'end',`${label}: reached A's end`);row.a_end=s.count;
    // The forward turn.
    if(input==='swipe')await swipe(1);else if(input==='arrow')await key('ArrowRight');else await rightTap();
    await ready(B);const early=await state();await page.waitForTimeout(1200);s=await state();row.landed=s.count;
    await page.screenshot({path:path.join(evidence,label+'.png')});
    assert.equal(s.id,B,`${label}: forward opens the next chapter`);
    assert.equal(num(s)[0],1,`${label}: forward lands on the next chapter's cover (got ${s.count})`);assert.equal(s.at,'opener');
    assert.equal(early.count,s.count,`${label}: no later relayout moves it (${early.count} → ${s.count})`);
    const saved=await fr.evaluate(B=>localStorage.getItem('wisdom:'+new URL('.',location.href).pathname+':pos:'+B),B);assert.equal(Number(saved),0,`${label}: cover saved as the place`);
    if(input==='swipe'){
     // One more swipe moves exactly one page, then Back twice returns to the cover and to A's last page.
     await swipe(1);await page.waitForTimeout(500);s=await state();assert.equal(num(s)[0],2,`${label}: one swipe from the cover = page 2 (${s.count})`);
     await swipe(-1);await page.waitForTimeout(500);s=await state();assert.equal(s.at,'opener');
     await swipe(-1);await ready(A);await page.waitForTimeout(700);s=await state();assert.equal(s.id,A);assert.equal(s.at,'end',`${label}: Back from B's cover lands on A's last page (${s.count})`);
    }else if(input==='arrow'){
     await key('ArrowLeft');await ready(A);await page.waitForTimeout(700);s=await state();assert.equal(s.id,A);assert.equal(s.at,'end',`${label}: ArrowLeft from B's cover lands on A's last page (${s.count})`);
    }
    assert.deepEqual(errors,[]);row.pass=true;
   }catch(e){row.pass=false;row.error=e.message;failures.push(label+': '+e.message.split('\n')[0]);try{await page.screenshot({path:path.join(evidence,label+'-fail.png')})}catch{}}
   console.log((row.pass?'ok   ':'FAIL ')+label+(row.landed?` ${row.a_end} → ${row.landed}`:'')+(row.resume?` resume ${row.resume}`:'')+(row.error?' :: '+row.error.split('\n')[0]:''));
   await ctx.close();
  }
  let head='';try{head=require('child_process').execSync('git rev-parse HEAD').toString().trim()}catch{}
  fs.writeFileSync(path.join(evidence,'forward-next-chapter-cover.json'),JSON.stringify({head,core_sha256:info.core_sha256,rows,failures},null,1));
  if(failures.length){console.error(`FAIL forward next chapter cover: ${failures.length}/${rows.length}\n`+failures.join('\n'));process.exitCode=1}
  else console.log(`PASS forward next chapter cover: ${rows.length} cases (unread, partly read, read, read 100%, local end/near-end/mid; swipe, ArrowRight, right tap; standalone + frame); one swipe = one page; Back from cover → previous end; collection open resumes`);
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exit(1)});
