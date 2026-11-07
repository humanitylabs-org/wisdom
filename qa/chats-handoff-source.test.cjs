// Execute unchanged owning source bridge contract; never touch owner chats/model APIs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('static/discussions.js','utf8');
const availability=src.slice(src.indexOf('  function chatsAvailable()'),src.indexOf('  function open(anchor)'));
const forward=src.match(/const accepted = WizardApp\.nav\.openThread\([^\n]+/)[0];
let got;
const s={r:{session_id:'synthetic-session',agent:'synthetic-agent',reply:{key:'wisdom:synthetic'}},text:'  synthetic unsent question  ',WizardApp:{hosted:true,nav:{threadAgents:true,threadDrafts:true,openThread:(...v)=>(got=v,true)}}};s.window=s;
vm.createContext(s);vm.runInContext(availability+';globalThis.available=chatsAvailable;'+forward+';globalThis.accepted=accepted;',s);
assert.equal(s.available(),true);assert.equal(s.accepted,true);assert.equal(got[0],'synthetic-session');assert.equal(got[1].agent,'synthetic-agent');assert.equal(got[1].reply,s.r.reply);assert.equal(got[1].draft.text,s.text);
s.WizardApp.nav.threadAgents=false;assert.equal(s.available(),false);s.WizardApp.nav.threadAgents=true;s.WizardApp.hosted=false;assert.equal(s.available(),false);
console.log('PASS exact agent-aware openThread forwarding including unsent draft');
