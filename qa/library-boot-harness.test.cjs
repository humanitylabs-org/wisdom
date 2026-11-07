'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {observerSource}=require('./library-boot-observer.cjs');
const arg={entryId:'one',entryTitle:'Chapter title',collectionId:'book',collectionTitle:'Collection title'};
function world(href){
 let now=0,home=null;const callbacks=[];
 const location=new URL(href),document={baseURI:href,readyState:'loading',querySelector:()=>home,addEventListener(){}};
 const box={getAttribute:k=>k==='src'?'https://example.test/wisdom/':null,getBoundingClientRect:()=>({width:390,height:800,right:390,left:0,bottom:800,top:0})};
 const context=vm.createContext({location,document,performance:{timeOrigin:1000,now:()=>now},parent:{innerWidth:390,innerHeight:900},MutationObserver:class {constructor(cb){callbacks.push(cb)}observe(){}},setInterval:cb=>{callbacks.push(cb);return 1}});
 context.window=context;context.frameElement=box;
 return {context,setNow:n=>now=n,content:()=>{home={getClientRects:()=>[{}],querySelector:()=>({}),querySelectorAll:()=>[{dataset:{wisdomRoute:'/read/one/book'},textContent:'Chapter title'},{dataset:{wisdomRoute:'/collection/book'},textContent:'Collection title'}]};context.WizardApp={hosted:true}},tick:()=>callbacks.forEach(f=>f())};
}
test('marker precedes arg/path checks and survives blank-to-mounted identity',()=>{
 const w=world('about:blank');vm.runInContext(observerSource(arg),w.context);assert.equal(w.context.__qaInit.href,'about:blank');assert.equal(w.context.__qaInit.events[0].hasHome,false);assert.equal(w.context.__qaBoot.usable,undefined);
 w.context.location=new URL('https://example.test/wisdom/');w.content();w.setNow(345);w.tick();assert.equal(w.context.__qaBoot.usable,345);assert.equal(w.context.__qaBoot.timeOrigin,1000);w.setNow(9999);w.tick();assert.equal(w.context.__qaBoot.usable,345);
});
test('each navigated document has its own marker and live clock, not post-wait attachment',()=>{
 for(const p of ['/wisdom/','/wisdom/index.html']){const w=world('https://example.test'+p);vm.runInContext(observerSource(arg),w.context);w.content();w.setNow(799);w.tick();assert.equal(w.context.__qaBoot.usable,799);assert.equal(w.context.__qaInit.path,p)}
 for(const p of ['/wisdom','/apps/wisdom/','/notes/']){const w=world('https://example.test'+p);vm.runInContext(observerSource(arg),w.context);w.content();w.tick();assert.equal(w.context.__qaBoot.usable,undefined);assert.equal(typeof w.context.__qaInit,'object')}
});
test('missing arguments fail visibly instead of silently losing instrumentation',()=>{const w=world('https://example.test/wisdom/');vm.runInContext(observerSource(undefined),w.context);assert(w.context.__qaInit.error);assert.equal(typeof w.context.__qaBoot,'object')});
test('spinner or unrelated title cannot satisfy content oracle',()=>{const w=world('https://example.test/wisdom/');vm.runInContext(observerSource({...arg,entryTitle:'Wrong',collectionTitle:'Wrong'}),w.context);w.content();w.setNow(100);w.tick();assert.equal(w.context.__qaBoot.usable,undefined)});
test('hydration close is strict and dialog-scoped against the actual discussion build',async()=>{
 const product=fs.readFileSync(path.join(__dirname,'../static/discussions.js'),'utf8');
 const harness=fs.readFileSync(path.join(__dirname,'library-hydration-cases.cjs'),'utf8');
 const make=(tag,className='',text='')=>({tag,className,text,attrs:{},children:[],listeners:{},append(...nodes){this.children.push(...nodes)},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this.listeners[k]=fn}});
 const body=make('body'),document={body,addEventListener(){}},events=[];
 const context=vm.createContext({root:null,$:make,button:(text,cls,fn)=>{const b=make('button',cls,text);b.onclick=fn;return b},glyph:cls=>make('span',cls),ICON:{close:'',globe:'',send:''},close:()=>events.push('native-close'),changed(){},renderState(){},document,window:{addEventListener(){}}});
 const build=product.slice(product.indexOf('  function build() {'),product.indexOf('  function viewport() {'));
 vm.runInContext(build+';build();root.hidden=false;',context);
 const descendants=n=>n.children.flatMap(c=>[c,...descendants(c)]);
 const matches=(n,role,name)=>(n.attrs.role||(n.tag==='button'?'button':n.tag==='textarea'?'textbox':''))===role&&n.attrs['aria-label']===name;
 const query=(roots,role,opts)=>{assert.equal(opts.exact,true);return roots.flatMap(descendants).filter(n=>matches(n,role,opts.name))};
 const locator=nodes=>({getByRole:(role,opts)=>locator(query(nodes,role,opts)),click:async()=>{assert.equal(nodes.length,1,'strict locator ambiguity: '+nodes.length);assert.equal(nodes[0].className,'wd-close');events.push('dialog-close');nodes[0].onclick()}});
 const frame={getByRole:(role,opts)=>locator(query([body],role,opts))};
 assert.equal(query([body],'button',{name:'Close discussion',exact:true}).length,2,'real scrim and header both retain accessible names');
 assert.equal(query([context.panel],'textbox',{name:'Your question',exact:true}).length,1,'remaining Ask AI textbox has no analogous duplicate');
 const statement=harness.match(/await done\(\);await frame\.getByRole\([^\n]+\.click\(\);/)[0];
 const run=code=>vm.runInNewContext('(async()=>{'+code+'})()',{frame,done:async()=>events.push('hydrated')});
 await run(statement);assert.deepEqual(events,['hydrated','dialog-close','native-close']);events.length=0;
 const unscoped=statement.replace(".getByRole('dialog',{name:'Passage discussion',exact:true})",'');
 assert.notEqual(unscoped,statement);await assert.rejects(run(unscoped),/strict locator ambiguity: 2/);assert.deepEqual(events,['hydrated']);
 assert(!statement.includes('.first(')&&!statement.includes('force:'));
});
test('exact native selector/function contracts exist in current product source',()=>{
 const read=n=>fs.readFileSync(path.join(__dirname,'../static',n),'utf8'),discussion=read('discussions.js'),css=read('discussions.css'),wisdom=read('wisdom.js');
 for(const name of ['wd-overlay','wd-panel','wd-list-message','wd-notice','wd-composer','wd-close']){assert(discussion.includes("'"+name+"'"),name);assert(css.includes('.'+name),name)}
 assert(discussion.includes("panel.setAttribute('role', 'dialog')"));assert(discussion.includes("composer.setAttribute('aria-label', 'Your question')"));assert(discussion.includes("function open(anchor)"));assert(discussion.includes("footer.hidden = true"));assert(discussion.includes("draft().text = composer.value"));assert(css.includes('.wd-overlay[hidden]'));assert(css.includes('.wd-overlay [hidden]'));
 for(const token of ['data-wisdom-reader-back','wb-home','wb-browse-card','wb-browse','wb-cover','wb-collection','wb-reader','data-wisdom-route'])assert(wisdom.includes(token),token);
 assert(!fs.readFileSync(path.join(__dirname,'offline-acceptance.cjs'),'utf8').includes('.wd-sheet'));
});
test('single pre-navigation observer source; aborted matrix cannot pass',()=>{
 const source=fs.readFileSync(path.join(__dirname,'library-boot.cjs'),'utf8');assert.equal((source.match(/Page.addScriptToEvaluateOnNewDocument/g)||[]).length,1);assert(source.indexOf("Page.addScriptToEvaluateOnNewDocument")<source.indexOf('await page.goto(url.href'));
 assert(source.includes("report.cases.length===18&&report.cases.every(c=>c.status==='pass')"));assert(source.includes('report.missing=report.expected.filter'));assert(source.includes("if(row.status!=='pass')"));assert(source.includes('c.timing.usable<800'));assert(source.includes('await delay(5500)'));
});
test('actual emitted case retains input skin and immutable identity after appearance capture',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'library-boot.cjs'),'utf8');
 const identity=source.match(/^const caseId=.+;$/m)[0],record=source.match(/^ const c=.+;$/m)[0],appearance=source.match(/^  c\.appearance=.+;$/m)[0];
 const context=vm.createContext({variant:'candidate',width:390,skin:'nebula',mode:'cold',result:{cases:[]},save(){},assert,frame:{evaluate:async()=>({id:'nebula',bg:'#111',overflow:false})}});
 await vm.runInContext(`(async()=>{${identity}${record}${appearance}return JSON.stringify({cases:result.cases,missing:['candidate-390-nebula-cold'].filter(id=>!result.cases.some(c=>caseId(c)===id))})})()`,context).then(text=>{
  const emitted=JSON.parse(text);assert.equal(emitted.cases[0].skin,'nebula');assert.equal(emitted.cases[0].appearance.id,'nebula');assert.equal(emitted.cases[0].id,'candidate-390-nebula-cold');assert.deepEqual(emitted.missing,[]);
 });
 const descriptor=Object.getOwnPropertyDescriptor(context.result.cases[0],'id');assert.equal(descriptor.writable,false);assert.equal(descriptor.configurable,false);
});
test('desktop in-shell capture does not depend on optional fullscreen control; overflow still rejects',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'library-boot.cjs'),'utf8');
 assert(!source.includes('data-wact'));assert(!source.includes('desktop-fullscreen'));assert(!source.includes('force:true'));
 const block=source.slice(source.indexOf('\n  await page.waitForFunction',source.indexOf('c.navigationMs=')),source.indexOf("\n  if(variant==='candidate'){"));
 assert(block.includes('document.getAnimations()'));assert(block.includes('assert(!c.appearance.overflow)'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const capture=new AsyncFunction('page','frame','c','skin','assert',block);
 for(const variant of ['baseline','candidate']){
  const c={variant,width:1280,skin:'nebula'};const page={waitForFunction:async()=>{},locator(){throw Error('optional fullscreen must never be queried')}};
  await capture(page,{evaluate:async()=>({id:'nebula',overflow:false})},c,'nebula',assert);assert.equal(c.skin,'nebula');
  await assert.rejects(capture(page,{evaluate:async()=>({id:'nebula',overflow:true})},c,'nebula',assert),assert.AssertionError);
 }
});
test('cached seed observation precedes real reader input; post-reader exact queue oracle remains',()=>{
 const source=fs.readFileSync(path.join(__dirname,'library-boot.cjs'),'utf8');
 const seed=source.indexOf('beforeReader=c.cachedSeed=await frame.evaluate(replicaSnapshot)'),click=source.indexOf('await target.click()'),after=source.indexOf('c.cachedAfterReader=await frame.evaluate(replicaSnapshot)');
 assert(seed>0&&seed<click&&click<after);assert(source.lastIndexOf("await frame.locator('.wb-collection').waitFor()",seed)>source.indexOf('let beforeReader;'));assert(source.includes('assertReplica(beforeReader,entry.id)'));assert(source.includes('assertReplica(c.cachedAfterReader,entry.id,beforeReader)'));assert(source.includes('assertReplica(c.cachedAfterReload,entry.id,beforeReader)'));
 assert(source.includes("transaction(['meta','outbox'],'readonly')"));assert(!source.includes('progress>=37'));assert(source.includes('c.fullUnresolvedMs>=5500'));assert(source.includes('c.reloadReaderMs<1500'));assert(source.includes('c.navigationMs<1500'));
});
test('cached seed block executes against parsed native collection DOM without a redundant self-link',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'library-boot.cjs'),'utf8'),wisdom=fs.readFileSync(path.join(__dirname,'../static/wisdom.js'),'utf8');
 const location={hash:'#/collection/book',href:'https://example.test/wisdom/'},noop=()=>{};
 const context=vm.createContext({URL,location,localStorage:{getItem:()=>null},addEventListener:noop,window:{addEventListener:noop},document:{addEventListener:noop,documentElement:{classList:{toggle:noop}}},route:'wisdom',esc:s=>String(s??''),icon:()=>'',avatar:()=>''});
 const exposed=wisdom.replace(/return \{[^;\n]*\bcanGoBack\b[^;\n]*\};/,'return {render,setData:d=>data=d};');assert.notEqual(exposed,wisdom);
 vm.runInContext(exposed+';globalThis.ui=Wisdom;',context);
 const entry={id:'one',thinker:'t',title:'Chapter title',minutes:2,progress:37,body:'Quiet attention'},collection={id:'book',title:'Collection title',entries:['one'],thinkers:['t'],count:1,read:0,minutes:2,sections:[{title:'Chapters',entries:['one']}]},data={entries:[entry],collections:[collection],thinkers:[{id:'t',name:'Thinker'}],highlights:[]};
 context.ui.setData(data);
 // Parse actual rendered markup with the standard HTML parser, not source-token tests.
 const parsed=require('node:child_process').spawnSync('python3',['-B','-c',`import sys,json
from html.parser import HTMLParser
class DOM(HTMLParser):
 def __init__(self):super().__init__();self.nodes=[];self.text=[]
 def handle_starttag(self,tag,attrs):self.nodes.append(dict(attrs,tag=tag))
 def handle_data(self,text):self.text.append(text)
d=DOM();d.feed(sys.stdin.read());print(json.dumps({'nodes':d.nodes,'text':''.join(d.text)}))`],{input:context.ui.render(),encoding:'utf8'});
 assert.equal(parsed.status,0,parsed.stderr);const dom=JSON.parse(parsed.stdout),routes=[];
 const nodes=selector=>selector==='[data-wisdom-route]'?dom.nodes.filter(n=>'data-wisdom-route' in n):selector.startsWith('.')?dom.nodes.filter(n=>(n.class||'').split(/\s+/).includes(selector.slice(1))):dom.nodes.filter(n=>selector===`[data-wisdom-route="${n['data-wisdom-route']}"]`);
 assert.equal(nodes('.wb-collection').length,1);assert.equal(nodes('[data-wisdom-route="/collection/book"]').length,0,'current native collection has no collection self-link');assert(nodes('[data-wisdom-route="/shelf/private"]').length,'actual library link remains');
 for(const n of dom.nodes)n.dataset=Object.fromEntries(Object.entries(n).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase()),v]));
 const bind=wisdom.slice(wisdom.indexOf(' function bindLinks('),wisdom.indexOf(' function updateResults('));
 vm.runInNewContext(bind+';bindLinks(root)',{root:{querySelectorAll:s=>s==='[data-wisdom-route]'?nodes(s):[]},navigate:(route)=>routes.push(route)});
 const events=[],seed={progress:37},frame={locator(selector){const found=nodes(selector);assert(found.length,'locator must match rendered DOM: '+selector);const control={first:()=>control,waitFor:async()=>events.push('collection'),textContent:async()=>dom.text,click:async()=>{events.push('reader-click');found[0].onclick({preventDefault:noop,stopPropagation:noop})}};return control},evaluate:async()=>{events.push('seed');return seed}};
 const block=source.slice(source.indexOf('    let beforeReader;'),source.indexOf("await frame.locator('.wb-reader').waitFor",source.indexOf('    let beforeReader;')));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,c={};
 await new AsyncFunction('frame','data','entry','mode','c','checkpoint','replicaSnapshot','assertReplica','save','assert',block)(frame,data,entry,'cached',c,noop,noop,(s,id)=>{assert.equal(s.progress,37);assert.equal(id,'one');assert.equal(routes.length,0)},noop,assert);
 assert.deepEqual(events,['collection','seed','reader-click']);assert.deepEqual(routes,['/read/one/book']);assert.equal(c.cachedSeed,seed);
 // The same executable regression rejects the old accidental collection click.
 const old=block.replace("if(mode==='cached'){","if(mode==='cached'){await frame.locator('[data-wisdom-route=\"/collection/book\"]').first().click();");
 await assert.rejects(new AsyncFunction('frame','mode',old)(frame,'cached'),/locator must match rendered DOM/);
});
test('actual reader go queues rounded page progress; exact projector rejects stale or unexplained values',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'library-boot.cjs'),'utf8'),wisdom=fs.readFileSync(path.join(__dirname,'../static/wisdom.js'),'utf8'),offline=fs.readFileSync(path.join(__dirname,'../static/offline.js'),'utf8');
 const check=vm.runInNewContext(source.slice(source.indexOf('function assertReplica('),source.indexOf('\nconst cases=[];'))+';assertReplica',{assert});
 const rawProject=vm.runInNewContext(offline.slice(offline.indexOf('  function project('),offline.indexOf('  function reconcile('))+';project',{clone:structuredClone}),project=(...args)=>JSON.parse(JSON.stringify(rawProject(...args)));
 const raw={entries:[{id:'one',progress:37}],highlights:[]};
 const note={seq:1,id:'synthetic-pending-boot-note',path:'api/wisdom/highlight',body:{action:'add',entry_id:'one',start:0,end:5,text:'Quiet',note:'Pending boot note survives'},tempId:-123,created:'seed'};
 const before={state:structuredClone(raw),outbox:[note],projected:project(raw,note),reader:null};check(before,'one');
 const counter={textContent:''},track={style:{}},reader={dataset:{read:'one'},querySelector:s=>s==='.wb-track'?track:s==='.wb-count'?counter:s==='.wb-bar>span'?{style:{}}:s==='.wb-left'?{}:null},writes=[];
 const context=vm.createContext({Math,Date,Promise,reader:()=>reader,cancelSelectionDrag(){},page:2,pages:6,pageW:390,textPages:3,textFrom:2,textAnchor:null,hlAct:null,exactFrac:{f:.37,page:2},data:{entries:[{id:'one',progress:37,minutes:3}]},opened:'',positionWrites:new Map(),localStorage:{setItem(){}},posKey:id=>id,api:async(p,b)=>writes.push({path:'api/'+p,body:JSON.parse(JSON.stringify(b))})});
 vm.runInContext(wisdom.slice(wisdom.indexOf(' function go('),wisdom.indexOf(' function step('))+';go(2,false)',context);await context.positionWrites.get('one');
 assert.equal(counter.textContent,'3 / 6');assert.equal(writes.length,1);assert.equal(writes[0].body.value,40,'37 rounds to real page 3/6, not a constant seed assertion after reading');
 const position={...writes[0],seq:2,created:'reader'};const after={state:structuredClone(raw),outbox:[note,position],projected:project(project(raw,note),position),reader:{id:'one',count:counter.textContent}};check(after,'one',before);
 const invalid=edit=>{const s=structuredClone(after);edit(s);assert.throws(()=>check(s,'one',before),assert.AssertionError)};
 invalid(s=>s.projected.entries[0].progress=37);invalid(s=>s.outbox[1].body.value=41);invalid(s=>s.reader.count='2 / 6');invalid(s=>s.outbox.pop());invalid(s=>s.projected.highlights[0].text='changed');invalid(s=>s.outbox[0].body.note='changed');
 assert.throws(()=>check(after,'one'),assert.AssertionError,'reader state cannot count as untouched seed');
});
