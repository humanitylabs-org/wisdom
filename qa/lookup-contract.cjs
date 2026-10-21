'use strict';
// Runs actual production lookup functions in an isolated VM; no model/network.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('static/wisdom.js','utf8');
assert(src.includes('data-hl-act="lookup"'));assert(src.includes('data-hl-act="ask"'));
assert(!src.includes('dictionary?q='));assert(!src.includes('dictionaryCache'));
assert(src.includes('context=lookupContext(r,cur.start)'));
assert(src.includes('if(glossOpen())closeGloss();deactivate();hlSel='));
assert(src.includes("new URL('api/lookup/stream',base)"));
const fn=src.slice(src.indexOf(' // Look up always explains'),src.indexOf(' function activate('));
const close=src.slice(src.indexOf(' function closeGloss('),src.indexOf(' function openGloss('));
const r={dataset:{read:'fixture',bodySha256:'a'.repeat(64)},querySelector:()=>popover,querySelectorAll:()=>[]};
const popover={hidden:false},seen=[],calls=[];let active=r;
const enc=new TextEncoder(),tick=()=>new Promise(res=>setImmediate(res)),later=()=>new Promise(res=>setTimeout(res,5));
// A streamed body whose chunks the test releases one by one (or all at once).
function body(lines,{hold=false}={}){
 const queue=lines.map(l=>enc.encode(typeof l==='string'?l:JSON.stringify(l)+'\n'));const waiters=[];let released=hold?0:Infinity,i=0;
 const reader={read:()=>new Promise(res=>{const go=()=>{if(i<queue.length&&i<released)res({value:queue[i++],done:false});else if(i>=queue.length)res({value:undefined,done:true});else waiters.push(go)};go()})};
 return {getReader:()=>reader,release:(n=1)=>{released=(released===Infinity?0:released)+n;while(waiters.length)waiters.shift()()}};
}
function ok(lines,opts){return {ok:true,status:200,body:body(lines,opts),json:async()=>{throw Error('stream')}}}
function done(p,text='Synthetic compact explanation in context.',model='claude-haiku-4-5'){return {type:'done',entry_id:p.entry_id,body_sha256:p.body_sha256,model,text}}
let respond=p=>ok([{type:'delta',text:'Synthetic '},{type:'delta',text:'compact'},done(p)]);
const ctx={data:{glosses:{Sōtō:{en:'STATIC MUST NOT WIN'}}},reader:()=>active,glossOpen:()=>!popover.hidden,glossHist:false,glossBack:false,
 base:'https://wizard.invalid/wisdom/',URL,TextDecoder,AbortController,setTimeout,clearTimeout,
 requestAnimationFrame:f=>setTimeout(f,0),cancelAnimationFrame:id=>clearTimeout(id),
 showDefinition:(reader,term,g)=>{assert.equal(g.language,'AI explanation');popover.hidden=false;seen.push({term,text:g.en})},
 api:async()=>{throw Error('Look up must stream, not use the JSON api helper')},
 fetch:async(url,opts)=>{const payload=JSON.parse(opts.body);calls.push({url:String(url),payload,signal:opts.signal});assert.equal(String(url),'https://wizard.invalid/wisdom/api/lookup/stream');assert.equal(opts.method,'POST');return respond(payload,opts)}};
vm.createContext(ctx);vm.runInContext(fn+close,ctx);
// Paragraph selection uses the rendered offset, including UTF-16 and inline nodes.
const earlier={nodeValue:'Earlier block'},before={nodeValue:'😀 Context before '},termNode={nodeValue:'Sōtō'},after={nodeValue:' after the term.'};
const block={textContent:before.nodeValue+termNode.nodeValue+after.nodeValue};
for(const node of [before,termNode,after])node.parentElement={closest:()=>block};
ctx.flowOf=()=>({});ctx.highlightNodes=()=>[earlier,before,termNode,after];
ctx.document={createRange:()=>({selectNodeContents:b=>assert.equal(b,block),setEnd:(n,offset)=>{assert.equal(n,termNode);assert.equal(offset,0)},toString:()=>before.nodeValue})};
assert.equal(ctx.lookupContext(r,earlier.nodeValue.length+before.nodeValue.length),block.textContent);
(async()=>{
 for(const term of ['ontology','Sōtō','dhātu-vāda','無為','ālaya']){
  await ctx.lookupFor(r,term,{},'Context with '+term);assert.equal(calls.at(-1).payload.text,term);assert.notEqual(seen.at(-1).text,'STATIC MUST NOT WIN');
  assert.equal(seen.at(-1).text,'Synthetic compact explanation in context.');
 }
 const count=calls.length;await ctx.lookupFor(r,'ontology',{},'Context with ontology');assert.equal(calls.length,count);
 await ctx.lookupFor(r,'ontology',{},'Different ontology context');assert.equal(calls.length,count+1);
 r.dataset.bodySha256='b'.repeat(64);await ctx.lookupFor(r,'ontology',{},'Different ontology context');assert.equal(calls.length,count+2);
 r.dataset.read='other';await ctx.lookupFor(r,'ontology',{},'Different ontology context');assert.equal(calls.length,count+3);
 // Streaming: provisional text appears before completion; the validated final text replaces it.
 let held;respond=p=>{const res=ok([{type:'delta',text:'Streaming '},{type:'delta',text:'words arrive'},done(p,'Final validated explanation for the term.')],{hold:true});held=res.body;return res};
 const streaming=ctx.lookupFor(r,'stream',{},'s');await tick();assert.equal(seen.at(-1).text,'Explaining…');
 held.release();await later();assert.equal(seen.at(-1).text,'Streaming …');
 held.release();await later();assert.equal(seen.at(-1).text,'Streaming words arrive …');
 held.release();await streaming;assert.equal(seen.at(-1).text,'Final validated explanation for the term.');
 // Dismissal aborts the request and never repaints a closed popover.
 const bodies=[];respond=p=>{const res=ok([{type:'delta',text:'Late '},done(p,'Late '+p.text+' explanation in context.')],{hold:true});bodies.push(res.body);return res};
 const dismissed=ctx.lookupFor(r,'dismiss',{},'first');await tick();const dsig=calls.at(-1).signal;ctx.closeGloss(true);popover.hidden=true;assert.equal(dsig.aborted,true);
 const shown=seen.length;bodies.at(-1).release(9);await dismissed;await later();assert.equal(seen.length,shown);assert.equal(popover.hidden,true);popover.hidden=false;
 // A newer selection aborts and supersedes the older one.
 const old=ctx.lookupFor(r,'older',{},'old');await tick();const osig=calls.at(-1).signal,oldBody=bodies.at(-1);
 const newer=ctx.lookupFor(r,'newer',{},'new');await tick();assert.equal(osig.aborted,true);
 bodies.at(-1).release(9);await newer;assert.equal(seen.at(-1).text,'Late newer explanation in context.');oldBody.release(9);await old;await later();assert.equal(seen.at(-1).text,'Late newer explanation in context.');
 const stale=ctx.lookupFor(r,'stale',{},'stale');await tick();r.dataset.bodySha256='c'.repeat(64);const staleCount=seen.length;bodies.at(-1).release(9);await stale;await later();assert.equal(seen.length,staleCount);
 const navigation=ctx.lookupFor(r,'navigate',{},'nav');await tick();active={};const navCount=seen.length;bodies.at(-1).release(9);await navigation;await later();assert.equal(seen.length,navCount);active=r;
 // Failures are sanitized, never cached, and retry on the next tap.
 let attempts=0;respond=()=>{attempts++;throw Error('secret provider URL')};
 await ctx.lookupFor(r,'failure',{});assert(seen.at(-1).text.includes('retry'));assert(!seen.at(-1).text.includes('secret'));await ctx.lookupFor(r,'failure',{});assert.equal(attempts,2);
 respond=()=>({ok:false,status:400,json:async()=>({error:'private'})});await ctx.lookupFor(r,'invalid',{});assert(seen.at(-1).text.includes('edition changed'));assert(!seen.at(-1).text.includes('unavailable'));
 respond=()=>ok([{type:'delta',text:'partial'},{type:'error',status:400,error:'Chapter edition changed.'}]);await ctx.lookupFor(r,'midstale',{});assert(seen.at(-1).text.includes('edition changed'));
 for(const lines of [[{type:'delta',text:'partial'},{type:'error',status:503,error:'secret'}],[{type:'delta',text:'cut off'}],['not json\n'],[{type:'source'}],[done({entry_id:'x',body_sha256:'y'})]]){
  respond=()=>{attempts++;return ok(lines)};await ctx.lookupFor(r,'broken',{});await later();assert(seen.at(-1).text.includes('retry'),JSON.stringify(lines));assert(!seen.at(-1).text.includes('secret'));
 }
 const n=attempts;respond=p=>{attempts++;return ok([done(p,'')])};await ctx.lookupFor(r,'empty',{});await ctx.lookupFor(r,'empty',{});assert.equal(attempts,n+2);assert(seen.at(-1).text.includes('retry'));
 respond=p=>{attempts++;return ok([done(p,'An answer from the wrong model entirely.','claude-opus-5-5')])};await ctx.lookupFor(r,'wrongmodel',{});assert(seen.at(-1).text.includes('retry'));
 const m=attempts;await ctx.lookupFor(r,'word '.repeat(9),{});assert.equal(attempts,m);assert(seen.at(-1).text.includes('short phrase'));
 console.log('PASS: streamed AI-only route; provisional deltas then validated final; Unicode; chapter/edition/context success cache; dismissal/newer abort; edition/navigation fences; sanitized error retry incl. mid-stream; exact fast model; input bounds');
})().catch(error=>{console.error(error);process.exitCode=1});
