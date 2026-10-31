'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'..');
test('domain routes are escaped before becoming an HTML href attribute',()=>{
 const escape=fs.readFileSync(path.join(root,'static/app.js'),'utf8').split('\n').find(s=>s.startsWith('const esc='));
 const link=fs.readFileSync(path.join(root,'static/wisdom.js'),'utf8').split('\n').find(s=>s.trim().startsWith('const link='));
 const context={};vm.runInNewContext(escape+'\n'+link+'\nglobalThis.link=link;',context);
 const html=context.link('/read/x" onclick="alert(1)','Read');
 assert.match(html,/href="#\/read\/x&quot; onclick=&quot;alert\(1\)"/);
 assert.doesNotMatch(html,/href="#\/read\/x" onclick=/);
});
