'use strict';
// Source-only DOM/FontFaceSet seams. This is NOT actual font/native proof.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'../static/wisdom.js'),'utf8');
function fn(name){const a=source.indexOf(` function ${name}(`);assert(a>=0,name);if(name==='reader')return source.slice(a,source.indexOf('\n',a));return source.slice(a,source.indexOf('\n }',a)+3)}
function harness(){
 const listeners={},positions=new Map(),writes=[],effects={layouts:0,selection:0};let current,cols=11,ready=Promise.resolve();
 const fields={'.wb-count':{},'.wb-bar>span':{style:{}},'.wb-left':{},'.wb-track':{style:{}},'.wb-top':{offsetHeight:58},'.wb-foot':{offsetHeight:28}};
 const flow={style:{},getBoundingClientRect:()=>({left:0}),querySelector:()=>({getBoundingClientRect:()=>({left:(cols-1)*400})})};
 const stage={clientWidth:400,clientHeight:800};
 const make=id=>({dataset:{read:id},isConnected:true,querySelector:s=>s==='.wb-flow'?flow:s==='.wb-stage'?stage:fields[s],querySelectorAll:()=>[{style:{}}]});current=make('a');
 const context={document:{querySelector:()=>current,fonts:{get ready(){return ready},addEventListener:(n,f)=>listeners[n]=f}},Promise,Math,Number,String,Map,location:{hash:'#/read/a'},resumedRoute:'',landEnd:'',opened:'a',writing:false,data:{entries:[{id:'a',minutes:9,progress:0},{id:'b',minutes:9,progress:0}]},page:4,pages:13,pageW:400,textFrom:1,textPages:11,textAnchor:null,exactFrac:null,hlWords:null,hlAct:null,positionWrites:new Map(),cancelSelectionDrag:()=>effects.selection++,glossOpen:()=>false,closeGloss(){},hidePop(){},paint(){},matchMedia:()=>({matches:false}),posKey:id=>id,localStorage:{setItem:(k,v)=>{positions.set(k,v);writes.push([k,v])},getItem:k=>positions.get(k)??null},api:async()=>({}),words:()=>[{s:100,e:110,rects:[{l:1200}]}]};
 vm.createContext(context);vm.runInContext(fn('reader')+'\n'+fn('rememberLine')+'\n'+fn('layout')+'\n'+fn('go'),context);
 const start=source.indexOf(' let layoutGeneration=0;');if(start>=0)vm.runInContext(source.slice(start,source.indexOf(' // Character offset',start)),context);
 const tail=source.slice(source.indexOf('  paint(r);\n',source.indexOf(' function bindReader()'))).split('\n }')[0];
 // Extract only the final binding lines, not handlers. Execute with actual r.
 const binding=tail.slice(tail.indexOf(start>=0?'  const generation=++layoutGeneration;':'  const fontsReady='));
 assert(binding.length>0);vm.runInContext('function bindFonts(r){'+binding+'}',context);
 return {c:context,fields,positions,writes,effects,make,bind:()=>context.bindFonts(current),setCurrent:r=>current=r,setCols:n=>cols=n,event:n=>listeners[n]?.(),setReady:p=>ready=p,hasListener:!!listeners.loadingdone,refit:(r,g)=>context.refitAfterFonts?.(r,g),r:()=>current};
}
(async()=>{
 const results=[];async function test(name,f){try{await f();results.push({name,status:'passed'})}catch(e){results.push({name,status:'failed',error:e.message})}}
 await test('late-face-after-ready-moves-sentinel-and-count',async()=>{const h=harness();h.c.page=0;h.bind();await Promise.resolve();assert.equal(h.c.pages,13);h.setCols(13);h.event('loadingdone');assert.equal(h.c.pages,15,'loaded face leaves stale 13-page count');assert.equal(h.fields['.wb-count'].textContent,'1 / 15')});
 await test('post-layout-ready-waits-for-used-face',async()=>{const h=harness();h.c.page=0;let resolve;h.setReady(new Promise(r=>resolve=r));h.bind();h.setCols(13);resolve();await Promise.resolve();assert.equal(h.c.pages,15)});
 await test('anchor-retains-full-precision-compatible-fraction',async()=>{const h=harness(),f=2/7;h.setCols(99);h.c.pages=101;h.c.textPages=99;h.c.page=29;h.c.exactFrac={f,page:29};h.c.words=()=>[{s:100,e:110,rects:[{l:28*400}]}];h.c.layout(true);assert.equal(h.positions.get('a'),String(f),'anchor rounded exact fraction');assert(Object.is(h.c.exactFrac.f,f));assert.notEqual(h.positions.get('a'),'0.29')});
 await test('stale-ready-cannot-relayout-another-reader',async()=>{const h=harness();let resolve;h.setReady(new Promise(r=>resolve=r));h.bind();h.setCurrent(h.make('b'));h.setCols(13);const n=h.writes.length;resolve();await Promise.resolve();assert.equal(h.writes.length,n,'old ready callback moved chapter B')});
 await test('stale-generation-cannot-relayout-same-reader',async()=>{const h=harness();let resolve;h.setReady(new Promise(r=>resolve=r));h.bind();h.setReady(new Promise(()=>{}));h.bind();h.setCols(13);const n=h.writes.length;resolve();await Promise.resolve();assert.equal(h.writes.length,n,'old generation moved current reader')});
 await test('unchanged-font-geometry-does-not-dismiss-selection',async()=>{const h=harness();h.bind();await Promise.resolve();h.c.hlAct={id:1};const n=h.effects.selection;h.event('loadingdone');assert.equal(h.effects.selection,n);assert.equal(h.c.hlAct.id,1)});
 await test('failed-font-load-refits-fallback-without-polling',async()=>{const h=harness();h.bind();await Promise.resolve();h.setCols(12);h.event('loadingerror');assert.equal(h.c.pages,14)});
 await test('detached-or-frozen-reader-is-untouched',async()=>{const h=harness();h.bind();await Promise.resolve();h.setCols(13);h.r().isConnected=false;const n=h.writes.length;h.event('loadingdone');assert.equal(h.writes.length,n);h.r().isConnected=true;h.r().dataset.discussionFrozen='1';h.event('loadingdone');assert.equal(h.writes.length,n)});
 await test('explicit-page-turn-still-updates-before-fonts-resolve',async()=>{const h=harness();h.setReady(new Promise(()=>{}));h.bind();h.c.go(4,false);assert.equal(h.fields['.wb-count'].textContent,'5 / 13');assert.equal(h.positions.get('a'),String(4/12))});
 await test('incompatible-resize-anchor-still-owns-reading-line',async()=>{const h=harness();h.setCols(19);h.c.pages=21;h.c.textPages=19;h.c.exactFrac={f:2/7,page:4};h.c.layout(true);assert.equal(h.c.page,4);assert.equal(h.c.exactFrac,null)});
 console.log(JSON.stringify({kind:'source-only-no-native-or-browser',results},null,2));if(results.some(x=>x.status==='failed'))process.exitCode=1;
})();
