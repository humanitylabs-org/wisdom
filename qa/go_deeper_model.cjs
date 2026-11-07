// Production UI functions exercised in a VM: no browser or backend substitutes.
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const source=fs.readFileSync('static/wisdom.js','utf8');
const location={hash:'',href:'https://example.test/',pathname:'/'};
const noop=()=>{};
const context={URL,location,localStorage:{getItem:()=>null,removeItem:()=>{}},sessionStorage:{getItem:()=>null},addEventListener:()=>{},window:{addEventListener:noop},document:{addEventListener:noop,documentElement:{classList:{toggle:noop}}},route:'wisdom',esc:s=>String(s??''),icon:()=>'',avatar:()=>''};
vm.createContext(context);
const exposed=source.replace(/return \{[^;\n]*\bcanGoBack\b[^;\n]*\};/,'return {render,hero,continueCard,reading,suggested,suggestedAll,libraryCollections,search,setData:d=>data=d};');
assert.notEqual(exposed,source,'Production export marker must be found');
vm.runInContext(exposed+';globalThis.ui=Wisdom;',context);
const ui=context.ui;
// Go deeper (owner request, 23 Oct): a sampler chapter's end page links that thinker's own collection; deep-dive and
// single-thinker chapters, and thinkers without their own collection, get no card.
const T=(id,name)=>({id,name,bio:'',portrait:''});
const E=(id,thinker,cols)=>({id,thinker,title:'T '+id,deck:'d',body:'# T '+id+'\n\nBody.',minutes:2,read:false,saved:false,archived:false,rating:0,source_url:'https://x.test',body_sha256:'h',collections:cols});
const C=(id,title,entries,thinkers,extra={})=>({id,title,entries,thinkers,count:entries.length,read:0,done:0,fresh:false,bio:'',form:thinkers.length>1?'theme':'thinker',...extra});
const data={thinkers:[T('ep','Epictetus'),T('ze','Zeno')],
 entries:[E('s1','ep',['sampler']),E('s2','ze',['sampler']),E('d1','ep',['epictetus']),E('d2','ep',['epictetus'])],
 collections:[C('sampler','The wisdom of the Stoics',['s1','s2'],['ep','ze']),C('epictetus','The wisdom of Epictetus',['d1','d2'],['ep'],{read:1,next_id:'d2'})],
 orders:{all:[],starred:[],archived:[]},picks:[],highlights:[]};
ui.setData(data);
const at=h=>{location.hash=h;return ui.render()};
let html=at('#/read/s1/sampler');
assert(html.includes('data-wisdom-go-deeper="epictetus"'),'sampler chapter offers the deep dive');
assert(html.includes('data-wisdom-route="/collection/epictetus"'));
assert(html.includes('Go deeper · Epictetus')&&html.includes('<strong>The wisdom of Epictetus</strong>')&&html.includes('2 chapters · 1 read'));
assert(html.indexOf('data-wisdom-go-deeper')<html.indexOf('data-wisdom-discuss-chapter'),'card sits above Discuss with AI');
assert(!at('#/read/s2/sampler').includes('data-wisdom-go-deeper'),'no card when the thinker has no collection of their own');
assert(!at('#/read/d1/epictetus').includes('data-wisdom-go-deeper'),'no card inside the deep dive itself');
data.collections.push(C('epictetus-2','The wisdom of Epictetus II',['d2'],['ep'],{added_at:'2026-12-01'}));data.collections[1].added_at='2026-10-01';
assert(at('#/read/s1/sampler').includes('data-wisdom-go-deeper="epictetus-2"'),'newest own collection wins');
location.hash='';console.log('go-deeper ok');
