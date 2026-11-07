'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {assertAppearance,clientRoles,hostedReady}=require('./library-appearance.cjs');
const shell=process.env.QA_SHELL;
// Coordinator runs this against the exact sealed shell, not an invented token fixture.
test('pinned real client accepts complete roles and ACKs; legacy bg fails; missing role emits no ACK',{skip:!shell},()=>{
 const roles=clientRoles(shell),source=fs.readFileSync(path.join(shell,'web/core/app-client.js'),'utf8');
 const apply=source.slice(source.indexOf('  function applyTheme(a)'),source.indexOf('  // Compatibility with'));
 const listener=source.slice(source.indexOf("  addEventListener('message', e => {",source.indexOf('  // Compatibility with')),source.indexOf('  function hold(reason)'));
 function receive(missing){
  const style=new Map(),dataset={},posts=[],root={style:{setProperty:(k,v)=>style.set(k,v)},dataset,setAttribute:()=>{}},parent={postMessage:a=>posts.push(a)},handlers={};
  const tokens=Object.fromEntries(roles.map(k=>[k,k==='base'?'#05030c':k==='text'?'#f3efff':k==='canvas'||k==='reader-surface'?'transparent':'#b99bff']));if(missing)delete tokens[missing];
  const a={version:1,revision:42,skin:'nebula',presentation:'window',colorScheme:'dark',tokens};
  const c=vm.createContext({VERSION:1,TOKENS:roles,currentTheme:null,framed:true,document:{documentElement:root},parent,ORIGIN:'https://qa.test',CSS:{supports:(_,v)=>!!v},window:{CSS:{supports:()=>true},WizardTheme:{}},syncSkinLayer(){},notify(){},themes:new Set(),addEventListener:(n,f)=>handlers[n]=f});
  vm.runInContext(apply+listener,c);handlers.message({source:parent,origin:'https://qa.test',data:{type:'wizard:appearance',appearance:a}});
  return {a,style,posts};
 }
 const {a,style,posts}=receive();assert.equal(posts.length,1);assert.equal(posts[0].type,'wizard:appearance:ack');assert.equal(posts[0].revision,42);
 const legacy=()=>assert(style.get('--wz-bg')||'');assert.throws(legacy,assert.AssertionError,'original wrong-token assertion must fail');
 const s={id:'nebula',hosted:true,context:a,ack:{acked:true,themed:true,revision:posts[0].revision},attributes:{hosted:true,scheme:'dark',presentation:'window'},roles:Object.fromEntries(roles.map(k=>[k,style.get('--wz-'+k)])),expected:{base:'rgb(5, 3, 12)',canvas:'rgba(0, 0, 0, 0)',text:'rgb(243, 239, 255)','reader-surface':'rgba(0, 0, 0, 0)'},root:{background:'rgba(0, 0, 0, 0)'},body:{background:'rgba(0, 0, 0, 0)',text:'rgb(243, 239, 255)'},reader:{background:'rgba(0, 0, 0, 0)',text:'rgb(243, 239, 255)'},flow:{text:'rgb(243, 239, 255)'},overflow:false};
 assertAppearance(s,roles,'nebula');
 for(const mutate of [x=>x.ack=null,x=>x.ack.revision--,x=>x.roles.base='',x=>x.context.tokens.base='',x=>x.body.text='rgb(0, 0, 0)',x=>x.root.background='rgb(0, 0, 0)',x=>x.body.background='rgb(0, 0, 0)',x=>x.reader.background='rgb(0, 0, 0)',x=>x.flow.text='rgb(0, 0, 0)',x=>x.attributes.hosted=false,x=>x.panels=[{className:'wd-panel',backgroundAlpha:128,opacity:'1'}],x=>x.panels=[{className:'wd-panel',backgroundAlpha:255,opacity:'.7'}],x=>x.overflow=true]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>assertAppearance(bad,roles,'nebula'),assert.AssertionError)}
 for(const role of roles)assert.equal(receive(role).posts.length,0,'real client rejects incomplete '+role);
});
test('native capture keeps real ACK + CSS + font/animation settlement, never a colour fallback',()=>{
 const helper=fs.readFileSync(path.join(__dirname,'library-appearance.cjs'),'utf8'),cases=fs.readFileSync(path.join(__dirname,'library-hydration-cases.cjs'),'utf8');
 assert(hostedReady.toString().includes('parent.WizAppearance'));assert(helper.includes('document.fonts.ready'));assert(helper.includes('document.getAnimations()'));assert(helper.includes("setTimeout(()=>reject(Error('font settlement deadline'))"));assert(!helper.includes('requestAnimationFrame'));assert(cases.includes('captureAppearance'));assert(!cases.includes("getPropertyValue('--wz-bg')"));
 const boot=fs.readFileSync(path.join(__dirname,'library-boot.cjs'),'utf8');assert(boot.includes('c.readerAppearance='));assert(boot.includes('WosSkin.set(s)'));assert(boot.includes('c.changedAppearance='));
});
// Browser-free execution of the exact predicate passed to Playwright.
const {animationSettlement,assertDecorativeSource,settleAnimations,settlementExpression,snapshotExpression}=require('./library-appearance.cjs');
const box=(left=0,top=0,right=100,bottom=100)=>({left,top,right,bottom});
function node(className='',id='',parentElement=null,r=box()){
 const n={className,id,parentElement,dataset:{},opacity:'1',backgroundColor:'rgb(12, 7, 28)',getClientRects:()=>[r],getBoundingClientRect:()=>r};
 n.classList={contains:s=>n.className.split(' ').includes(s)};n.closest=s=>s==='#device'?(n.id==='device'?n:parentElement?.closest(s)):null;return n;
}
function dom(panels,animations=[]){
 const style=n=>({display:n.display||'flex',visibility:n.visibility||'visible',opacity:n.opacity,backgroundColor:n.backgroundColor,backgroundImage:'none',pointerEvents:n.pointerEvents||'auto',overflowX:n.overflowX||'visible',overflowY:n.overflowY||'visible',color:n.style?.color||n.color||'rgb(240, 240, 240)',getPropertyValue:()=>''});
 const root=node();root.dataset={skin:'nebula',colorScheme:'dark',presentation:'window'};root.hasAttribute=()=>true;root.scrollWidth=390;
 const theme={version:1,revision:1,skin:'nebula',colorScheme:'dark',presentation:'window',tokens:{canvas:'rgb(12, 7, 28)',base:'rgb(12, 7, 28)',text:'rgb(240, 240, 240)','reader-surface':'rgb(12, 7, 28)'}};
 const document={documentElement:root,body:{...node(),append(){}},querySelector:()=>null,getAnimations:()=>animations,querySelectorAll:()=>panels,createElement:tag=>tag==='canvas'?{getContext:()=>({fillStyle:'',fillRect(){},getImageData(){return {data:[0,0,0,this.fillStyle==='transparent'?0:255]}}})}:{style:{},remove(){}}};
 return vm.createContext({document,innerWidth:390,innerHeight:844,getComputedStyle:style,WizardApp:{theme:{get:()=>theme},hosted:true},window:{frameElement:{getAttribute:()=>'/app'}},parent:{WizAppearance:{inspect:()=>[{src:'/app',revision:1,acked:true,themed:true}]}}});
}
function fixture(){
 const art={tagName:'IMG',id:'',className:'wb-opener-art',matches:s=>s==='.wb-reader .wb-opener > img.wb-opener-art'};
 const timing={duration:18000,iterations:1,delay:0,endDelay:0,easing:'ease-out',fill:'both'};
 const ken={animationName:'wb-ken',playState:'running',playbackRate:1,currentTime:400,effect:{target:art,getTiming:()=>timing}};
 const panel=node('wd-panel');panel.opacity='.4';
 const opacity={transitionProperty:'opacity',playState:'running',currentTime:20,effect:{target:panel,getTiming:()=>({duration:180,iterations:1})}};
 const animations=[ken,opacity],panels=[panel];
 const context=dom(panels,animations);
 const sample=()=>vm.runInContext(settlementExpression(),context);
 return {art,timing,ken,panel,opacity,animations,panels,context,sample};
}
test('18s source-pinned artwork never masks unsettled short panel opacity',()=>{
 assertDecorativeSource();
 const css=fs.readFileSync(path.join(__dirname,'../static/wisdom.css'),'utf8'),markup=fs.readFileSync(path.join(__dirname,'../static/wisdom.js'),'utf8');
 assert(css.includes('animation:wb-ken 18s ease-out both'));assert(css.includes('@keyframes wb-ken{from{transform:scale(1.12)}to{transform:scale(1.0)}}'));
 assert(markup.includes('<section class="wb-slide wb-opener">${img(art(e),\'wb-opener-art\')}'));
 const f=fixture();assert.equal(f.sample().ready,false);assert.equal(f.sample().animations[0].reason,'source-pinned-opener-art');
 f.opacity.playState='finished';assert.equal(f.sample().ready,false,'finished animation alone cannot excuse translucent panel');
 f.panel.opacity='1';assert.equal(f.sample().ready,true);assert.equal(f.ken.playState,'running','no mutation/fast-forward');
});
function noArtFixture(){
 const f=fixture(),markup=fs.readFileSync(path.join(__dirname,'../static/wisdom.js'),'utf8');
 // Execute the actual source-defined fallback, not an invented target shape.
 const source=markup.slice(markup.indexOf('const img='),markup.indexOf('\n',markup.indexOf('const img=')));
 const html=vm.runInNewContext(source+';img(null,"wb-opener-art")');
 assert.equal(html,'<span class="wb-opener-art wb-noart" aria-hidden="true"></span>');
 Object.assign(f.art,{tagName:'SPAN',className:'wb-opener-art wb-noart',reader:true,opener:true,direct:true});
 f.art.matches=s=>{
  const selectors={'.wb-reader .wb-opener > img.wb-opener-art':['IMG',['wb-opener-art']],'.wb-reader .wb-opener > span.wb-opener-art.wb-noart':['SPAN',['wb-opener-art','wb-noart']]},shape=selectors[s];
  return !!shape&&f.art.reader&&f.art.opener&&f.art.direct&&f.art.tagName===shape[0]&&shape[1].every(c=>f.art.className.split(' ').includes(c));
 };
 f.opacity.playState='finished';f.panel.opacity='1';return f;
}
test('observed source-defined no-art SPAN settles without mutating its running animation',()=>{
 const f=noArtFixture(),s=f.sample();assert.equal(s.ready,true);assert.equal(s.animations[0].reason,'source-pinned-opener-art');assert.equal(s.animations[0].target.tag,'SPAN');assert.equal(f.ken.playState,'running');assert.equal(f.ken.currentTime,400);
 });
test('no-art exception rejects arbitrary SPAN, wrong class/tag/role and every wrong timing guard',()=>{
 for(const mutate of [f=>f.art.className='',f=>f.art.className='wb-opener-art',f=>f.art.className='wb-noart',f=>f.art.tagName='DIV',f=>f.art.reader=false,f=>f.art.opener=false,f=>f.art.direct=false,f=>f.ken.animationName='other',f=>f.timing.duration=17000,f=>f.timing.iterations=2,f=>f.timing.delay=1,f=>f.timing.endDelay=1,f=>f.timing.fill='none',f=>f.ken.playbackRate=2,f=>f.ken.effect.pseudoElement='::before']){
  const f=noArtFixture();mutate(f);const s=f.sample();assert.equal(s.ready,false);assert.equal(s.animations[0].blocking,true);assert.equal(s.animations[0].reason,null);
 }
 });
test('accepted no-art SPAN never excuses a real active or translucent panel',()=>{
 const f=noArtFixture();f.opacity.playState='running';assert.equal(f.sample().ready,false);f.opacity.playState='finished';f.panel.opacity='.4';assert.equal(f.sample().ready,false);f.panel.opacity='1';assert.equal(f.sample().ready,true);
 });
test('unknown active finite UI, wrong target, duration or name remain blocking',()=>{
 for(const mutate of [f=>f.ken.animationName='unknown-ui',f=>f.art.matches=()=>false,f=>f.timing.duration=17000,f=>f.ken.playbackRate=2,f=>f.ken.effect.pseudoElement='::before',f=>f.timing.fill='none']){
  const f=fixture();f.opacity.playState='finished';f.panel.opacity='1';mutate(f);assert.equal(f.sample().ready,false);
 }
 const f=fixture();f.opacity.playState='finished';f.panel.opacity='1';
 f.animations.push({animationName:'wb-rise',playState:'running',effect:{target:{className:'wb-opener-copy'},getTiming:()=>({duration:900,iterations:1})}});
 assert.equal(f.sample().ready,false,'short copy/UI animation must still finish');f.animations.at(-1).playState='finished';assert.equal(f.sample().ready,true);
 f.animations.push({animationName:'wb-nudge',playState:'running',effect:{getTiming:()=>({duration:1800,iterations:Infinity})}});assert.equal(f.sample().ready,true,'existing infinite-motion policy retained');
 f.panel.opacity='.8';assert.equal(f.sample().ready,false,'infinite motion never excuses panel opacity');
});
test('actual serialized wait predicate and timeout diagnostics execute without a browser',async()=>{
 const f=fixture();let waits=0;
 const target={waitForFunction:async(expr,arg,opts)=>{waits++;assert.equal(opts.timeout,4000);assert.equal(opts.polling,50);assert.equal(vm.runInContext(expr,f.context),false);f.opacity.playState='finished';f.panel.opacity='1';assert.equal(vm.runInContext(expr,f.context),true)},evaluate:async expr=>vm.runInContext(expr,f.context)};
 assert.equal((await settleAnimations(target)).ready,true);assert.equal(waits,1);
 f.ken.animationName='unknown-ui';target.waitForFunction=async()=>{throw Error('fake deadline')};
 await assert.rejects(()=>settleAnimations(target),e=>e.message.includes('unknown-ui')&&e.message.includes('wb-opener-art')&&e.message.includes('18000')&&e.message.includes('fake deadline'));
});
function checkPanels(panels,ready,animations=[]){
 const c=dom(panels,animations),settled=vm.runInContext(settlementExpression(),c),snapshot=vm.runInContext(snapshotExpression([]),c);
 assert.equal(settled.ready,ready,JSON.stringify(settled));assert.deepEqual(JSON.parse(JSON.stringify(settled.panels)),JSON.parse(JSON.stringify(snapshot.panels)),'snapshot and wait share every classification');
 if(ready)assertAppearance(snapshot,[],'nebula');else assert.throws(()=>assertAppearance(snapshot,[],'nebula'),assert.AssertionError);
 return settled;
}
function shellPanel(id='launcher',r=box(0,900,100,1000)){
 const host=node('device','device',null,box(0,0,390,600));host.overflowX=host.overflowY='hidden';const p=node('sheet '+id,id,host,r);p.opacity='0';return {p,host};
}
test('actual three closed shell sheets at opacity zero settle; all diagnostics retained',()=>{
 const panels=['launcher','inbox','settings'].map(id=>shellPanel(id).p),s=checkPanels(panels,true);
 assert.equal(s.panels.length,3);for(const p of s.panels){assert.equal(p.reason,'shell-closed-outside-clip');assert.equal(p.opacity,'0');assert.equal(p.required,false)}
});
test('class-open and host-open opacity 0/.5 fail, even offscreen or pointer-events none',()=>{
 for(const opacity of ['0','.5'])for(const signal of ['class','host']){
  const {p,host}=shellPanel();p.opacity=opacity;p.pointerEvents='none';if(signal==='class')p.className+=' open';else{host.className+=' sheet-open';host.dataset.sheet='launcher'}
  assert.equal(checkPanels([p],false).panels[0].required,true);
 }
});
test('open transparent fill and translucent ancestor remain failures',()=>{
 const {p,host}=shellPanel();p.className+=' open';p.opacity='1';p.backgroundColor='transparent';checkPanels([p],false);
 p.backgroundColor='rgb(12, 7, 28)';host.opacity='.5';checkPanels([p],false);
 host.opacity='1';checkPanels([p],true);
});
test('hidden ancestor app overlay is inactive; rendered app or unknown opacity zero is strict',()=>{
 const ancestor=node();ancestor.display='none';const p=node('wd-panel','',ancestor);p.opacity='0';checkPanels([p],true);
 ancestor.display='flex';p.pointerEvents='none';checkPanels([p],false);
 p.className='sheet future-panel';checkPanels([p],false);p.className='sheet launcher';p.id='launcher';checkPanels([p],false);
});
test('closed sheets require clipping, not opacity or pointer-events; partial closing is strict',()=>{
 const {p,host}=shellPanel('launcher',box(0,650,100,750));checkPanels([p],true);
 host.overflowX=host.overflowY='visible';checkPanels([p],false);
 host.overflowX=host.overflowY='hidden';p.getClientRects=()=>[box(0,550,100,650)];p.opacity='.1';checkPanels([p],false);
 p.getClientRects=()=>[box(0,650,100,750)];p.opacity='0';host.dataset.sheet='launcher';checkPanels([p],true);
 const c=dom([p],[{transitionProperty:'transform',playState:'running',effect:{target:p,getTiming:()=>({duration:520,iterations:1})}}]);assert.equal(vm.runInContext(settlementExpression(),c).ready,false,'finite closing transition still blocks');
});
test('parked Settings stays strict despite inert, aria-hidden, stale host dataset and off-desk transform',()=>{
 const {p,host}=shellPanel('settings',box(500,0,600,200));p.className+=' open';host.dataset.sheet='settings';p.inert=true;p.ariaHidden='true';p.opacity='1';checkPanels([p],true);p.opacity='0';checkPanels([p],false);
});
