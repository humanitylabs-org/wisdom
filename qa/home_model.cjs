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
const entry=(id,extra={})=>({id,thinker:'t',title:id,minutes:2,read:false,archived:false,saved:false,...extra});
const collection=(id,entries,extra={})=>({id,title:id,entries,thinkers:['t'],count:entries.length,read:0,done:0,fresh:false,bio:'A thoughtful collection',form:'book',...extra});
const entries=[entry('overview',{saved:true}),entry('a',{archived:true}),entry('b',{collections:['Mixed']}),entry('c',{archived:true,saved:true,title:'ChapterOnlyNeedle'}),entry('d',{archived:true}),entry('e',{read:true})];
const collections=[collection('Mixed',['overview','a','b'],{overview:'overview'}),collection('Archived',['c','d']),collection('Read not archived',['e']),collection('Empty',[])];
const data={entries,collections,thinkers:[{id:'t',name:'Nāgārjuna',bio:'Philosophy'}],orders:{all:['e','d','c','b','a'],starred:['c'],archived:['d','a','c']},picks:['b'],highlights:[]};
ui.setData(data);
const ids=view=>Array.from(ui.libraryCollections(view),c=>c.id);
assert.deepEqual(ids('to-read'),['Mixed','Read not archived']);
assert.deepEqual(ids('archived'),['Archived']);
assert.deepEqual(ids('starred'),['Archived']);
assert.deepEqual(ids('all'),['Read not archived','Archived','Mixed','Empty']);
collections[0].library_scope='private';collections[1].library_scope='shared';
location.hash='#/shelf/shared';assert.deepEqual(Array.from(ui.search('ARCHIVED'),c=>c.id),['Archived']);assert.equal(ui.search('Mixed').length,0);
assert.equal(ui.search('ChapterOnlyNeedle').length,0); // A chapter's title never becomes a search result.
assert.equal(ui.search(''),null);assert.equal(ui.search('nagarjuna').length,1);
location.hash='';collections[0].fresh=true;collections[0].next_id='b';
assert(ui.hero().includes('data-wisdom-route="/collection/Mixed"'));assert(ui.hero().includes('<strong>Mixed</strong>'));
collections[0].fresh=false;assert(ui.hero().includes('data-wisdom-route="/collection/Mixed"')); // fallback pick in unstarted collection
collections[0].read=1;entries[0].read=true;assert(ui.hero().includes('data-wisdom-route="/read/b/'));
// Continue reading = the collection opened most recently, at the chapter last open (even a chapter marked
// read earlier, while its saved page is short of the end). Currently reading lists the rest, latest first.
const reading=Array.from({length:5},(_,i)=>collection('reading-'+i,['r'+i,'s'+i],{read:1,next_id:'s'+i,count:2,last_read_at:'2026-01-0'+(5-i)}));
data.entries=[...entries,...reading.flatMap((c,i)=>[entry('r'+i,{read:true,read_at:'2026-01-0'+(5-i),progress:100}),entry('s'+i,{})])];
data.entries.find(e=>e.id==='r2').opened_at='2026-02-01T00:00:00Z';data.entries.find(e=>e.id==='r2').progress=60; // reopened, mid-chapter
data.collections=reading;
assert(ui.continueCard().includes('data-wisdom-route="/read/r2/reading-2"'),ui.continueCard());
assert(ui.continueCard().includes('Continue reading'));
const order=[...new Set([...ui.reading().matchAll(/\/read\/(\w+)\/(reading-\d)/g)].map(m=>m[2]))];
assert.deepEqual(order,['reading-0','reading-1','reading-3','reading-4']);
assert(ui.reading().includes('/read/s0/reading-0'));
data.entries.find(e=>e.id==='r2').progress=100;assert(ui.continueCard().includes('/read/s2/reading-2')); // finished: next chapter
// The done reply's snapshot can predate the final progress write (James, 19 Oct): this device's saved page
// at the end page (rating screen) still counts as finished, so Home moves on instead of "Resume · 1 min left".
data.entries.find(e=>e.id==='r2').progress=92;context.localStorage.getItem=k=>k.endsWith(':pos:r2')?'1':null;
assert(ui.continueCard().includes('/read/s2/reading-2'),ui.continueCard());assert(!ui.continueCard().includes('1 min left'));
context.localStorage.getItem=k=>k.endsWith(':pos:r2')?'0.5':null;assert(ui.continueCard().includes('/read/r2/reading-2')); // mid-chapter: resume
context.localStorage.getItem=()=>null;data.entries.find(e=>e.id==='r2').progress=100;
assert(ui.render().indexOf('Continue reading')<ui.render().indexOf('Currently reading'));
data.collections=Array.from({length:9},(_,i)=>collection('suggestion-'+i,['b'],{added_at:'2026-03-0'+(i+1)}));
data.entries=entries;
assert.equal((ui.suggested().match(/class="wb-cover"/g)||[]).length,6);
assert(ui.suggested().includes('View all 9'));
const sug=[...new Set([...ui.suggestedAll().matchAll(/\/collection\/(suggestion-\d)/g)].map(m=>m[1]))];
assert.deepEqual(sug,Array.from({length:9},(_,i)=>'suggestion-'+(8-i)));
location.hash='#/suggested';assert(ui.render().includes('wb-suggested-all'));location.hash='';
console.log('PASS collection aggregation, scopes/case/diacritics, collection-only results, hero fallback, continue reading, recency order, newest suggestions + view all');
