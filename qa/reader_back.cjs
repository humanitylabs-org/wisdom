// Focused domain regression. Run: node qa/reader_back.cjs [static/wisdom.js]
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const src=fs.readFileSync(process.argv[2]||'static/wisdom.js','utf8');
function fn(name){const start=src.indexOf(' function '+name+'(');assert(start>=0,`${name} is shared by visible and platform Back`);const end=src.indexOf('\n }',start);return src.slice(start,end+3)}
const box={data:{entries:[{id:'chapter',thinker:'author'}]},route:['','read','chapter','book'],parseRoute(){return this.route},colOf:()=>({id:'book'}),thinker:()=>({id:'author'}),remember(){},history:{state:{depth:1,previousRoute:''},back(){box.pops++}},navigate(p,o){box.replaced={p,o}},pops:0};
box.parseRoute=()=>box.route;vm.createContext(box);vm.runInContext(fn('readerParent')+'\n'+fn('readerBack'),box);
box.readerBack();assert.equal(box.pops,0);assert.equal(box.replaced.p,'/collection/book');assert.equal(box.replaced.o.replace,true);
box.history.state={depth:2,previousRoute:'#/collection/book'};box.readerBack();assert.equal(box.pops,1);
box.history.state={};box.readerBack();assert.equal(box.replaced.p,'/collection/book');
box.colOf=()=>null;box.route=['','read','chapter'];assert.equal(box.readerParent(),'/thinker/author');
assert(src.includes("if(e.dataset.wisdomReaderBack){readerBack();return}"));assert(src.includes("if(parseRoute()[1]==='read')return readerBack();"));
console.log('PASS reader shortcut, matching parent consumption, cold deep link, thinker fallback, common visible/native action');
