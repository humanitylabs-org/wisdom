/* Source-only real render hook regression: failure precedes a newly mounted library. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let summary=null,config;
function element(){return {dataset:{},children:[],append(...xs){this.children.push(...xs)},replaceChildren(){this.children=[]},setAttribute(){}}}
const app={set innerHTML(value){summary=value.includes('data-offline-failures')?element():null}};
const kit={request:async()=>{throw new DOMException('Synthetic quota failure','QuotaExceededError')}};
const s={URL,structuredClone,DOMException,Error,location:{href:'https://flight.invalid/wisdom/',hash:'#/shelf/private'},navigator:{onLine:false},document:{createElement:element,body:{append(){}},querySelector:q=>q==='[data-offline-failures]'?summary:q==='#app'?app:null,querySelectorAll:()=>[],addEventListener(){}},addEventListener(){},WizOffline:{create(c){config=c;return kit}},Wisdom:{render:()=>'<div data-offline-failures></div>',bind(){}},CollectionManager:{bind(){}},toast(){throw Error('No automatic popup')}};s.window=s;s.$=s.document.querySelector;vm.createContext(s);
vm.runInContext(fs.readFileSync('static/offline.js','utf8'),s);
const source=fs.readFileSync(process.argv[2]||'static/app.js','utf8');
const start=source.indexOf('function render(){'),end=source.indexOf('window.renderWisdom=render;');assert(start>=0&&end>start);vm.runInContext(source.slice(start,end),s);
(async()=>{config.onStatus({ready:true,failed:[],pending:0});await assert.rejects(s.WisdomOffline.request('api/wisdom/reaction',{field:'progress',value:67}),/quota/);assert.equal(summary,null,'reader has no library summary');s.render();assert(summary.children.some(n=>/could not be saved/.test(n.textContent)),'failure must paint after actual app render mounts new library DOM');const previous=summary;s.render();assert.notEqual(summary,previous);assert(summary.children.some(n=>/could not be saved/.test(n.textContent)),'failure survives later rerender without a status event');console.log('PASS quota before route; actual render mounts and repaints quiet inline notice')})().catch(e=>{console.error(e);process.exitCode=1});
