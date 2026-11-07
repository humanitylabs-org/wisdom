'use strict';
// QA only: derive the complete contract from the exact served shared client.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function clientRoles(shell){
 // Classification is valid only for this actual pinned shell state/CSS contract.
 for(const [file,digest] of Object.entries({'web/app.js':'1a3fbe336cba87d0e86757b59e5031a045806e65e152103916d9143c8fcc22dc','web/styles.css':'d943fa56ff8c181790bda9ee818694eeca4b443931f46557413d8b4a305ae01a','web/index.html':'9507a97d3c558599f40e2e13a987d69b05849216041e3c206abe4ab5c7e03b26'}))assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(shell,file))).digest('hex'),digest,'review shell panel classification after '+file+' drift');
 const source=fs.readFileSync(path.join(shell,'web/core/app-client.js'),'utf8');
 const literal=source.match(/const TOKENS = (\[[^;]+\]);/);assert(literal,'pinned client TOKENS');
 const roles=JSON.parse(literal[1].replace(/'/g,'"'));
 assert(roles.includes('base')&&roles.includes('canvas')&&roles.includes('text')&&roles.includes('reader-surface'));
 assert(!roles.includes('bg'),'--wz-bg is not an Appearance v1 role');return roles;
}
// Runs in the actual app document; reads the real client and host ACK state.
function hostedReady({roles,skin}){
 const root=document.documentElement,a=window.WizardApp?.theme.get(),f=window.frameElement;
 if(!a||!f||a.skin!==skin||a.version!==1||!Number.isSafeInteger(a.revision)||a.revision<0||!['light','dark'].includes(a.colorScheme)||!['window','immersive'].includes(a.presentation))return false;
 const ack=parent.WizAppearance?.inspect().find(x=>x.src===f.getAttribute('src')&&x.revision===a.revision&&x.acked&&x.themed);
 return !!ack&&root.hasAttribute('data-wz-hosted')&&root.dataset.skin===skin&&root.dataset.colorScheme===a.colorScheme&&root.dataset.presentation===a.presentation&&roles.every(k=>typeof a.tokens[k]==='string'&&a.tokens[k].length>0&&CSS.supports('color',a.tokens[k])&&root.style.getPropertyValue('--wz-'+k).trim()===a.tokens[k]);
}
// Self-contained: serialized unchanged into both real documents and fake-DOM tests.
// Shell 7f4f45fd: app.js openSheet/closeSheets + styles.css closed transforms.
function panelCandidates(){
 const rect=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom});
 return [...document.querySelectorAll('.wd-panel,.wb-glosspop,.wb-sheet-card,.wb-hlpop,.sheet')].map(n=>{
  const s=getComputedStyle(n),rects=[...n.getClientRects()].map(rect),clip={left:0,top:0,right:innerWidth,bottom:innerHeight},ancestors=[];
  let effectiveOpacity=Number(s.opacity),hidden=s.display==='none'||['hidden','collapse'].includes(s.visibility);
  for(let a=n.parentElement;a;a=a.parentElement){
   const t=getComputedStyle(a);effectiveOpacity*=Number(t.opacity);if(t.display==='none')hidden=true;
   const x=['hidden','clip','scroll','auto'].includes(t.overflowX),y=['hidden','clip','scroll','auto'].includes(t.overflowY);
   if(x||y){const r=a.getBoundingClientRect();if(x){clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right)}if(y){clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom)}}
   ancestors.push({id:a.id,className:String(a.className),display:t.display,visibility:t.visibility,opacity:t.opacity,overflowX:t.overflowX,overflowY:t.overflowY});
  }
  const device=n.closest('#device'),known=device&&['launcher','inbox','settings'].includes(n.id)&&n.classList.contains('sheet')&&n.classList.contains(n.id);
  const classOpen=n.classList.contains('open'),hostOpen=!!device?.classList.contains('sheet-open')&&device.dataset.sheet===n.id;
  const intersects=rects.some(r=>Math.min(r.right,clip.right)>Math.max(r.left,clip.left)&&Math.min(r.bottom,clip.bottom)>Math.max(r.top,clip.top));
  // No opacity, pointer-events, inert or aria-hidden heuristic may hide an open panel.
  let required=true,reason='unknown-rendered-panel';
  if(hidden||!rects.length){required=false;reason=hidden?'css-hidden-self-or-ancestor':'no-rendered-rect'}
  else if(known&&(classOpen||hostOpen))reason=classOpen===hostOpen?'shell-open':'shell-open-signals-disagree';
  else if(known&&!intersects){required=false;reason='shell-closed-outside-clip'}
  else if(known)reason='shell-closed-but-still-in-clip';
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=s.backgroundColor;ctx.fillRect(0,0,1,1);
  return {id:n.id,className:String(n.className),state:required?'open-or-unproven':'inactive',required,reason,knownShell:!!known,classOpen,hostOpen,rects,clip,intersects,pointerEvents:s.pointerEvents,ancestors,background:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity,effectiveOpacity,backgroundAlpha:ctx.getImageData(0,0,1,1).data[3]};
 });
}
function appearanceSnapshot(roles,classify=panelCandidates){
 const root=document.documentElement,a=WizardApp.theme.get(),f=window.frameElement,style=getComputedStyle(root);
 const ack=parent.WizAppearance.inspect().find(x=>x.src===f.getAttribute('src')&&x.revision===a?.revision);
 // Resolve expected colours with the same browser CSS engine, not literal fallbacks.
 const probe=document.createElement('span');probe.style.cssText='position:fixed;visibility:hidden;pointer-events:none';document.body.append(probe);
 const color=v=>{probe.style.color=v;return getComputedStyle(probe).color};
 const expected=Object.fromEntries(['canvas','base','text','reader-surface'].map(k=>[k,color(a.tokens[k])]));probe.remove();
 const paint=n=>n?{background:getComputedStyle(n).backgroundColor,text:getComputedStyle(n).color}:null;
 const reader=document.querySelector('.wb-reader');
 const panels=classify();
 return {panels,id:root.dataset.skin,hosted:WizardApp.hosted,context:a,ack,attributes:{hosted:root.hasAttribute('data-wz-hosted'),scheme:root.dataset.colorScheme,presentation:root.dataset.presentation},roles:Object.fromEntries(roles.map(k=>[k,style.getPropertyValue('--wz-'+k).trim()])),expected,root:paint(root),body:paint(document.body),reader:paint(reader),flow:paint(reader?.querySelector('.wb-flow')),overflow:root.scrollWidth>innerWidth};
}
function assertAppearance(s,roles,skin){
 const a=s.context;assert(a&&a.version===1);assert.equal(a.skin,skin);assert.equal(s.id,skin);assert.equal(s.hosted,true);assert(s.attributes.hosted);assert.equal(s.attributes.scheme,a.colorScheme);assert.equal(s.attributes.presentation,a.presentation);
 assert(s.ack?.acked&&s.ack.themed,'real shell must acknowledge applied Appearance');assert.equal(s.ack.revision,a.revision,'ACK must match current client revision');assert(Number.isSafeInteger(a.revision)&&a.revision>=0);
 for(const k of roles){assert.equal(typeof a.tokens[k],'string',k);assert(a.tokens[k].length>0,k);assert.equal(s.roles[k],a.tokens[k],k)}
 assert(!s.overflow,'no horizontal overflow');
 for(const n of ['root','body'])assert.equal(s[n].background,s.expected.canvas,n+' canvas');
 // base.css assigns ink to body, not html; do not invent a root text rule.
 assert.equal(s.body.text,s.expected.text,'body text');
 assert(s.expected.base&&s.expected.text&&s.expected['reader-surface'],'computed roles required');assert.notEqual(s.expected.base,s.expected.text,'base/text must differ');
 if(s.reader){assert.equal(s.reader.background,s.expected['reader-surface']);assert.equal(s.reader.text,s.expected.text);if(s.flow)assert.equal(s.flow.text,s.expected.text)}
 for(const p of s.panels||[]){if(p.required===false)continue;assert.equal(p.backgroundAlpha,255,'opaque '+p.className);assert.equal(Number(p.opacity),1,'settled opaque '+p.className);assert.equal(p.effectiveOpacity??Number(p.opacity),1,'opaque ancestors '+p.className)}
 return s;
}
// REUSE the Appearance/ACK/paint assertions; EXTEND only the QA settlement oracle.
// Pin the source that makes the one finite decorative exception safe to classify.
function assertDecorativeSource(){
 const css=fs.readFileSync(path.join(__dirname,'../static/wisdom.css'));
 assert.equal(require('node:crypto').createHash('sha256').update(css).digest('hex'),'38196816760217bdde098854fa26eed81a6d8db3ed1cd54caadc0ec20813f08d','review decorative animation contract after CSS drift');
}
// Evaluated unmodified in either actual document, also executable with a fake DOM.
function animationSettlement(classify=panelCandidates){
 const animations=document.getAnimations().map(a=>{
  const t=a.effect?.getTiming(),n=a.effect?.target;
  const decorative=a.animationName==='wb-ken'&&(n?.matches?.('.wb-reader .wb-opener > img.wb-opener-art')||n?.matches?.('.wb-reader .wb-opener > span.wb-opener-art.wb-noart'))&&t?.duration===18000&&t.iterations===1&&t.delay===0&&t.endDelay===0&&t.fill==='both'&&a.playbackRate===1&&!a.effect?.pseudoElement;
  const active=!['finished','idle'].includes(a.playState);
  // Sustained/infinite motion was never a finite settlement requirement.
  const reason=decorative?'source-pinned-opener-art':t?.iterations===Infinity?'sustained-infinite':null;
  return {name:a.animationName||a.transitionProperty||'(web-animation)',target:n?{tag:n.tagName,id:n.id,className:String(n.className)}:null,state:a.playState,currentTime:a.currentTime,duration:t?.duration,iterations:t?.iterations===Infinity?'Infinity':t?.iterations,reason,blocking:active&&!reason};
 });
 const panels=classify();
 return {ready:animations.every(a=>!a.blocking)&&panels.every(p=>!p.required||(Number(p.opacity)===1&&p.effectiveOpacity===1&&p.backgroundAlpha===255)),animationCount:animations.length,animations,panels};
}
const settlementExpression=()=> '('+animationSettlement.toString()+')(('+panelCandidates.toString()+'))';
const snapshotExpression=roles=> '('+appearanceSnapshot.toString()+')('+JSON.stringify(roles)+',('+panelCandidates.toString()+'))';
async function settleAnimations(target){
 try{
  // String serialization keeps this exact executable predicate in both contexts.
  await target.waitForFunction('('+settlementExpression()+').ready',null,{timeout:4000,polling:50});
  return await target.evaluate(settlementExpression());
 }catch(error){
  let timer,diagnostic;
  try{diagnostic=await Promise.race([target.evaluate(settlementExpression()),new Promise(resolve=>{timer=setTimeout(()=>resolve({unavailable:'diagnostic deadline'}),1000)})])}
  catch(e){diagnostic={unavailable:e.message}}finally{clearTimeout(timer)}
  // Stored by the owning case's existing terminal error writer, including active names.
  if(diagnostic.animations)diagnostic.animations=diagnostic.animations.slice(0,80);
  throw Error('Appearance animation/panel settlement failed: '+JSON.stringify(diagnostic)+'; '+error.message);
 }
}
async function captureAppearance({page,frame,skin,shell}){
 assertDecorativeSource();const roles=clientRoles(shell),settlement=[];
 await frame.waitForFunction(hostedReady,{roles,skin},{timeout:5000,polling:50});
 for(const target of [page,frame]){
  // Hidden Wisdom after the real Chats handoff cannot be gated on rAF.
  // This timer is a failure deadline, never an arbitrary settlement sleep.
  let timer;try{await Promise.race([target.evaluate(()=>document.fonts.ready.then(()=>true)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('font settlement deadline')),5000)})])}finally{clearTimeout(timer)}
  settlement.push(await settleAnimations(target));
 }
 const snapshot=assertAppearance(await frame.evaluate(snapshotExpression(roles)),roles,skin);
 return {...snapshot,settlement};
}
module.exports={clientRoles,hostedReady,panelCandidates,appearanceSnapshot,assertAppearance,captureAppearance,assertDecorativeSource,animationSettlement,settleAnimations,settlementExpression,snapshotExpression};
