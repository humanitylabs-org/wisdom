// Thales: entering/leaving Wizard full screen (a taller viewport), rotation and A+/A− re-paginate the chapter
// without losing the reader's place. For every text page: the first word in view stays in view after the
// relayout, and undoing it returns to the same page. Real HTTP fixture + shared WizardApp core, disposable data.
// James, 19 Oct 2026.
const {chromium}=require(process.env.PLAYWRIGHT_DIR);
const {spawn}=require('child_process'),{createInterface}=require('readline');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const evidence=process.env.WISDOM_QA_EVIDENCE;fs.mkdirSync(evidence,{recursive:true});
 const fixture=spawn(process.env.PYTHON||'python3',['-m','qa.browser_fixture'],{env:process.env,stdio:['ignore','pipe','inherit']});
 let browser;
 try{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),15000);fixture.once('exit',c=>reject(Error('fixture exit '+c)));createInterface({input:fixture.stdout}).once('line',l=>{clearTimeout(t);resolve(JSON.parse(l))})});
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const checks=[],errors=[],failures=[];
  for(const [width,height,tall] of [[390,760,860],[360,700,800]]){
   const ctx=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(width+': '+e.message));
   const base=info.url;
   await page.goto(base);await page.waitForSelector('.wb-home');
   const data=await page.evaluate(async()=>(await fetch('api/wisdom')).json());
   // The longest chapter gives the most text pages.
   const entry=data.entries.slice().sort((a,b)=>(b.minutes||0)-(a.minutes||0))[0];
   const col=data.collections.find(c=>c.entries.includes(entry.id));
   await page.goto('about:blank');await page.goto(base+`#/read/${entry.id}${col?'/'+col.id:''}`);
   await page.waitForSelector('.wb-reader .wb-flow');await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await page.waitForTimeout(500);
   const st=()=>page.evaluate(()=>{const r=document.querySelector('.wb-reader');return {at:r.dataset.at,count:r.querySelector('.wb-count').textContent}});
   // Words that start in view: [char index, text] in reading order (a hyphenated word belongs to the page it starts on).
   const view=()=>page.evaluate(()=>{const flow=document.querySelector('.wb-flow'),tw=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT),rg=document.createRange(),out=[];let pos=0,n;
    while((n=tw.nextNode())){const re=/\S+/g;let m;while((m=re.exec(n.nodeValue))){rg.setStart(n,m.index);rg.setEnd(n,m.index+m[0].length);{const q=[...rg.getClientRects()].filter(q=>q.width>0)[0];if(q&&q.left>=-1&&q.left<innerWidth)out.push([pos+m.index,m[0]])}}pos+=n.nodeValue.length}return out});
   const settle=()=>page.waitForTimeout(700);
   // Walk to the first text page.
   for(let i=0;i<6&&(await st()).at!=='text';i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(380)}
   let textPagesChecked=0;
   while((await st()).at==='text'&&textPagesChecked<12){
    const before=await st(),words=await view();if(!words.length){await page.keyboard.press('ArrowRight');await page.waitForTimeout(400);continue}const first=words[0];
    // Full screen on: taller viewport.
    await page.setViewportSize({width,height:tall});await settle();
    let v=await view();if(!v.some(w=>w[0]===first[0]))failures.push(`${width} ${before.count}: full screen lost “${first[1]}” (now ${(await st()).count})`);
    // Full screen off: back to the same page.
    await page.setViewportSize({width,height});await settle();
    let after=await st();if(after.count!==before.count)failures.push(`${width} ${before.count}: leaving full screen moved to ${after.count}`);
    // A+ then A−.
    if(!(await page.locator('[data-wisdom-size="1"]').isDisabled())){
     await page.locator('[data-wisdom-size="1"]').click();await settle();
     v=await view();if(!v.some(w=>w[0]===first[0]))failures.push(`${width} ${before.count}: A+ lost “${first[1]}” (now ${(await st()).count})`);
     await page.locator('[data-wisdom-size="-1"]').click();await settle();
     after=await st();if(after.count!==before.count)failures.push(`${width} ${before.count}: A+ then A− moved to ${after.count}`);
    }
    textPagesChecked++;
    if(textPagesChecked===2)await page.screenshot({path:path.join(evidence,`page-${width}.png`)});
    await page.keyboard.press('ArrowRight');await page.waitForTimeout(400);
   }
   assert(textPagesChecked>=3,'fixture chapter needs several text pages, got '+textPagesChecked);
   checks.push(`${width}: ${textPagesChecked} text pages × (full screen on/off, A+/A−)`);
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  if(failures.length){console.error(failures.join('\n'));throw Error(failures.length+' place losses')}
  const result={status:'pass',host:require('os').hostname(),commit:require('child_process').execSync('git rev-parse HEAD').toString().trim(),checks};
  fs.writeFileSync(path.join(evidence,'resize-line.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser?.close();fixture.kill('SIGTERM')}
})().catch(e=>{console.error(e.message||e);process.exitCode=1});
