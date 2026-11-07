import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../static/wisdom.js',import.meta.url),'utf8');
function fixture(storage=new Map()) {
 let broken=false;const holds=[];
 const ctx={URL,location:{href:'https://fixture.invalid/wisdom/'},localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(broken)throw Error('storage full');storage.set(k,v)},removeItem(k){if(broken)throw Error('blocked');storage.delete(k)}},writing:false,ratingWrites:new Map(),noteState:null,noteDirty:()=>false,WizardApp:{update:{hold(reason,options){const h={reason,options,released:false,release(){this.released=true}};holds.push(h);return h}}}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf(' const requestDraftKey='),source.indexOf(' function sheetHtml()'))+source.slice(source.indexOf(' let updateHold=null,'),source.indexOf(' function paintSheet()'))+`;globalThis.draft={get text(){return reqState.text},set text(v){reqState.text=v;syncUpdateHold()},set phase(v){reqState.phase=v;syncUpdateHold()},keep:keepRequestDraft};`,ctx);
 return {draft:ctx.draft,holds,storage,breakStorage:()=>broken=true};
}
test('request text including whitespace survives a new app document',()=>{const f=fixture();f.draft.text='  synthetic request 🌱\n';assert.equal(f.draft.keep(),'kept');assert.equal(fixture(f.storage).draft.text,f.draft.text)});
test('storage rejection never confirms kept and the draft remains protected',()=>{const f=fixture();f.breakStorage();f.draft.text='synthetic unsaved request';assert.equal(f.draft.keep(),false);assert.equal(f.holds.at(-1).reason,'Wisdom unsent request');assert.equal(f.holds.at(-1).options.keep(),false)});
test('every edit reacquires a new hold, invalidating an older keep',()=>{const f=fixture();f.draft.text='first';const h=f.holds.at(-1);assert.equal(h.options.keep(),'kept');f.draft.text='second';assert.equal(h.released,true);assert.notEqual(f.holds.at(-1),h)});
test('sending stays an ordinary in-flight hold and never confirms a draft keep',()=>{const f=fixture();f.draft.text='synthetic';f.draft.phase='sending';assert.equal(f.draft.keep(),false);assert(f.holds.some(h=>!h.released&&h.reason==='Wisdom sending'&&!h.options))});
test('sent requests are cleared and never resurrected as unsent text',()=>{const f=fixture();f.draft.text='synthetic';f.draft.phase='sent';assert.equal(fixture(f.storage).draft.text,'')});
test('corrupt storage safely opens an empty request without throwing',()=>{const storage=new Map([['wisdom:/wisdom/:request-draft-v1','{invalid']]);assert.equal(fixture(storage).draft.text,'')});
