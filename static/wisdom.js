/* Evergreen reading stays independent from live-feed polling. */
const Wisdom = (() => {
 let data=null,error='',loading=false,serial=0,writing=false;
 const scrolls=new Map();
 let currentRoute='';
 // Reader text size: 0 small … 3 extra large, remembered on this device.
 const sizeKey='wisdom:'+new URL('.',location.href).pathname+':size';
 let size=1;try{const v=localStorage.getItem(sizeKey)??localStorage.getItem('wisdom:/wizard-signal/:size');if(v!==null&&/^[0-3]$/.test(v))size=+v}catch{}
 const parseRoute=()=>location.hash.slice(1).split('/');
 // The shell recreates this frame at its base URL after a reload. Keep the
 // current book here; browser history alone cannot survive frame recreation.
 const openKey='wisdom:'+new URL('.',location.href).pathname+':open';
 const bookRoute=hash=>/^#\/(?:read|collection)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?$/.test(hash);
 let resumedRoute='';const RESUME_MS=60000;
 addEventListener('pagehide',()=>saveOpenRoute());
 function restoreRoute(){
  // Explicit links (including #/ for Home) always take precedence.
  // Opening Wisdom lands on Home, where Continue reading leads to the last chapter and page (James, 18 Oct).
  // Only a reload or shell frame recreation within a minute of leaving resumes the open book directly.
  try{localStorage.removeItem(openKey)}catch{}
  if(!location.hash){try{const saved=JSON.parse(sessionStorage.getItem(openKey)||'null');if(saved&&bookRoute(saved.hash)&&Date.now()-saved.at<RESUME_MS)history.replaceState(history.state,'',saved.hash)}catch{}}
  resumedRoute=location.hash;
 }
 function saveOpenRoute(){
  try{if(bookRoute(location.hash))sessionStorage.setItem(openKey,JSON.stringify({hash:location.hash,at:Date.now()}));else sessionStorage.removeItem(openKey)}catch{}
 }
 function validateOpenRoute(){
  const [,kind,id,collection]=parseRoute();
  if((kind==='read'&&(!data.entries.some(e=>e.id===id)||(collection&&!colById(collection))))||(kind==='collection'&&!colById(id))){
   history.replaceState(history.state,'',location.pathname+location.search);currentRoute=location.hash;resumedRoute='';
  }
  saveOpenRoute();
 }
 const active=()=>route==='wisdom';
 const link=(path,text,cls='')=>`<a class="${cls}" href="#${path||'/'}" data-wisdom-route="${esc(path)}">${text}</a>`;
 const thinker=e=>data.thinkers.find(t=>t.id===e.thinker);
 const label=e=>e.label||(e.part?`Part ${e.part}`:'Overview');
 const pubIcon=t=>avatar({name:t.name});
 function inline(s){
  // Escape everything first. Editorial Markdown has no raw HTML surface.
  const links=[];
  const hold=(t,u)=>{links.push(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);return `\u0000${links.length-1}\u0000`};
  return esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,t,u)=>hold(t,u)).replace(/https?:\/\/[^\s<>\u0000]+/g,u=>{const clean=u.replace(/[.,;]+$/,'');return hold(clean,clean)+u.slice(clean.length)}).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/\u0000(\d+)\u0000/g,(_,i)=>links[Number(i)]);
 }
 function markdown(text){
  return text.replace(/^# [^\n]+\n+/,'').split(/\n\s*\n/).map(block=>{
   if(/^---+$/.test(block.trim()))return '<hr>';
   const h=block.match(/^(#{2,4}) (.+)$/);if(h)return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
   if(block.startsWith('> '))return `<blockquote>${inline(block.replace(/^> ?/gm,'')).replace(/\n/g,'<br>')}</blockquote>`;
   if(/^[-*] /.test(block))return `<ul>${block.split(/\n(?=[-*] )/).map(x=>`<li>${inline(x.replace(/^[-*] /,''))}</li>`).join('')}</ul>`;
   if(/^\d+\. /.test(block))return `<ol>${block.split(/\n(?=\d+\. )/).map(x=>`<li>${inline(x.replace(/^\d+\. /,''))}</li>`).join('')}</ol>`;
   return `<p>${inline(block).replace(/\n/g,'<br>')}</p>`;
  }).join('');
 }
 // Foreign-language phrases (James, 12 Oct): each glossed phrase gets a thin dotted underline; a tap opens a
 // popover with the romanisation, an English sound-alike and the meaning. Glosses live in content/glosses.json.
 function glossed(html){
  const g=data.glosses||{},keys=Object.keys(g).filter(k=>k&&g[k]?.en).sort((a,b)=>b.length-a.length);if(!keys.length)return html;
  // Match supplied terms, including romanised Japanese/Sanskrit. Keep the printed
  // text unchanged: highlight offsets still address the original chapter body.
  const lookup=new Map(keys.map(k=>[esc(k).toLocaleLowerCase(),k]));
  const literal=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(keys.map(k=>literal(esc(k))).join('|'),'giu');
  const word=c=>!!c&&/[\p{L}\p{N}\p{M}_]/u.test(c);
  const unspaced=c=>!!c&&/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(c);
  let skip=0;
  return html.split(/(<[^>]*>)/).map(part=>{
   if(part.startsWith('<')){if(/^<(?:a|code|script|style)[\s>]/i.test(part))skip++;else if(/^<\/(?:a|code|script|style)>/i.test(part))skip=Math.max(0,skip-1);return part}
   if(skip)return part;
   return part.replace(pattern,(shown,offset)=>{
    const k=lookup.get(shown.toLocaleLowerCase());
    if(!k)return shown;
    if((word(shown[0])&&!unspaced(shown[0])&&word(part[offset-1]))||(word(shown.at(-1))&&!unspaced(shown.at(-1))&&word(part[offset+shown.length])))return shown;
    return `<span class="wb-gloss" lang="${esc(g[k].lang||'')}" data-gloss="${esc(k)}" role="button" tabindex="0" aria-label="${esc(k)}: translate">${shown}</span>`;
   });
  }).join('');
 }
 function entryActions(e){return `<div class="wisdom-card-actions"><button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="saved" aria-pressed="${e.saved}" aria-label="${e.saved?'Unstar':'Star'} ${esc(e.title)}">${icon('star')}<span>${e.saved?'Starred':'Star'}</span></button>${e.archived?`<button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="archived" aria-label="Restore ${esc(e.title)}">${icon('undo')}<span>Restore</span></button>`:`<button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="done" aria-label="Done reading ${esc(e.title)}">${icon('check')}<span>Done</span></button><button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="archived" aria-label="Archive ${esc(e.title)}">${icon('archive')}<span>Archive</span></button>`}</div>`}
 const status=e=>`${e.saved?' · ★ Starred':''}${e.archived?' · Archived':e.read?' · Read':''}`;
 // Collections are ordered chapter lists (one thinker or many); thinkers are a separate index.
 // A chapter's number is its place in a collection, so links carry the collection: #/read/<id>/<collection>.
 const seriesOf=id=>data.entries.filter(x=>x.thinker===id&&!x.dive_of).sort((a,b)=>a.part-b.part);
 const colById=id=>(data.collections||[]).find(c=>c.id===id);
 const colOf=(e,cid)=>{const c=cid&&colById(cid);return c&&c.entries.includes(e.id)?c:colById((e.collections||[])[0])};
 const chapNo=(e,c)=>c?.numbers?.[e.id];
 const short=(e,c=colOf(e))=>e.dive_of?'Deep dive':chapNo(e,c)?`Chapter ${chapNo(e,c)}`:c&&c.overview===e.id?'Overview':'';
 const dotted=(...xs)=>xs.filter(Boolean).join(' · ');
 const readLink=(e,c)=>'/read/'+e.id+(c?'/'+c.id:'');
 const art=e=>e.art||thinker(e).portrait;
 const bookTitle=c=>{const m=/^The wisdom of (.+)$/i.exec(c.title||'');return m?['The wisdom of',m[1]]:['',c.title]};
 const readCount=id=>seriesOf(id).filter(x=>x.read).length;
 const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
 const img=(src,cls,alt='')=>src?`<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`:`<span class="${cls} wb-noart" aria-hidden="true"></span>`;
 const initials=n=>esc(n.split(/\s+/).map(w=>w[0]).slice(0,2).join(''));
 // A many-minds collection gets a mosaic of its first portraits.
 const colArt=(c,cls)=>c.portrait?img(c.portrait,cls,c.title):c.mosaic?.length?`<span class="${cls} wb-mosaic n${c.mosaic.length}">${c.mosaic.map(src=>img(src,'wb-portrait')).join('')}</span>`:`<span class="${cls} wb-initial">${initials(bookTitle(c)[1])}</span>`;
 function colCover(c,{form=true}={}){
  const [,n]=bookTitle(c);
  return link('/collection/'+c.id,`<span class="wb-cover-art">${colArt(c,'wb-portrait')}${form?`<span class="wb-cover-form">${esc(FORMS[c.form]||'Theme')}</span>`:''}<span class="wb-cover-copy"><small>${esc(c.kind||'Collection')}</small><strong>${esc(n)}</strong></span></span><span class="wb-cover-meta">${dotted(plural(c.count,'chapter'),c.read&&!c.next_id?'Finished':c.read?`${c.read} read`:'')}</span>${c.fresh?'<span class="wb-cover-new">New</span>':''}`,'wb-cover');
 }
 function thinkerCover(t){
  const total=seriesOf(t.id).length,done=readCount(t.id);
  return link('/thinker/'+t.id,`<span class="wb-cover-art">${t.portrait?img(t.portrait,'wb-portrait',t.name):`<span class="wb-portrait wb-initial">${initials(t.name)}</span>`}<span class="wb-cover-copy"><strong>${esc(t.name)}</strong></span></span><span class="wb-cover-meta">${dotted(plural(total,'chapter'),done?`${done} read`:'')}</span>${t.more?'<span class="wb-cover-pin" aria-label="Prioritized">★</span>':''}${t.fresh?'<span class="wb-cover-new">New</span>':''}`,'wb-cover');
 }
 // Library card with art thumbnail. The title link stays first in DOM.
 function row(e,{lead=false,reason=false}={}){
  const t=thinker(e);
  return `<article class="wisdom-row wisdom-card wb-row ${lead?'wisdom-lead':''} ${e.read?'is-read':''}" data-wisdom-id="${esc(e.id)}"><div class="wisdom-card-main">${link('/read/'+e.id,`<span class="wisdom-row-title">${esc(e.title)}</span>`,'wisdom-title-link')}<div class="wisdom-pubrow">${link('/thinker/'+e.thinker,`<span class="wisdom-byline-name">${esc(t.name)}</span>`,'wisdom-byline')}${short(e)?`<span class="wb-dot">·</span><span class="wb-chap">${esc(short(e))}</span>`:''}</div>${link('/read/'+e.id,`<p class="wisdom-description">${esc(e.deck||e.description)}</p>`,'wisdom-preview-link')}<div class="wisdom-card-foot"><span class="wisdom-meta">${e.minutes} min${status(e)}</span>${entryActions(e)}</div></div>${link('/read/'+e.id,img(art(e),'wb-thumb'),'wb-thumb-link')}</article>`;
 }
 function pref(t,compact=false){return `<button class="wisdom-action wisdom-thumb ${t.more?'selected':''}" data-wisdom-pref="${esc(t.id)}" aria-pressed="${t.more}" aria-label="More from ${esc(t.name)}" title="${t.more?'Tap to reset. ':''}Prioritize ${esc(t.name)} in your Wisdom feed, including tomorrow’s picks.">${icon('up')}<span>${compact?(t.more?'Prioritized':'More'):(t.more?'Prioritizing this thinker':'More from this thinker')}</span></button>`}
 const views={'to-read':'To read',starred:'Starred',archived:'Archived',all:'All'};
 const matches=(e,view)=>view==='starred'?e.saved:view==='archived'?e.archived:view==='all'?true:!e.archived;
 // Collection views aggregate chapter state without writing collection preferences.
 // To read retains the existing non-archived rule; a mixed collection stays active.
 function libraryCollections(view){
  const byid=new Map(data.entries.map(e=>[e.id,e])),order=new Map((data.orders?.[view]||data.entries.map(e=>e.id)).map((id,i)=>[id,i]));
  const members=c=>c.entries.filter(id=>id!==c.overview).map(id=>byid.get(id)).filter(Boolean);
  const rank=c=>Math.min(...members(c).map(e=>order.get(e.id)??Infinity));
  return (data.collections||[]).filter(c=>{const es=members(c);return view==='all'||(es.length>0&&(view==='archived'?es.every(e=>matches(e,view)):es.some(e=>matches(e,view))))}).sort((a,b)=>rank(a)-rank(b));
 }
 // Library tabs sit under a Library header reached from Browse; switching tabs replaces, so Back returns to Browse.
 function viewTabs(view){const n=(data.highlights||[]).length,sel=id=>(view===id?'selected':'')+'" data-wisdom-replace="1';return `<nav class="wisdom-views" aria-label="Wisdom library views">${Object.entries(views).map(([id,name])=>link('/library/'+id,`${name} <span>${libraryCollections(id).length}</span>`,sel(id))).join('')}${link('/highlights',`Highlights <span>${n}</span>`,sel('highlights'))}</nav>`}
 // A page's ‹ steps back through Wisdom's own history when there is some, else replaces with the parent page.
 const backBtn=parent=>link(parent,'‹','wb-round" data-wisdom-back="1" aria-label="Back');
 const libraryPage=(view,body)=>`<section class="wb-lib-page"><header class="wb-all-top">${backBtn('/browse')}<h1>Your library</h1></header>${viewTabs(view)}<div class="wisdom-home">${body}</div></section>`;
 // Earlier-edition quotes remain saved, but are never usable as current anchors.
 const currentAnchor=h=>!h.anchor_status||['current','reanchored'].includes(h.anchor_status);
 // Highlights page: every saved passage, newest first, grouped by reading.
 function highlightsPage(){
  const list=data.highlights||[],byid=new Map(data.entries.map(e=>[e.id,e]));
  if(!list.length)return `<section class="wisdom-library"><p class="wisdom-empty">Long-press any sentence in a chapter, then tap Highlight. Your highlights collect here.</p></section>`;
  const groups=[];for(const h of list){const e=byid.get(h.entry_id);if(!e)continue;let g=groups.find(x=>x.e===e);if(!g)groups.push(g={e,hs:[]});g.hs.push(h)}
  return `<section class="wisdom-library wb-hl-page">${groups.map(({e,hs})=>`<article class="wb-hl-group"><header>${link('/read/'+e.id,`<strong>${esc(e.title)}</strong><span>${esc(dotted(thinker(e).name,short(e)))}</span>`,'wb-hl-src')}</header>${hs.sort((a,b)=>a.start-b.start).map(h=>`<figure class="wb-hl-item" data-highlight-id="${h.id}">${!currentAnchor(h)?`<figcaption class="wb-quiet-note"><strong>Earlier edition</strong><br>${esc((h.reason||'Anchor not verified in current text').replace(/^Earlier edition — /,''))}</figcaption>`:''}<blockquote>${esc(h.text)}</blockquote>${h.note?`<p class="wb-hl-note">${esc(h.note)}</p>`:''}<button class="wb-quiet" data-wisdom-copy="${h.id}" aria-label="Copy highlight">${icon('copy')}<span>Copy</span></button>${currentAnchor(h)||h.note?`<button class="wb-quiet" data-wisdom-note="${h.id}" aria-label="${h.note?'Edit note':'Add a note'}">${icon('note')}<span>${h.note?'Edit note':'Note'}</span></button>`:''}${!currentAnchor(h)?`<button class="wb-quiet" data-wisdom-remove-highlight="${h.id}" aria-label="Remove earlier-edition highlight">Remove</button>`:''}</figure>`).join('')}</article>`).join('')}</section>`;
 }
 // Home (James, 12 Oct): Currently reading → Suggested (+ Browse all) → one Search → Request a new collection.
 const FORMS={book:'Book',thinker:'Thinker',theme:'Theme'};
 const formOf=c=>FORMS[c.form]||'Theme';
 const entryById=id=>data.entries.find(x=>x.id===id);
 // Home (James, 18 Oct): Continue reading (last chapter open, at its page) → Currently reading by most
 // recently opened → Suggested, newest first, with View all. A chapter counts as open from its last page turn
 // or opening (opened_at) or its completion (read_at); finishing one moves that collection to its next chapter.
 const touched=e=>[e?.opened_at,e?.read_at].filter(Boolean).sort().pop()||'';
 const members=c=>c.entries.map(entryById).filter(Boolean);
 const lastTouch=c=>members(c).map(touched).sort().pop()||'';
 // Reaching a chapter's end page (the rating screen) finishes it (James, 19 Oct): synced progress at 100 or this
 // device's saved page at the end both count, so a library snapshot that predates the final page write (the done
 // reply racing the progress write) cannot pull Home back to a chapter he just finished.
 const finished=e=>(Number(e.progress)||0)>=100||spot(e)>=1;
 function resumeOf(c){
  const last=members(c).filter(touched).sort((a,b)=>touched(b).localeCompare(touched(a)))[0];
  if(last&&!finished(last)&&!(last.read&&!last.opened_at))return last;
  return c.next_id?entryById(c.next_id):null;
 }
 const started=c=>(c.read>0||!!lastTouch(c))&&!!resumeOf(c);
 // A collection nobody has opened yet starts at its overview, the entry point written for it (James, 21 Oct):
 // Start must never skip the first thing in the collection. Once anything is opened or read, resume as usual.
 const opener=c=>{const o=c&&c.overview&&entryById(c.overview);return o&&!o.read&&!lastTouch(c)?o:null};
 const unstarted=c=>!lastTouch(c)&&(c.overview?!(entryById(c.overview)||{}).read&&!c.done:!c.read);
 function heroCol(){return (data.collections||[]).filter(c=>c.fresh&&unstarted(c)).sort((a,b)=>(b.added_at||'').localeCompare(a.added_at||''))[0]||null}
 function readingAll(){
  return (data.collections||[]).filter(started).sort((a,b)=>lastTouch(b).localeCompare(lastTouch(a))||(b.last_read_at||'').localeCompare(a.last_read_at||''));
 }
 const readingList=()=>readingAll().slice(1);
 const chapterFraction=e=>e?.read?1:Math.max(0,Math.min(100,Number(e?.progress)||0))/100;
 const collectionProgress=c=>{const chapters=c.entries.filter(id=>id!==c.overview).map(entryById).filter(Boolean);return chapters.length?Math.round(100*chapters.reduce((sum,e)=>sum+chapterFraction(e),0)/chapters.length):0};
 // Where this device last stopped in a chapter (falls back to the synced percentage).
 const spot=e=>{let f=(Number(e.progress)||0)/100;try{const v=localStorage.getItem(posKey(e.id));if(v!==null&&Number.isFinite(+v))f=+v}catch{}return Math.max(0,Math.min(1,f))};
 // Same layout as the original Home hero (James, 18 Oct): only the content points at the chapter to resume.
 function continueCard(){
  const c=readingAll()[0];if(!c)return '';
  const e=resumeOf(c),n=chapNo(e,c),f=spot(e),pct=Math.round(f*100),left=Math.max(1,Math.ceil(e.minutes*(1-f)));
  return `<section class="wb-hero-wrap wb-continue" aria-label="Continue reading">${link(readLink(e,c),`${img(art(e),'wb-hero-art')}<span class="wb-hero-shade"></span><span class="wb-hero-copy"><small>Continue reading · ${esc(c.title)}</small><strong>${esc(e.title)}</strong><span class="wb-hero-deck">${esc(e.deck)}</span><span class="wb-hero-foot"><span class="wb-pill">${pct>0?`Resume · ${left} min left`:`Read · ${e.minutes} min`}</span><span>${n?`Chapter ${n} of ${c.count}`:''}</span></span></span>`,'wb-hero')}</section>`;
 }
 function reading(){
  const list=readingList();if(!list.length)return '';
  return `<section class="wb-reading wb-picks-wrap" aria-label="Currently reading"><div class="wb-head"><h2>Currently reading</h2><span>${list.length}</span></div><div class="wb-picks">${list.map(c=>{
   const e=resumeOf(c),n=chapNo(e,c),pct=collectionProgress(c);
   return link(readLink(e,c),`${img(art(e),'wb-pick-art')}<span class="wb-pick-copy"><small>${esc(formOf(c))} · ${esc(c.title)}</small><strong>${esc(e.title)}</strong><span>${n?`Chapter ${n} of ${c.count} · `:''}${e.minutes} min</span><span class="wb-reading-bar" role="progressbar" aria-label="${esc(c.title)} reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span data-pct="${pct}"></span></span></span>`,'wb-pick')}).join('')}</div></section>`;
 }
 // Suggestions: collections not yet opened, newest first.
 function suggestions(){
  const shown=readingAll()[0]?null:heroCol(),taste=c=>c.thinkers.reduce((s,id)=>{const t=data.thinkers.find(x=>x.id===id);return s+(t?(t.more?3:0)+(t.taste||0):0)},0)/Math.max(1,c.thinkers.length);
  return (data.collections||[]).filter(c=>unstarted(c)&&c!==shown).sort((a,b)=>(b.added_at||'').localeCompare(a.added_at||'')||(taste(b)-taste(a))||a.title.localeCompare(b.title));
 }
 function suggested(){
  const all=suggestions(),list=all.slice(0,6);
  return `<section class="wb-suggested" aria-label="Suggested"><div class="wb-head"><h2>Suggested <span>${list.length||''}</span></h2>${all.length>list.length?link('/suggested',`View all ${all.length} ›`,'wb-head-link'):''}</div>${list.length?`<div class="wb-suggest-grid">${list.map(c=>colCover(c,{form:true})).join('')}</div>`:`<p class="wb-quiet-note">You’ve started or finished every collection. They’re all in ${link('/browse','Browse')}, with your library and highlights.</p>`}</section>`;
 }
 function suggestedAll(){
  const list=suggestions();
  return `<section class="wb-all-thinkers wb-suggested-all"><header class="wb-all-top">${backBtn('')}<h1>Suggested</h1></header><p class="wb-quiet-note">${plural(list.length,'collection')} you haven’t opened yet, newest first.</p><div class="wb-all-grid">${list.map(c=>colCover(c,{form:true})).join('')}</div></section>`;
 }
 // Home ends with one way into Browse (search, request, library), not a strip of tabs with nothing under them.
 function browseCard(){
  const all=(data.collections||[]).length;
  return `<section class="wb-discovery" aria-label="Browse and search"><div class="wb-head"><h2>Browse and search</h2></div>${shelfLinks()}<div class="wb-browse-entry">${link('/browse',`${icon('search')}<span class="wb-browse-copy"><strong>Browse all ${plural(all,'collection')}</strong></span><span class="wb-reading-go" aria-hidden="true">›</span>`,'wb-browse-card')}</div>${searchBox()}</section>`;
 }
 // Your library inside Browse: each view shows its real count and what's in it, then opens the full list.
 function shelfLinks(){
  const cols=data.collections||[],tile=(scope,title,copy)=>link('/shelf/'+scope,`<span class="wb-lib-name">${icon('wisdom')}<strong>${title}</strong><b>${cols.filter(c=>(c.library_scope||'private')===scope).length}</b></span><small>${copy}</small>`,'wb-lib-tile');
  return `<section class="wb-lib wb-shelves" aria-label="Library shelves"><nav class="wb-lib-grid" aria-label="Library shelves">${tile('shared','Shared library','Approved collections · not public publication')}${tile('private','My library','Your imports and requested collections')}</nav></section>`;
 }
 function shelf(scope){
  if(!['shared','private'].includes(scope))return missing();
  const title=scope==='shared'?'Shared library':'My library',cols=searchCollections();
  return `<section class="wb-all-thinkers wb-library-shelf ${query.trim()?'is-searching':''}"><header class="wb-all-top">${backBtn('')}<h1>${title}</h1></header>${searchBox()}<p class="wb-quiet-note">${scope==='shared'?'Approved by your configured source for this private library. Rights and sharing permissions remain separate.':'Your imports and individually requested collections stay private. Downloading a collection does not publish it.'}</p><div class="wb-shelf-body"><div class="wb-all-grid">${cols.map(c=>colCover(c,{form:true})).join('')}</div>${cols.length?'':`<p class="wb-quiet-note">${scope==='shared'?'No approved shared collections yet.':'No private collections enabled yet. Import a bundle to begin.'}</p>`}</div><p>${link('/manage','Manage collections · import or enable a bundle','btn')}</p>${scope==='private'?requestBlock():''}</section>`;
 }
 function libraryTiles(){
  const hs=data.highlights||[];
  const peek=v=>libraryCollections(v)[0]?.title||'';
  const tile=(path,name,n,line,empty,ic)=>link(path,`<span class="wb-lib-name">${icon(ic)}<strong>${name}</strong><b>${n}</b></span><small>${esc(n?line:empty)}</small>`,'wb-lib-tile');
  const count=v=>libraryCollections(v).length;
  return `<section class="wb-lib" aria-label="Your library"><div class="wb-head"><h2>Your library</h2></div><nav class="wb-lib-grid" aria-label="Library views">${tile('/library/to-read','To read',count('to-read'),peek('to-read'),'You’re caught up','wisdom')}${tile('/library/starred','Starred',count('starred'),peek('starred'),'Star a chapter to keep it','star')}${tile('/library/archived','Archived',count('archived'),peek('archived'),'Collections with every chapter archived','archive')}${tile('/library/all','All',count('all'),plural((data.collections||[]).length,'collection')+' in Wisdom','','feed')}${tile('/highlights','Highlights',hs.length,hs[0]?`“${hs[0].text.replace(/\s+/g,' ').slice(0,90)}${hs[0].text.length>90?'…':''}”`:'','Long-press a sentence while reading','save')}</nav></section>`;
 }
 // Browse owns typed discovery, Request a collection, your library, then every collection by form.
 function browse(){
  const cols=[...(data.collections||[])].sort((a,b)=>(b.fresh-a.fresh)||started(b)-started(a)||a.title.localeCompare(b.title));
  const group=(form,title)=>{const list=cols.filter(c=>formOf(c)===FORMS[form]);return list.length?`<section class="wb-all-group" data-form="${form}"><div class="wb-head"><h2>${title}</h2><span>${list.length}</span></div><div class="wb-all-grid">${list.map(c=>colCover(c,{form:false})).join('')}</div></section>`:''};
  return `<section class="wb-all-thinkers wb-browse ${query.trim()?'is-searching':''}"><header class="wb-all-top">${backBtn('')}<h1>Browse</h1></header>${searchBox()}<div class="wb-browse-body">${shelfLinks()}${requestBlock()}${libraryTiles()}${group('book','Books')}${group('thinker','Thinkers')}${group('theme','Themes')}<p class="wb-browse-foot">${link('/thinkers',`Every thinker in Wisdom · ${data.thinkers.length} ›`,'wb-head-link')}</p></div></section>`;
 }
 // Collection-only search; each route keeps its query when returning from a detail.
 let query='';const queries=new Map();
 const queryKey=()=>location.hash.replace(/^#/, '')||'/';
 const searchCollections=()=>{const [,kind,id]=parseRoute();return (data.collections||[]).filter(c=>kind!=='shelf'||(c.library_scope||'private')===id)};
 const STOP=new Set('a an and are about as at be by can could do for from give how i i\'d id im in into is it like looking me more my of on or read reading show some something somebody someone tell that the their them there these this to want what which who why with would you'.split(' '));
 const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function search(q){
  const words=fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);if(!words.length)return null;
  // Spoken queries are sentences ("something on Stoic anger"): drop filler words; with 3+ terms half must match.
  const terms=words.filter(w=>w.length>1&&!STOP.has(w));if(!terms.length)terms.push(...words);
  const need=terms.length<3?terms.length:Math.ceil(terms.length/2);
  const score=fields=>{let total=0,hit=0;for(const t of terms){let best=0;for(const [text,w] of fields){if(fold(text).includes(t))best=Math.max(best,w)}if(best){hit++;total+=best}}return hit>=need?total+hit*10:0};
  const names=id=>data.thinkers.find(t=>t.id===id)||{};
  const cols=searchCollections().map(c=>({c,s:score([[c.title,4],[formOf(c),2],[c.kind,2],[c.thinkers.map(id=>names(id).name).join(' '),3],[c.bio,1],[c.thinkers.map(id=>names(id).bio).join(' '),1]])})).filter(x=>x.s).sort((a,b)=>b.s-a.s).map(x=>x.c);
  return cols;
 }
 function results(){
  const q=query.trim(),cols=search(q);if(!cols)return '';
  const [,kind,id]=parseRoute(),scope=kind==='shelf'?(id==='shared'?'Shared library':'My library'):'Wisdom';
  return `<div class="wb-results" aria-live="polite">${cols.length?`<h3 class="wb-res-h">${plural(cols.length,'collection')}</h3><div class="wb-all-grid">${cols.map(c=>colCover(c)).join('')}</div>`:`<p class="wb-quiet-note">No collections in ${scope} match “${esc(q)}”.</p>`}</div>`;
 }
 function searchBox(){
  return `<section class="wb-search" aria-label="Search"><div class="wb-search-field">${icon('search')}<input type="search" id="wb-q" enterkeyhint="search" autocomplete="off" placeholder="Search by topic, theme or thinker" aria-label="Search by topic, theme or thinker" value="${esc(query)}"></div><div id="wb-results">${results()}</div></section>`;
 }
 const reqStatus=r=>r.status==='building'?'your Wizard is building it':r.status==='unsent'?'Saved, not sent':r.status==='requested'?'Sending…':r.status==='done'?'Ready':r.status;
 function requestBlock(){
  if(!data?.request_enabled)return '<section class="wb-request"><p class="wb-quiet-note">Collection generation is not configured. Import a bundle in Manage collections to add it to My library.</p></section>';
  return `<section class="wb-request"><button class="btn" data-wisdom-request="">Request a collection</button><p class="wb-quiet-note">New collections arrive privately in My library, staged for your review.</p>${(data.requests||[]).map(r=>`<p>${esc(r.text)} · ${esc(reqStatus(r))}${r.status==='unsent'?` <button class="btn" data-wisdom-retry-req="${r.seq}">Retry</button>`:''}</p>`).join('')}</section>`;
 }
 function allThinkers(){
  const byCount=(a,b)=>seriesOf(b.id).length-seriesOf(a.id).length||a.name.localeCompare(b.name);
  const ths=[...data.thinkers].sort(byCount),series=ths.filter(t=>seriesOf(t.id).length>1),single=ths.filter(t=>seriesOf(t.id).length<=1);
  const grid=(title,list)=>list.length?`<section class="wb-all-group"><div class="wb-head"><h2>${title}</h2><span>${list.length}</span></div><div class="wb-all-grid">${list.map(thinkerCover).join('')}</div></section>`:'';
  return `<section class="wb-all-thinkers"><header class="wb-all-top">${backBtn('/browse')}<h1>All thinkers</h1></header>${grid('Several chapters',series)}${grid('One chapter',single)}</section>`;
 }
 function hero(){
  // Fresh requested collections keep priority, including one built around an old read.
  const fresh=heroCol(),e=fresh?entryById(fresh.overview||fresh.entries[0]):entryById(data.picks[0]);
  if(!e)return '';
  const col=fresh||colOf(e),open=col&&unstarted(col),n=chapNo(e,col);
  return `<section class="wb-hero-wrap">${link(open?'/collection/'+col.id:readLink(e,col),`${open?colArt(col,'wb-hero-art'):img(art(e),'wb-hero-art')}<span class="wb-hero-shade"></span><span class="wb-hero-copy"><small>${open?`${fresh?'New collection':'Explore collection'} · ${esc(formOf(col))}`:`Today’s first read · ${esc(thinker(e).name)}`}</small><strong>${esc(open?col.title:e.title)}</strong><span class="wb-hero-deck">${esc(open?col.bio:e.deck)}</span><span class="wb-hero-foot"><span class="wb-pill">${open?'Open collection':`Read · ${e.minutes} min`}</span><span>${open?plural(col.count,'chapter'):n?`Chapter ${n} of ${col.count}`:''}</span></span></span>`,'wb-hero')}</section>`;
 }
 function library(view='to-read'){
  const cols=libraryCollections(view);
  return `<section class="wisdom-library"><div class="wisdom-section-label"><h2>${views[view]} · ${plural(cols.length,'collection')}</h2></div><div class="wb-all-grid">${cols.map(c=>colCover(c)).join('')}</div>${cols.length?'':`<p class="wisdom-empty">${view==='starred'?'Star a chapter to keep its collection here—even after you archive it.':view==='archived'?'Collections appear here when all their chapters are archived.':'Your collections are still in All and Archived.'}</p>`}</section>`;
 }
 function render(){
  document.documentElement.classList.toggle('wb-open',parseRoute()[1]==='read'&&!!data);if(parseRoute()[1]!=='read')opened='';
  if(!data)return `<section class="wisdom-notice"><h2>${error?'Wisdom couldn’t load':'Opening your library…'}</h2>${error?`<p>${esc(error)}</p><button class="btn" data-wisdom-retry>Try again</button>`:'<span class="spinner"></span>'}</section>`;
  let [,kind,id]=parseRoute();
  if(kind==='manage')return CollectionManager.render();
  if(kind==='shelf')return shelf(id);
  if(!kind&&!data.entries.length)return `<section class="wisdom-notice"><h2>Nothing on the shelves yet.</h2><p>Add a collection from a bundle file, or enable one from your configured source.</p>${(data.notices||[]).map(n=>`<p>${esc(n)}</p>`).join('')}${link('/manage','Open Library','btn')}</section>${shelfLinks()}${requestBlock()}`;
  // Discovery follows the reading sections; Browse retains its existing controls.
  if(!kind)return `<div class="wisdom-home wb-home">${continueCard()||hero()}${reading()}${suggested()}${browseCard()}</div>`;
  if(kind==='suggested')return suggestedAll();
  if(kind==='browse')return browse();
  if(kind==='library'){const view=id;if(!views[view])return missing();return libraryPage(view,library(view,false))}
  if(kind==='thinkers')return allThinkers();
  if(kind==='highlights')return libraryPage('highlights',highlightsPage());
  // One chapter row. In a many-minds collection the row names its thinker.
  const tocRow=(e,c,{who=false,next=null}={})=>`<li class="${e.read?'is-read':''} ${next===e.id?'is-next':''}">${link(readLink(e,c),`<span class="wb-ep-art">${img(art(e),'wb-toc-art')}${e.read?'<span class="wb-ep-done">✓</span>':''}</span><span class="wb-toc-copy"><small>${dotted(esc(short(e,c)),who?esc(thinker(e).name):'',`${e.minutes} min`)}${next===e.id?' · <b>Next</b>':''}</small><strong>${esc(e.title)}</strong><span>${esc(e.deck)}</span></span>`)}</li>`;
  const bookHero=({artHtml,kicker,title,stats,bio,cta,back=''})=>`<header class="wb-book-hero">${artHtml}<span class="wb-hero-shade"></span><div class="wb-book-top">${backBtn(back)}</div><div class="wb-book-copy"><small>${kicker}</small><h1>${title}</h1><div class="wb-book-stats">${stats.filter(Boolean).map(x=>`<span>${x}</span>`).join('')}</div><p>${esc(bio||'')}</p><div class="wb-book-cta">${cta}</div></div></header>`;
  if(kind==='collection'){
   const c=colById(id);if(!c)return missing();
   const [k,n]=bookTitle(c),resume=opener(c)||resumeOf(c),start=resume||data.entries.find(e=>e.id===c.entries[0]),single=c.thinkers.length===1,t=single?data.thinkers.find(x=>x.id===c.thinkers[0]):null;
   const cta=(start?link(readLink(start,c),`${c.read||lastTouch(c)?'Continue':'Start'} · ${esc(short(start,c)||'Overview')} →`,'wb-primary'):'')+(t?pref(t,true):'');
   const byid=new Map(data.entries.map(e=>[e.id,e]));
   const list=c.sections.filter(s=>s.entries.length).map(s=>`<section class="wb-season">${s.title?`<div class="wb-season-head"><h2>${esc(s.title)}</h2></div>`:''}<ol class="wb-toc">${s.entries.map(i=>tocRow(byid.get(i),c,{who:!single,next:resume?.id})).join('')}</ol></section>`).join('');
   const who=single?'':`<p class="wb-col-minds">${c.thinkers.map(i=>{const x=data.thinkers.find(t=>t.id===i);return link('/thinker/'+i,esc(x.name))}).join(' · ')}</p>`;
   return `<section class="wisdom-thinker wb-book wb-collection">${bookHero({artHtml:colArt(c,'wb-book-portrait'),kicker:`<span class="wb-form-tag">${esc(formOf(c))}</span> ${esc(c.kind||'Collection')} · by ${esc(c.by||'Wizard')}`,title:`${k?`<span>${esc(k)}</span>`:''}${esc(n)}`,stats:[plural(c.count,'chapter'),`${c.minutes} min`,c.read?`${c.read} read`:''],bio:c.bio,cta,back:''})}<p class="wb-book-source">${link('/shelf/'+(c.library_scope||'private'),c.library_scope==='shared'?'Shared library':'My library')} · <button class="btn" data-export-collection="${esc(c.id)}">Export this collection…</button></p>${list}${who}${c.url?`<p class="wb-book-source"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Original work ↗</a></p>`:''}</section>`;
  }
  if(kind==='thinker'){
   const t=data.thinkers.find(t=>t.id===id);if(!t)return missing();
   const mine=data.entries.filter(e=>e.thinker===id),mins=mine.reduce((a,e)=>a+e.minutes,0),done=mine.filter(e=>e.read).length;
   // Chapters grouped under the collections they belong to; the rest stand alone.
   const cols=(data.collections||[]).filter(c=>c.thinkers.includes(id));
   const grouped=cols.map(c=>({c,list:c.entries.map(i=>mine.find(e=>e.id===i)).filter(Boolean)}));
   const loose=mine.filter(e=>!cols.some(c=>c.entries.includes(e.id)));
   const firstUnread=grouped.flatMap(g=>{const o=opener(g.c);return o&&g.list.includes(o)?[[o,g.c]]:g.list.filter(e=>!e.read&&e.id!==g.c.overview).map(e=>[e,g.c])}).concat(loose.filter(e=>!e.read).map(e=>[e,null]))[0];
   const [start,sc]=firstUnread||[mine[0],colOf(mine[0])];
   const cta=(start?link(readLink(start,sc),`${done?'Continue':'Start'} →`,'wb-primary'):'')+pref(t,true);
   const groups=grouped.map(({c,list})=>`<section class="wb-season"><div class="wb-season-head">${link('/collection/'+c.id,`<h2>${esc(c.title)}</h2><span>${c.thinkers.length>1?`${list.length} of ${plural(c.count,'chapter')}`:plural(c.count,'chapter')} ›</span>`,'wb-season-link')}</div><ol class="wb-toc">${list.map(e=>tocRow(e,c,{next:c.next_id})).join('')}</ol></section>`).join('');
   const rest=loose.length?`<section class="wb-season">${grouped.length?`<div class="wb-season-head"><h2>More chapters</h2><span>${loose.length}</span></div>`:''}<ol class="wb-toc">${loose.map(e=>tocRow(e,null)).join('')}</ol></section>`:'';
   return `<section class="wisdom-thinker wb-book wb-collection wb-thinker-page">${bookHero({artHtml:t.portrait?img(t.portrait,'wb-book-portrait',t.name):'<span class="wb-book-portrait wb-noart"></span>',kicker:'Thinker',title:esc(t.name),stats:[plural(mine.length,'chapter'),`${mins} min`,done?`${done} read`:''],bio:t.bio,cta})}${groups}${rest}<p class="wb-book-source"><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Original work ↗</a></p></section>`;
  }
  if(kind==='read'){
   const e=data.entries.find(e=>e.id===id);if(!e)return missing();
   const t=thinker(e),col=colOf(e,parseRoute()[3]),index=col?col.entries.indexOf(e.id):-1,next=col?data.entries.find(x=>x.id===col.entries[index+1]):null,prev=col&&index>0?data.entries.find(x=>x.id===col.entries[index-1]):null,n=chapNo(e,col);
   const home=readerParent(),homeName=col?bookTitle(col)[1]:t.name;
   let body=e.body.replace(/^# [^\n]+\n+/,'').replace(/^\*[^*\n]+\*\s*\n+/,'');
   let epigraph='';const m=/^## ([^\n]+)\n+((?:> ?[^\n]*\n?)+)\n*/.exec(body);
   if(m){epigraph=`<section class="wb-slide wb-epigraph"><div><span class="wb-label">${esc(m[1])}</span><blockquote>${glossed(inline(m[2].replace(/^> ?/gm,'').replace(/\[\d+\]/g,'').trim()).replace(/\n/g,'<br>\n'))}</blockquote><span class="wb-attrib">— ${esc(typeof e.epigraph_author==='string'&&e.epigraph_author.trim()?e.epigraph_author:t.name)}</span></div></section>`;body=body.slice(m[0].length)}
   const count=e.dive_of?'Deep dive':n?`Chapter ${n} of ${col.count}`:short(e,col);
   const end=next?link(readLink(next,col),`${img(art(next),'wb-next-art')}<span class="wb-hero-shade"></span><span class="wb-next-copy"><small>${esc(dotted('Next',short(next,col),col&&col.thinkers.length>1?thinker(next).name:''))}</small><strong>${esc(next.title)}</strong><span class="wb-primary">Keep reading →</span></span>`,'wb-next" data-wisdom-replace="1'):link(home,`Back to ${esc(homeName)}`,'wb-back-quiet" data-wisdom-replace="1');
      const rate=`<div class="wb-rate" role="group" aria-label="Rate this chapter"><span class="wb-rate-q">How was it?</span><div class="wb-rate-btns"><button class="wb-thumb ${e.rating===1?'on':''}" data-wisdom-rate="${esc(e.id)}" data-value="1" aria-pressed="${e.rating===1}" aria-label="Thumbs up">${icon('up')}</button><button class="wb-thumb ${e.rating===-1?'on':''}" data-wisdom-rate="${esc(e.id)}" data-value="-1" aria-pressed="${e.rating===-1}" aria-label="Thumbs down">${icon('down')}</button></div></div>`;
   // James, 18 Oct: every chapter ends with a whole-chapter AI discussion.
   const discuss=`<button class="wb-deeper wb-discuss" type="button" data-wisdom-discuss-chapter="${esc(e.id)}">${window.WisdomDiscussion?.hasChapter?.(e.id,e.body_sha256)?'Continue discussion':'Discuss with AI'} <b>→</b></button>`;
   const quiet=`<div class="wb-end-quiet"><button class="wb-quiet ${e.saved?'on':''}" data-wisdom-entry="${esc(e.id)}" data-field="saved" aria-pressed="${e.saved}" aria-label="${e.saved?'Unstar':'Star'} ${esc(e.title)}">${icon('star')}<span>${e.saved?'Starred':'Star'}</span></button><a class="wb-quiet" href="${esc(e.source_url)}" target="_blank" rel="noopener noreferrer">Source ↗</a></div>`;
   return `<article class="wisdom-reader wb-reader" data-read="${esc(id)}" data-body-sha256="${esc(e.body_sha256)}" data-size="${size}"${prev?` data-prev-route="${esc(readLink(prev,col))}"`:''}><header class="wb-top">${link(home,'‹','wb-round" data-wisdom-reader-back="1" aria-label="Back')}<div class="wb-top-title"><strong>${esc(t.name)}</strong><span>${esc(dotted(count,e.title))}</span></div><button class="wb-round" data-wisdom-discussions="${esc(id)}" aria-label="Chapter discussions" title="Discussions">${icon('spark')}</button><div class="wisdom-size" role="group" aria-label="Text size"><button class="wb-round" data-wisdom-size="-1" aria-label="Smaller text" ${size<=0?'disabled':''}>A−</button><button class="wb-round" data-wisdom-size="1" aria-label="Larger text" ${size>=3?'disabled':''}>A+</button></div></header><button class="wb-turn wb-turn-prev" type="button" data-wisdom-turn="-1" aria-label="Previous page" title="Previous page (←)">‹</button><button class="wb-turn wb-turn-next" type="button" data-wisdom-turn="1" aria-label="Next page" title="Next page (→)">›</button><div class="wb-stage"><div class="wb-track"><section class="wb-slide wb-opener">${img(art(e),'wb-opener-art')}<span class="wb-hero-shade"></span><div class="wb-opener-copy"><small>${esc(dotted(col&&col.thinkers.length>1?col.title:t.name,count))}</small><h1>${esc(e.title)}</h1><p>${esc(e.deck)}</p><span class="wb-swipe">${e.minutes} min · <span class="wb-touch-hint">Swipe to begin</span><span class="wb-mouse-hint">Begin</span> <b>→</b></span></div></section>${epigraph}<div class="wb-flow wisdom-body">${glossed(markdown(body))}<span class="wb-sentinel"></span></div><section class="wb-slide wb-end"><div class="wb-end-head"><small>${esc(dotted('✓ Finished',count))}</small><h2>${esc(e.title)}</h2></div>${rate}${discuss}${end}${quiet}</section></div></div><footer class="wb-foot"><div class="wb-bar"><span></span></div><div class="wb-foot-row"><span class="wb-count" aria-live="polite"></span><span class="wb-left"></span></div></footer><div class="wb-hlpop" role="toolbar" aria-label="Highlight" hidden><button data-hl-act="highlight" hidden><span class="wb-swatch"></span>Highlight</button><button data-hl-act="note">Note</button><button data-hl-act="copy">${icon('copy')}Copy</button><button data-hl-act="lookup">${icon('search')}Look up</button><button data-hl-act="ask">Ask AI</button><button data-hl-act="remove"><span class="wb-swatch off"></span>Remove<span class="wb-wide"> highlight</span></button></div><span class="wb-handle s" hidden aria-hidden="true"></span><span class="wb-handle e" hidden aria-hidden="true"></span><div class="wb-glosspop" role="dialog" aria-label="Translation" hidden></div></article>`;
  }
  return missing();
 }
 function missing(){return `<div class="wisdom-notice"><h2>That read isn’t in Wisdom</h2>${link('','Back to your library')}</div>`}
 async function load({restore=false}={}){
  const mine=++serial;loading=true;error='';if(active())window.renderWisdom();
  try{const d=await api('wisdom');if(mine!==serial)return;data=d;validateOpenRoute();}
  catch(e){if(mine!==serial)return;error=e.message;}
  finally{if(mine===serial){loading=false;if(active()){window.renderWisdom();if(restore)window.scrollTo(0,scrolls.get(location.hash)||0);}}}
 }
 function remember(){if(currentRoute)scrolls.set(currentRoute,window.scrollY)}
 function enter({restore=false}={}){
  cancelSelectionDrag();
  currentRoute=location.hash;query=queries.get(queryKey())||'';route='wisdom';
  saveOpenRoute();
  window.renderWisdom();if(data){window.scrollTo(0,restore?(scrolls.get(currentRoute)||0):0);refreshDay()}else load({restore});
 }
 function refreshDay(){if(active()&&(['','#','#/'].includes(location.hash)||location.hash.startsWith('#/library/'))&&data&&!loading&&data.day!==new Intl.DateTimeFormat('en-CA',{timeZone:data.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))load()}
 function navigate(path='',{replace=false}={}){
  remember();route='wisdom';epoch++;const depth=(history.state?.depth||0)+(replace?0:1),previousRoute=replace?history.state?.previousRoute:location.hash;
  history[replace?'replaceState':'pushState']({wisdom:true,domain:true,depth,previousRoute},'',path?'#'+path:location.pathname);enter();
 }
 // Ratings acknowledge the tap immediately and serialize saves per chapter.
 // Never replace the reader (or its current page) with a whole-library save response.
 const ratingWrites=new Map();
 function paintRating(id,value){
  document.querySelectorAll('[data-wisdom-rate]').forEach(b=>{if(b.dataset.wisdomRate===id){const on=+b.dataset.value===value;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));}});
 }
 function mergeRatingState(next){
  // Other mutations return a library snapshot which may predate a rating save.
  const ratings=new Map((data?.entries||[]).map(e=>[e.id,e.rating]));
  next.entries?.forEach(e=>{if(ratings.has(e.id))e.rating=ratings.get(e.id)});
  return next;
 }
 function rate(payload){
  const item=data.entries.find(e=>e.id===payload.id);if(!item)return;
  let pending=ratingWrites.get(item.id);
  if(!pending){pending={confirmed:item.rating,desired:payload.value};ratingWrites.set(item.id,pending)}else pending.desired=payload.value;
  item.rating=payload.value;paintRating(item.id,payload.value);syncUpdateHold();
  if(pending.running)return;
  pending.running=true;
  (async()=>{
   try{
    while(pending.desired!==pending.confirmed){
     const value=pending.desired;
     await api('wisdom/reaction',{kind:'entry',id:item.id,field:'rating',value});
     pending.confirmed=value;
    }
    toast(pending.confirmed>0?'Noted. More like this.':pending.confirmed<0?'Noted. Less like this.':'Rating cleared.');
   }catch(e){
    const current=data.entries.find(e=>e.id===item.id);if(current)current.rating=pending.confirmed;
    paintRating(item.id,pending.confirmed);toast('Couldn’t save your rating. Tap again to retry.');
   }finally{ratingWrites.delete(item.id);syncUpdateHold()}
  })();
 }
 async function change(payload,button){
  if(payload.field==='rating'){rate(payload);return}
  if(writing)return;writing=true;syncUpdateHold();
  document.querySelectorAll('[data-wisdom-entry],[data-wisdom-pref]').forEach(e=>e.disabled=true);
  try{
   const d=await api('wisdom/reaction',payload);data=mergeRatingState(d);writing=false;syncUpdateHold();
   const y=window.scrollY,keep=reader()?page:null;if(active()){window.renderWisdom();window.scrollTo(0,y);if(keep!==null)go(keep,false)}
   toast(payload.field==='rating'?(payload.value>0?'Noted. More like this.':payload.value<0?'Noted. Less like this.':'Rating cleared.'):payload.field==='more'?(payload.value?'You’ll see more from this thinker.':'Thinker preference reset.'):payload.field==='done'?'Finished and archived.':payload.field==='archived'?(payload.value?'Archived.':'Restored to To read.'):(payload.value?'Starred.':'Star removed.'));
  }catch(e){writing=false;syncUpdateHold();toast('Couldn’t save. Tap again to retry.');document.querySelectorAll('[data-wisdom-entry],[data-wisdom-pref],[data-wisdom-rate]').forEach(e=>e.disabled=false);}
 }

 let sheetPop=false;
 // Sheets own one history entry: Back (or Cancel/Done, which call history.back) closes the sheet and stays put.
 window.addEventListener('popstate',ev=>{const sh=document.querySelector('.wb-sheet');if(sh||sheetPop){sh?.remove();sheetPop=false;if(noteState)noteClosed();ev.stopImmediatePropagation()}},true);
 function closeSheet(){if(sheetPop)history.back();else{document.querySelector('.wb-sheet')?.remove();if(noteState)noteClosed()}}
 // Request a new collection (James, 12 Oct): stored by Wisdom first, then handed to your Wizard to build.
 let reqState={phase:'form',text:'',seq:null,error:''};
 function sheetHtml(){
  const s=reqState;
  if(s.phase==='sent')return `<div class="wb-sheet-card" role="dialog" aria-modal="true" aria-label="Request sent"><small>Requested</small><h3>Your Wizard is on it</h3><p class="wb-req-ok">Requested. Your Wizard is building it; review and enable the staged collection in Library when ready.</p><blockquote class="wb-req-quote">${esc(s.text)}</blockquote><div class="wb-sheet-actions"><button class="wb-primary" data-sheet-close>Done</button></div></div>`;
  if(s.phase==='unsent')return `<div class="wb-sheet-card" role="dialog" aria-modal="true" aria-label="Request saved, not sent"><small>Saved, not sent</small><h3>Your request is saved, not sent</h3><p class="wb-req-err">${s.seq?'Your request is saved in Wisdom, but it couldn’t be handed to your Wizard':'Couldn’t reach Wisdom, so nothing was saved'}: ${esc(s.error)}.</p><blockquote class="wb-req-quote">${esc(s.text)}</blockquote><div class="wb-sheet-actions"><button class="wb-sheet-cancel" data-sheet-close>Close</button><button class="wb-primary" data-req-retry>Retry</button></div></div>`;
  const busy=s.phase==='sending';
  return `<div class="wb-sheet-card" role="dialog" aria-modal="true" aria-label="Request a new collection"><small>Request</small><h3>Request a new collection</h3><p>What do you want to read? A topic, a thinker, a book, a question. Your Wizard can build it when collection generation is configured.</p><div class="wb-req-field"><textarea id="wb-req-text" rows="4" maxlength="2000" placeholder="e.g. Nāgārjuna and emptiness, for a beginner" ${busy?'disabled':''}>${esc(s.text)}</textarea></div><div class="wb-sheet-actions"><button class="wb-sheet-cancel" data-sheet-close>Cancel</button><button class="wb-primary" data-req-send ${busy?'disabled':''}>${busy?'Sending…':'Send'}</button></div></div>`;
 }
 let updateHold=null;
 function syncUpdateHold(){const unsaved=writing||ratingWrites.size>0||noteDirty()||reqState.phase==='sending'||(!reqState.seq&&reqState.phase!=='sent'&&!!reqState.text.trim());if(unsaved&&!updateHold)updateHold=WizardApp.update.hold('Wisdom unsaved request or note');else if(!unsaved&&updateHold){updateHold.release();updateHold=null}}
 function paintSheet(){
  syncUpdateHold();
  const sh=document.querySelector('.wb-sheet');if(!sh)return;sh.innerHTML=sheetHtml();
  sh.querySelectorAll('[data-sheet-close]').forEach(b=>b.onclick=closeSheet);
  const ta=sh.querySelector('#wb-req-text');if(ta)ta.oninput=()=>{reqState.text=ta.value;syncUpdateHold()};
  sh.querySelector('[data-req-send]')?.addEventListener('click',()=>sendRequest());
  sh.querySelector('[data-req-retry]')?.addEventListener('click',()=>sendRequest());
 }
 function openRequest(text){
  if(document.querySelector('.wb-sheet'))return;
  reqState={phase:'form',text:text||((reqState.phase!=='sent')?reqState.text:''),seq:null,error:''};
  const sh=document.createElement('div');sh.className='wb-sheet';sh.onclick=ev=>{if(ev.target===sh)closeSheet()};document.body.appendChild(sh);
  try{history.pushState(history.state,'',location.href);sheetPop=true}catch{}
  paintSheet();const ta=sh.querySelector('#wb-req-text');if(ta&&!text)ta.focus();
 }
 // Note (James, 18 Oct): a typed comment on a passage. The note field is an ordinary text field,
// so the Wizard orb dictates straight into it when it is focused; Wisdom itself ships no microphone.
let noteState=null;const noteDrafts=new Map();
const noteKey=a=>a.id>0?'h'+a.id:(a.entry||'')+':'+a.start+':'+a.end;
function noteDirty(){return !!noteState&&(noteState.busy||noteState.value.trim()!==noteState.note.trim())}
function noteHtml(){
 const a=noteState,has=!!a.note,can=!a.busy&&a.value.trim()!==a.note.trim();
 const hint=window.WizardApp?.hosted?'<p class="wb-note-hint">Type, or tap the orb to dictate.</p>':'';
 return `<div class="wb-sheet-card wb-note-card" role="dialog" aria-modal="true" aria-label="${has?'Edit note':'Add a note'}"><small>${has?'Your note':'Note'}</small><blockquote class="wb-note-quote">${esc(a.text)}</blockquote><div class="wb-req-field"><textarea id="wb-note-text" rows="4" maxlength="8000" placeholder="Your thoughts on this passage" aria-label="Your note" ${a.busy?'disabled':''}>${esc(a.value)}</textarea></div>${hint}${a.error?`<p class="wb-req-err" role="alert">${esc(a.error)}</p>`:''}<div class="wb-sheet-actions">${has?`<button class="wb-sheet-cancel wb-note-delete" data-note-delete ${a.busy?'disabled':''}>Delete</button>`:''}<button class="wb-sheet-cancel" data-sheet-close>Cancel</button><button class="wb-primary" data-note-save ${can?'':'disabled'}>${a.busy?'Saving…':'Save'}</button></div></div>`;
}
function paintNote(){
 syncUpdateHold();
 const sh=document.querySelector('.wb-sheet.wb-note');if(!sh||!noteState)return;
 const focused=document.activeElement?.id==='wb-note-text';sh.innerHTML=noteHtml();
 sh.querySelectorAll('[data-sheet-close]').forEach(b=>b.onclick=closeSheet);
 const ta=sh.querySelector('#wb-note-text'),save=sh.querySelector('[data-note-save]');
 // Orb dictation inserts words with an input event, exactly like typing.
 ta.oninput=()=>{noteState.value=ta.value;noteDrafts.set(noteKey(noteState),ta.value);syncUpdateHold();save.disabled=noteState.busy||ta.value.trim()===noteState.note.trim()};
 save.onclick=()=>saveNote(ta.value);
 sh.querySelector('[data-note-delete]')?.addEventListener('click',()=>saveNote(''));
 if(focused){ta.focus({preventScroll:true});ta.setSelectionRange(ta.value.length,ta.value.length)}
}
function openNote(a){
 if(document.querySelector('.wb-sheet'))return;
 a={...a,entry:a.r?.dataset.read||a.entry};
 noteState={...a,value:noteDrafts.get(noteKey(a))??a.note,busy:false,error:''};
 if(a.r)freezeReader(a.r);
 const sh=document.createElement('div');sh.className='wb-sheet wb-note';sh.onclick=ev=>{if(ev.target===sh)closeSheet()};document.body.appendChild(sh);
 try{history.pushState(history.state,'',location.href);sheetPop=true}catch{}
 paintNote();const ta=sh.querySelector('#wb-note-text');if(ta){ta.focus({preventScroll:true});ta.setSelectionRange(ta.value.length,ta.value.length)}
}
function noteClosed(){const a=noteState;noteState=null;syncUpdateHold();if(a?.r)unfreezeReader()}
async function saveNote(value){
 const a=noteState;if(!a||a.busy)return;const note=String(value).trim();
 a.busy=true;a.error='';paintNote();
 try{
  let d;
  if(a.id>0)d=await api('wisdom/highlight',{action:'note',id:a.id,note});
  else{
   // A fresh selection is saved as a highlight together with its note; overlaps merge server-side, keeping notes.
   const r=a.r,m=merged(r,a.start,a.end),text=textFor(flowOf(r),m.s,m.e);
   d=await api('wisdom/highlight',{action:'add',entry_id:r.dataset.read,start:m.s,end:m.e,text,body_sha256:r.dataset.bodySha256,note});
  }
  data.highlights=d.highlights;noteDrafts.delete(noteKey(a));
  if(noteState===a){a.busy=false;a.note=a.value=note;closeSheet()}
  const r=reader();if(r)paint(r);else if(location.hash==='#/highlights')enter();
  toast(note?'Note saved.':'Note deleted.');
 }catch(err){
  if(noteState!==a)return toast('Couldn’t save your note. Open Note again; your words are kept.');
  a.busy=false;a.error=err.status===400?(err.message||'This chapter changed. Copy your note, then reopen the chapter.'):'Couldn’t save. Your note is kept here; tap Save to retry.';paintNote();
 }
}
async function postRequest(body){
  const r=await fetch(new URL('api/wisdom/request',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  let d={};try{d=await r.json()}catch{}
  return {ok:r.ok,d};
 }
 async function sendRequest(seq){
  if(reqState.phase==='sending')return;
  seq=seq||reqState.seq;
  const text=(reqState.text||'').trim();if(!seq&&!text){toast('Describe the collection first.');return}

  reqState.phase='sending';paintSheet();
  try{
   const {ok,d}=await postRequest(seq?{seq}:{text});
   if(d.requests&&data){data.requests=d.requests;if(active()&&parseRoute()[1]==='browse'){const y=window.scrollY;window.renderWisdom();window.scrollTo(0,y)}}
   if(d.request){reqState.seq=d.request.seq;reqState.text=d.request.text}
   if(ok&&d.sent){reqState.phase='sent'}
   else{reqState.phase=d.request?'unsent':'form';reqState.error=d.error||'Something went wrong';if(!d.request)toast(reqState.error)}
  }catch(e){reqState.phase='unsent';reqState.error=e.name==='TimeoutError'?'Wisdom took too long to answer':'Wisdom couldn’t be reached'}
  syncUpdateHold();
  if(document.querySelector('.wb-sheet'))paintSheet();
  else toast(reqState.phase==='sent'?'Requested. your Wizard is building it.':'Saved, but not sent to your Wizard. Retry from Browse.');
 }
 function bindLinks(root){
  root.querySelectorAll('[data-wisdom-route]').forEach(e=>e.onclick=ev=>{
   ev.preventDefault();ev.stopPropagation();
   if(e.dataset.wisdomReaderBack){readerBack();return}
   if(e.dataset.wisdomBack&&history.state?.depth>0){history.back();return}
   navigate(e.dataset.wisdomRoute,{replace:!!(e.dataset.wisdomReplace||e.dataset.wisdomBack)});
   if(e.dataset.wisdomFocus==='search')document.getElementById('wb-q')?.focus();
  });
  root.querySelectorAll('[data-wisdom-request]').forEach(b=>b.onclick=()=>openRequest(b.dataset.wisdomRequest));
  root.querySelectorAll('[data-wisdom-retry-req]').forEach(b=>b.onclick=()=>{const r=(data.requests||[]).find(x=>x.seq===+b.dataset.wisdomRetryReq);if(!r)return;openRequest(r.text);reqState.seq=r.seq;sendRequest(r.seq)});
 }
 function updateResults(){const el=document.getElementById('wb-results');if(!el)return;el.closest('.wb-browse,.wb-library-shelf')?.classList.toggle('is-searching',!!query.trim());el.innerHTML=results();bindLinks(el);el.querySelectorAll('img').forEach(i=>i.onerror=()=>{i.style.display='none'})}
 function bindSearch(){
  const q=document.getElementById('wb-q');if(!q)return;
  q.oninput=()=>{query=q.value;queries.set(queryKey(),query);updateResults()};
  q.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();q.blur()}};
 }
 // Paged reader: one horizontal track of full-screen pages (story-style, not a book).
 const positionWrites=new Map();let opened='',exactFrac=null,landEnd='';
 const posKey=id=>'wisdom:'+new URL('.',location.href).pathname+':pos:'+id;
 const CTL_SLOP=24;let page=0,pages=1,pageW=0,textFrom=0,textPages=1,drag=null,suppressClick=false,textAnchor=null,mouseSel=null,lastPointer='',wheelAcc=0,wheelLock=0,wheelIdle=0;
 function reader(){return document.querySelector('.wb-reader')}
 // Character offset of the first word that starts on the text page in view (a word hyphenated across the
 // page break belongs to the previous page). Kept until the page turns.
 function rememberLine(r){
  r=r||reader();if(!r||!(pageW>0&&page>=textFrom&&page<textFrom+textPages))return null;
  if(textAnchor&&textAnchor.read===r.dataset.read&&textAnchor.page===page)return textAnchor.off;
  hlWords=null;const c=page-textFrom,w=words().find(w=>w.rects[0].l>=c*pageW-1&&w.rects[0].l<(c+1)*pageW);
  if(!w)return null;textAnchor={read:r.dataset.read,off:w.s,page};return w.s;
 }
 function layout(keep){
  cancelSelectionDrag();
  const r=reader();if(!r||r.dataset.discussionFrozen)return;const stage=r.querySelector('.wb-stage'),flow=r.querySelector('.wb-flow'),track=r.querySelector('.wb-track');
  // Relayouts (full screen, rotation, text size) keep the line you were reading: anchor on the first word of the
  // text page in view and land on whichever new page holds it. Repeated relayouts without a page turn reuse the
  // same anchor, so entering and leaving full screen returns to the same page (James, 19 Oct 2026).
  const wasText=keep&&pageW>0&&page>=textFrom&&page<textFrom+textPages,wasEnd=keep&&page>=pages-1&&pages>1,wasLead=keep&&page<textFrom;
  let anchor=null;
  if(wasText)anchor=rememberLine(r);
  hlWords=null;if(hlAct){hlAct=null;hidePop();paint(r)}
  if(glossOpen())closeGloss();
  // Relayouts (fonts arriving, resize) keep the exact reading fraction; re-deriving it from a rounded page drifted forward a page.
  const exact=keep&&exactFrac&&exactFrac.page===page,frac=keep&&pages>1?(exact?exactFrac.f:page/(pages-1)):null;
  const W=stage.clientWidth,H=stage.clientHeight;pageW=W;
  const P=W>760?Math.round((W-660)/2):Math.max(matchMedia('(hover:hover) and (pointer:fine)').matches?58:24,Math.round(W*.075));// desktop: room for the edge arrows
  const T=r.querySelector('.wb-top').offsetHeight+6,B=r.querySelector('.wb-foot').offsetHeight+18;
  flow.style.cssText=`width:${W}px;height:${H}px;padding:${T}px ${P}px ${B}px;column-width:${W-2*P}px;column-gap:${2*P}px;column-fill:auto`;
  const s=flow.querySelector('.wb-sentinel'),left=s.getBoundingClientRect().left-flow.getBoundingClientRect().left;
  textPages=Math.max(1,Math.floor(left/W)+1);
  flow.style.width=(textPages*W)+'px';flow.style.columnCount=textPages;
  r.querySelectorAll('.wb-slide').forEach(x=>{x.style.width=W+'px';x.style.height=H+'px'});
  textFrom=r.querySelectorAll('.wb-track>.wb-slide:not(.wb-end)').length;
  pages=textFrom+textPages+1;
  let anchored=null;
  if(anchor!==null){hlWords=null;const w=words().find(w=>w.e>anchor);if(w){page=textFrom+Math.max(0,Math.min(textPages-1,Math.floor((w.rects[0].l+1)/W)));exactFrac=null;anchored=anchor}}
  if(anchored!==null);
  else if(wasEnd){page=pages-1;exactFrac=null}
  else if(wasLead){exactFrac=null}
  else if(frac!==null){page=Math.round(frac*(pages-1));exactFrac=exact?{f:frac,page}:null}
  else if(landEnd&&landEnd===r.dataset.read){landEnd='';page=pages-1;exactFrac=null}
  else{const e=data.entries.find(x=>x.id===r.dataset.read);let saved=(e?.progress||0)/100;try{const v=localStorage.getItem(posKey(r.dataset.read));if(v!==null)saved=Number(v)||0}catch{}page=e&&Number.isFinite(saved)&&saved>0&&(saved<1||(!e.read||location.hash===resumedRoute)&&saved<=1)?Math.round(saved*(pages-1)):0;exactFrac=page>0?{f:saved,page}:null}
  go(page,false);
  if(anchored!==null)textAnchor={read:r.dataset.read,off:anchored,page};
 }
 function go(n,animate=true,selectionTurn=false){
  if(!selectionTurn)cancelSelectionDrag();
  const r=reader();if(!r)return;const track=r.querySelector('.wb-track');
  const to=Math.max(0,Math.min(pages-1,n));if(textAnchor&&(textAnchor.page!==to||textAnchor.read!==r.dataset.read))textAnchor=null;if(to!==page&&hlAct&&!selectionTurn)deactivate();if(to!==page&&glossOpen())closeGloss();page=to;
  track.style.transition=animate?'transform .34s cubic-bezier(.2,.8,.2,1)':'none';
  track.style.transform=`translate3d(${-page*pageW}px,0,0)`;
  r.querySelector('.wb-count').textContent=`${page+1} / ${pages}`;
  r.querySelector('.wb-bar>span').style.transform=`scaleX(${pages>1?page/(pages-1):1})`;
  const e=data.entries.find(x=>x.id===r.dataset.read),t=Math.min(textPages,Math.max(0,page-textFrom+1));
  r.querySelector('.wb-left').textContent=page>=pages-1?'Finished':page<textFrom?`${e.minutes} min read`:`${Math.max(1,Math.ceil(e.minutes*(1-t/textPages)))} min left`;
  r.dataset.at=page===0?'opener':page>=pages-1?'end':'text';
  // Desktop edge arrows hide where a click would do nothing.
  r.dataset.noPrev=String(page===0&&!r.dataset.prevRoute);r.dataset.noNext=String(page>=pages-1&&!r.querySelector('.wb-next'));
  const progress=Math.round(pages>1?page/(pages-1)*100:0);
  const keepExact=exactFrac&&exactFrac.page===page;
  try{localStorage.setItem(posKey(e.id),String(keepExact?exactFrac.f:pages>1?page/(pages-1):0))}catch{}
  if(!keepExact)exactFrac=null;
  if(e.progress!==progress||opened!==e.id){opened=e.id;e.progress=progress;e.opened_at=new Date().toISOString();const prior=positionWrites.get(e.id)||Promise.resolve();const next=prior.catch(()=>{}).then(()=>api('wisdom/reaction',{kind:'entry',id:e.id,field:'progress',value:progress})).catch(()=>toast('Reading position is saved on this device, but could not sync to Wisdom.'));positionWrites.set(e.id,next)}
  if(page>=pages-1&&!(e.read&&e.archived)&&!writing){const was=[e.read,e.archived];e.read=e.archived=true;api('wisdom/reaction',{kind:'entry',id:e.id,field:'done',value:true}).then(d=>{data=mergeRatingState(d)}).catch(()=>{[e.read,e.archived]=was})}
 }
 function step(d){
  const r=reader();if(!r)return;
  if(d>0&&page>=pages-1){const n=r.querySelector('.wb-next');if(n)navigate(n.dataset.wisdomRoute,{replace:true});return}
  // Back from a chapter's cover turns to the previous chapter's last page (James, 18 Oct).
  if(d<0&&page===0&&r.dataset.prevRoute){const to=r.dataset.prevRoute;landEnd=to.split('/')[2]||'';navigate(to,{replace:true});return}
  go(page+d);
 }
 // Kindle-style highlights (James, 10 Oct). A highlight is a [start,end) character range in the reading's
 // rendered text, so it survives text-size changes and re-pagination. Wisdom draws its own selection: the
 // native one is off, so Android's Copy/Translate/Select-all toolbar never appears. Long-press a word and
 // drag; lifting the finger on five words or more saves the highlight at once (no extra tap). Fewer words
 // (a single long-pressed word, a short phrase) stay a plain selection, drawn blue, with Highlight / Copy /
 // Search (James, 12 Oct). Tap a highlight to get drag handles that grow or shrink it word by word, plus
 // Copy, Search and Remove highlight. Search opens Wizard Search on its own desk beside Wisdom.
 const HL_MIN=5;
 const flowOf=r=>r?.querySelector('.wb-flow');
// Keep existing body offsets stable. The opening quote occupies the range AFTER
// the body in the highlight index, although its slide appears before it visually.
// The cover title and summary come after the quote (James, 18 Oct: every reader word is selectable).
const HL_ROOTS='.wb-flow,.wb-epigraph blockquote,.wb-opener-copy h1,.wb-opener-copy p';
const highlightRoots=r=>[flowOf(r),r?.querySelector('.wb-epigraph blockquote'),r?.querySelector('.wb-opener-copy h1'),r?.querySelector('.wb-opener-copy p')].filter(Boolean);
function highlightNodes(flow){
 const nodes=[];
 for(const root of highlightRoots(flow.closest('.wb-reader'))){
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode()))nodes.push(n);
 }
 return nodes;
}
 var hlWords=null,hlSel=null,hlAct=null,hlPress=0,hlHandle=null;
 // A held selection owns its corner timer. Never use step(): its end-of-book
 // action opens another chapter. Only body columns share contiguous offsets;
 // the epigraph is indexed AFTER the body and must not cross into it.
 const HL_DWELL=950;
 var hlCorner=null;
 function clearCorner(){if(hlCorner)clearTimeout(hlCorner.timer);hlCorner=null}
 function cancelSelectionDrag(){
  clearTimeout(hlPress);hlPress=0;clearCorner();
  const active=hlSel||hlHandle,r=reader();
  if(hlHandle&&hlAct){hlAct.start=hlHandle.start;hlAct.end=hlHandle.stop}
  hlSel=null;hlHandle=null;drag=null;
  if(active&&r){r.querySelectorAll('.wb-handle.drag').forEach(h=>h.classList.remove('drag'));paint(r);if(hlAct)showActive()}
 }
 function cornerDirection(r,x,y){
  if(page<textFrom||page>=textFrom+textPages)return 0;
  const q=r.querySelector('.wb-stage').getBoundingClientRect(),edge=Math.min(72,q.width*.18);
  if(y<q.bottom-88||y>q.bottom||x<q.left||x>q.right)return 0;
  return x>=q.right-edge&&page<textFrom+textPages-1?1:x<=q.left+edge&&page>textFrom?-1:0;
 }
 function selectionWord(r,i){
  if(i<0)return;
  const L=words();
  if(hlSel){hlSel.c=i;const a=L[Math.min(hlSel.a,i)],b=L[Math.max(hlSel.a,i)];paint(r,{start:a.s,end:b.e,pending:Math.abs(i-hlSel.a)+1<HL_MIN});return}
  if(!hlHandle||!hlAct)return;
  let s=hlAct.start,e=hlAct.end;
  if(hlHandle.end){const first=L.find(w=>w.s>=s);e=Math.max(L[i].e,first?first.e:e)}else{const last=[...L].reverse().find(w=>w.e<=e);s=Math.min(L[i].s,last?last.s:s)}
  if(s===hlAct.start&&e===hlAct.end)return;
  hlAct.start=s;hlAct.end=e;paint(r,hlAct.pending?undefined:{start:s,end:e,replaces:hlHandle.replaces});
  const rects=rectsFor(s,e);if(rects.length){const [hs,he]=r.querySelectorAll('.wb-handle');hs.style.transform=`translate3d(${rects[0].left}px,${rects[0].bottom}px,0)`;he.style.transform=`translate3d(${rects[rects.length-1].right}px,${rects[rects.length-1].bottom}px,0)`}
 }
 function columnEdgeWord(r,last){
  const fr=flowOf(r).getBoundingClientRect(),q=r.querySelector('.wb-stage').getBoundingClientRect();
  const visible=words().map((w,i)=>({w,i})).filter(({w})=>w.rects.some(b=>b.l+fr.left>=q.left-2&&b.r+fr.left<=q.right+2));
  return visible.length?(last?visible[visible.length-1]:visible[0]).i:-1;
 }
 function holdCorner(r,ev){
  const owner=hlSel||hlHandle,direction=cornerDirection(r,ev.clientX,ev.clientY);
  if(!owner||!direction){clearCorner();return}
  if(hlCorner?.owner===owner&&hlCorner.direction===direction)return;
  clearCorner();
  // The footer can be too far below the final line for ordinary word hit tests.
  selectionWord(r,columnEdgeWord(r,direction>0));
  const corner=hlCorner={owner,direction,timer:0};
  const turn=()=>{
   if(hlCorner!==corner||reader()!==r||!r.isConnected||(hlSel||hlHandle)!==owner){clearCorner();return}
   if(cornerDirection(r,ev.clientX,ev.clientY)!==direction){clearCorner();return}
   // Snap immediately: animated column rects would hit-test against moving text.
   go(page+direction,false,true);
   selectionWord(r,columnEdgeWord(r,direction<0));
   corner.timer=setTimeout(turn,HL_DWELL);
  };
  corner.timer=setTimeout(turn,HL_DWELL);
 }
 function popOpen(){const p=reader()?.querySelector('.wb-hlpop');return !!(p&&!p.hidden)}
 function unconfirm(p){if(!p.dataset.confirm)return;delete p.dataset.confirm;const rb=p.querySelector('[data-hl-act="remove"]');if(rb)rb.innerHTML='<span class="wb-swatch off"></span>Remove<span class="wb-wide"> highlight</span>'}
 function hidePop(){const r=reader();const p=r?.querySelector('.wb-hlpop');if(p){p.hidden=true;unconfirm(p)}r?.querySelectorAll('.wb-handle').forEach(h=>h.hidden=true)}
 function buzz(){try{(window.parent!==window&&window.parent.WizardOSNative?.haptic)?window.parent.WizardOSNative.haptic(12):navigator.vibrate?.(12)}catch{}}
 // Word index: every word's character range and line boxes, relative to the flow so page turns don't stale it.
 function words(){
  const flow=flowOf(reader());if(!flow)return [];
  if(hlWords&&hlWords.flow===flow)return hlWords.list;
  const fr=flow.getBoundingClientRect(),list=[],rg=document.createRange();let pos=0;
  for(const n of highlightNodes(flow)){
   const re=/\S+/g;let m;
   while((m=re.exec(n.nodeValue))){
    rg.setStart(n,m.index);rg.setEnd(n,m.index+m[0].length);
    const rects=[...rg.getClientRects()].filter(x=>x.width>0).map(x=>({l:x.left-fr.left,t:x.top-fr.top,r:x.right-fr.left,b:x.bottom-fr.top}));
    if(rects.length)list.push({s:pos+m.index,e:pos+m.index+m[0].length,rects});
   }
   pos+=n.nodeValue.length;
  }
  hlWords={flow,list};return list;
 }
 // The word under (or nearest on the same line to) a screen point, on the page in view.
 function wordAt(x,y){
  const flow=flowOf(reader());if(!flow)return -1;const fr=flow.getBoundingClientRect(),px=x-fr.left,py=y-fr.top,L=words();
  let best=-1,score=1e9;
  L.forEach((wd,i)=>{for(const q of wd.rects){const ax=q.l+fr.left;if(ax<-2||q.r+fr.left>innerWidth+2)continue;
   const dx=Math.max(q.l-px,0,px-q.r),dy=Math.max(q.t-py,0,py-q.b),sc=dy*4+dx;if(sc<score){score=sc;best=i}}});
  return score<160?best:-1;
 }
 // Line boxes for a range on screen. A drop cap's tall box is left out so handles sit on the text line.
 function rectsFor(s,e){const flow=flowOf(reader()),fr=flow.getBoundingClientRect();const rs=words().filter(w=>w.s<e&&w.e>s).flatMap(w=>w.rects.map(q=>({left:q.l+fr.left,top:q.t+fr.top,right:q.r+fr.left,bottom:q.b+fr.top}))).filter(q=>q.right>0&&q.left<innerWidth);
  const lo=Math.min(...rs.map(q=>q.bottom-q.top));return rs.filter(q=>q.bottom-q.top<=lo*1.6)}
 // Readable text for a range: paragraphs keep their breaks when copied.
 function textFor(flow,s,e){
  let pos=0,out='',lastBlock=null;
  for(const n of highlightNodes(flow)){
   const L=n.nodeValue.length,a=Math.max(s,pos),b=Math.min(e,pos+L);
   if(a<b){const blk=n.parentElement.closest('p,li,blockquote,h1,h2,h3,h4');if(lastBlock&&blk!==lastBlock)out+='\n\n';lastBlock=blk;out+=n.nodeValue.slice(a-pos,b-pos)}
   pos+=L;if(pos>=e)break;
  }
  return out.replace(/[ \t]+\n/g,'\n').trim();
 }
 // What the page shows: saved highlights, with a live range (being selected or adjusted) merged over them.
 function shown(r,live){
  let list=(data.highlights||[]).filter(h=>currentAnchor(h)&&h.entry_id===r.dataset.read);
  if(!live&&hlAct&&hlAct.pending)live={start:hlAct.start,end:hlAct.end,pending:true};
  if(!live)return list;
  // A selection that won't save on its own shows exactly what's selected, on top of any highlight.
  if(live.pending)return list.concat([{id:'live',start:live.start,end:live.end,live:true,sel:true}]);
  list=list.filter(h=>h.id!==live.replaces);
  const over=list.filter(h=>h.start<live.end&&h.end>live.start);
  const s=Math.min(live.start,...over.map(h=>h.start)),e=Math.max(live.end,...over.map(h=>h.end));
  return list.filter(h=>!over.includes(h)).concat([{id:'live',start:s,end:e,live:true}]);
 }
 function paint(r,live){
  const flow=flowOf(r);if(!flow)return;
  for(const root of highlightRoots(r)){root.querySelectorAll('mark.wb-hl').forEach(m=>m.replaceWith(...m.childNodes));root.normalize()}
  for(const h of shown(r,live).sort((a,b)=>(a.sel?1:0)-(b.sel?1:0)||a.start-b.start)){
   const nodes=[];let pos=0;
   for(const n of highlightNodes(flow)){nodes.push([n,pos]);pos+=n.nodeValue.length}
   for(const [node,s] of nodes){
    const L=node.nodeValue.length,a=Math.max(h.start,s),b=Math.min(h.end,s+L);if(a>=b)continue;
    let t=node;if(b<s+L)t.splitText(b-s);if(a>s)t=t.splitText(a-s);
    if(!t.nodeValue.trim()&&!t.parentElement.closest('p,li,blockquote,h1,h2,h3,h4'))continue;
    const m=document.createElement('mark');m.className='wb-hl'+(h.sel?' sel':h.live||(hlAct&&h.id===hlAct.id)?' on':'');m.dataset.hl=h.id;if(h.note)m.dataset.noted='1';if(window.WisdomDiscussion?.has(r.dataset.read,r.dataset.bodySha256,h.start,h.end))m.dataset.discussed='1';t.replaceWith(m);m.appendChild(t);
   }
  }
  // ::first-letter paints a drop cap outside its <mark>, so mirror the mark's state onto the paragraph.
  flow.querySelectorAll('h2+p').forEach(p=>{const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())&&!n.nodeValue.trim());const m=n&&n.parentElement.closest('mark.wb-hl');if(m&&p.contains(m)){p.dataset.capHl=m.classList.contains('sel')?'sel':m.classList.contains('on')?'on':'1';if([...m.textContent.trim()].length===1)m.classList.add('wb-capmark')}else delete p.dataset.capHl});
 }
 // Range covered by the live selection, merged with any highlight it touches (what gets saved).
 function merged(r,s,e,replaces){const over=(data.highlights||[]).filter(h=>currentAnchor(h)&&h.entry_id===r.dataset.read&&h.id!==replaces&&h.start<e&&h.end>s);return {s:Math.min(s,...over.map(h=>h.start)),e:Math.max(e,...over.map(h=>h.end))}}
 // Show handles + Copy / Remove for the active highlight.
 function showActive(){
  const r=reader();if(!r||!hlAct)return hidePop();
  const rects=rectsFor(hlAct.start,hlAct.end);if(!rects.length)return hidePop();
  const [hs,he]=r.querySelectorAll('.wb-handle'),first=rects[0],last=rects[rects.length-1];
  hs.hidden=he.hidden=false;
  hs.style.transform=`translate3d(${first.left}px,${first.bottom}px,0)`;he.style.transform=`translate3d(${last.right}px,${last.bottom}px,0)`;
  // Line height under each handle (a drop cap makes the first box tall; cap it at a normal line).
  hs.dataset.lineh=Math.min(44,Math.round(first.bottom-first.top));he.dataset.lineh=Math.min(44,Math.round(last.bottom-last.top));
  const p=r.querySelector('.wb-hlpop'),sel=!!hlAct.pending;p.setAttribute('aria-label',sel?'Selection':'Highlight');
  p.querySelector('[data-hl-act="ask"]').textContent=window.WisdomDiscussion?.has(r.dataset.read,r.dataset.bodySha256,hlAct.start,hlAct.end)?'Open discussion':'Ask AI';
  p.querySelector('[data-hl-act="highlight"]').hidden=!sel;p.querySelector('[data-hl-act="remove"]').hidden=sel;
  const saved=sel?null:(data.highlights||[]).find(x=>x.id===hlAct.id),nb=p.querySelector('[data-hl-act="note"]');
  nb.classList.toggle('has',!!saved?.note);nb.setAttribute('aria-label',saved?.note?'Edit note':'Add a note');
  if(p.dataset.confirm&&p.dataset.confirm!==String(hlAct.id))unconfirm(p);
  p.style.left='0px';p.hidden=false;const w=p.offsetWidth,h=p.offsetHeight,top0=r.querySelector('.wb-top').getBoundingClientRect().bottom;
  // Above the passage, clear of the handles below it; below the handles when the passage sits at the top.
  let top=Math.min(...rects.map(q=>q.top))-12-h;if(top<top0+4)top=Math.max(...rects.map(q=>q.bottom))+40;
  const cx=(Math.min(...rects.map(q=>q.left))+Math.max(...rects.map(q=>q.right)))/2;
  p.style.top=Math.min(innerHeight-h-60,top)+'px';p.style.left=Math.max(10,Math.min(innerWidth-w-10,cx-w/2))+'px';
 }
 // Forgiving tap target: a tap in the gap between a highlight's lines, or just beside it, still counts.
 function markNear(x,y){
  let best=null,score=1e9;
  reader()?.querySelectorAll(HL_ROOTS.split(',').map(x=>x+' mark.wb-hl').join(',')).forEach(m=>{for(const q of m.getClientRects()){
   if(!q.width||q.right<0||q.left>innerWidth)continue;const pad=Math.max(12,q.height*.7);
   const dx=Math.max(q.left-12-x,0,x-q.right-12),dy=Math.max(q.top-pad-y,0,y-q.bottom-pad);
   if(dx===0&&dy===0){const d=Math.abs(y-(q.top+q.bottom)/2);if(d<score){score=d;best=m}}}});
  return best;
 }
 function deactivate(){if(!hlAct)return;hlAct=null;const r=reader();hidePop();if(r)paint(r)}
 // A short selection: shown with handles and the pop-up, saved only if James taps Highlight.
 function select(r,s,e){hlAct={id:'sel',pending:true,start:s,end:e};paint(r);showActive()}
 // Look up always explains this passage with the independent fast AI route.
 // The explanation streams into the popover; only the validated final text is kept.
 // Successes are edition/context keyed; closed or superseded popovers stay closed.
 let lookupSerial=0,lookupAbort=null;const lookupCache=new Map(),LOOKUP_MODEL='claude-haiku-4-5';
 function lookupCancel(){lookupSerial++;if(lookupAbort){lookupAbort.abort();lookupAbort=null}}
 function lookupContext(r,start){
  let pos=0;
  for(const n of highlightNodes(flowOf(r))){
   const end=pos+n.nodeValue.length;
   if(start>=pos&&start<end){
    const block=n.parentElement.closest('p,li,blockquote,h1,h2,h3,h4');if(!block)return '';
    const range=document.createRange();range.selectNodeContents(block);range.setEnd(n,start-pos);
    const at=range.toString().length;return block.textContent.slice(Math.max(0,at-800),at+928).trim();
   }
   pos=end;
  }
  return '';
 }
 async function lookupStream(payload,onDelta,signal){
  const res=await fetch(new URL('api/lookup/stream',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
  if(!res.ok){let d={};try{d=await res.json()}catch{}throw Object.assign(Error(d.error||'Unable to connect'),{status:res.status})}
  const rd=res.body.getReader(),dec=new TextDecoder();let buf='',bytes=0;
  for(;;){
   const {value,done}=await rd.read();if(done)break;
   bytes+=value.length;if(bytes>65536)throw Error('Oversized explanation');
   buf+=dec.decode(value,{stream:true});let i;
   while((i=buf.indexOf('\n'))>=0){
    const ln=buf.slice(0,i);buf=buf.slice(i+1);if(!ln.trim())continue;const ev=JSON.parse(ln);
    if(ev.type==='delta'&&typeof ev.text==='string')onDelta(ev.text);
    else if(ev.type==='done')return ev;
    else if(ev.type==='error')throw Object.assign(Error(ev.error||'Unavailable'),{status:ev.status});
    else throw Error('Invalid explanation stream');
   }
  }
  throw Error('Incomplete explanation');
 }
 async function lookupFor(r,t,box,context=''){
  const q=String(t||'').replace(/\s+/g,' ').replace(/^[\s"'“‘(\[]+|[\s"'”’)\],.;:!?]+$/g,'').trim();if(!q)return;
  if(lookupAbort){lookupAbort.abort();lookupAbort=null}
  const request=++lookupSerial,anchor={getClientRects:()=>[box],getBoundingClientRect:()=>box};
  const payload={text:q,entry_id:r.dataset.read,body_sha256:r.dataset.bodySha256,...(context?{context}:{})};
  const key=JSON.stringify(payload),current=()=>request===lookupSerial&&reader()===r&&glossOpen()&&r.dataset.bodySha256===payload.body_sha256;
  const show=(en,result)=>showDefinition(r,q,{en,language:result&&result.model!==LOOKUP_MODEL?'Answered by '+result.model:'AI explanation'},anchor);
  if(q.length>128||q.split(' ').length>8){show('Select a word or short phrase to explain.');return}
  const cached=lookupCache.get(key);if(cached){show(cached.text,cached);return}
  show('Explaining…');
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),45000);lookupAbort=ctl;
  let partial='',frame=0;
  const paint=()=>{frame=0;if(current()&&partial.trim())show(partial.trim()+' …')};
  try{
   const result=await lookupStream(payload,piece=>{partial+=piece;if(!frame)frame=requestAnimationFrame(paint)},ctl.signal);
   if(frame){cancelAnimationFrame(frame);frame=0}
   if(result.entry_id!==payload.entry_id||result.body_sha256!==payload.body_sha256||(result.model!==LOOKUP_MODEL&&!(result.tested_on===LOOKUP_MODEL&&['owner-swap','owner-pick'].includes(result.chosen)&&typeof result.model==='string'&&result.model))||typeof result.text!=='string'||!result.text.trim()||result.text.length>700||result.text.trim().split(/\s+/).length>70)throw Error('Invalid explanation');
   lookupCache.set(key,result);if(lookupCache.size>100)lookupCache.delete(lookupCache.keys().next().value);
   if(current())show(result.text,result);
  }catch(err){
   if(frame){cancelAnimationFrame(frame);frame=0}
   if(current())show(err.status===400?'The selection or chapter edition changed. Reopen the chapter and select the term again.':'AI explanation unavailable. Tap Look up again to retry.');
  }finally{clearTimeout(timer);if(lookupAbort===ctl)lookupAbort=null}
 }
 function activate(id){const h=(data.highlights||[]).find(x=>x.id===id);if(!h||!currentAnchor(h))return;hlAct={id:h.id,start:h.start,end:h.end};const r=reader();paint(r);showActive()}
 async function copyText(t){
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(t);return true}}catch{}
  const ta=document.createElement('textarea');ta.value=t;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch{}ta.remove();return ok;
 }
 // Save a range (merging what it touches) and make it the active highlight. Optimistic: paints first.
 async function commit(r,s,e,replaces){
  const flow=flowOf(r),m=merged(r,s,e,replaces),text=textFor(flow,m.s,m.e);if(!text)return deactivate();
  const before=data.highlights||[];
  data.highlights=[{id:-1,entry_id:r.dataset.read,start:m.s,end:m.e,text}].concat(before.filter(h=>!(currentAnchor(h)&&h.entry_id===r.dataset.read&&(h.id===replaces||(h.start<m.e&&h.end>m.s)))));
  hlAct={id:-1,start:m.s,end:m.e};paint(r);showActive();
  try{
   const d=await api('wisdom/highlight',{action:'add',entry_id:r.dataset.read,start:m.s,end:m.e,text,body_sha256:r.dataset.bodySha256});
   data.highlights=d.highlights;if(hlAct&&hlAct.id===-1&&hlAct.start===m.s&&hlAct.end===m.e)hlAct.id=d.id;if(reader()===r){paint(r);if(hlAct)showActive()}
  }catch(err){data.highlights=before;if(reader()===r){hlAct={id:'sel',pending:true,start:m.s,end:m.e};paint(r);showActive()}toast(err.message||'Couldn’t save. Your selection is retained; copy it before reopening this chapter.')}
 }
 function bindPop(r){
  const p=r.querySelector('.wb-hlpop');if(!p)return;
  p.onpointerdown=ev=>ev.stopPropagation();
  p.onclick=async ev=>{
   const b=ev.target.closest('button');if(!b||!hlAct)return;ev.stopPropagation();
   const act=b.dataset.hlAct,cur={...hlAct};
   if(act==='ask'){
    b.disabled=true;
    try{
     if(cur.pending){await commit(r,cur.start,cur.end,undefined);if(!hlAct||hlAct.pending) return;}
     const h=hlAct||cur,anchor={entry_id:r.dataset.read,body_sha256:r.dataset.bodySha256,start:h.start,end:h.end,text:textFor(flowOf(r),h.start,h.end)};
     if(h.id>0)anchor.highlight_id=h.id;deactivate();await WisdomDiscussion.open(anchor);
    }finally{b.disabled=false}
    return;
   }
   if(act==='copy'){const ok=await copyText(textFor(flowOf(r),cur.start,cur.end));toast(ok?'Copied.':'Couldn’t copy. Try again.');deactivate();return}
   if(act==='note'){const h=cur.pending?null:(data.highlights||[]).find(x=>x.id===cur.id);deactivate();openNote({r,id:cur.pending?0:cur.id,start:cur.start,end:cur.end,text:textFor(flowOf(r),cur.start,cur.end),note:h?.note||''});return}
   if(act==='highlight'){if(cur.pending)commit(r,cur.start,cur.end,undefined);return}
   if(act==='lookup'){const t=textFor(flowOf(r),cur.start,cur.end),context=lookupContext(r,cur.start),box=rectsFor(cur.start,cur.end)[0]||p.getBoundingClientRect();deactivate();lookupFor(r,t,box,context);return}
   if(act==='remove'&&!cur.pending){
    // A highlight carrying a note needs a second tap: removing it deletes the note too.
    if((data.highlights||[]).find(x=>x.id===cur.id)?.note&&p.dataset.confirm!==String(cur.id)){p.dataset.confirm=String(cur.id);b.innerHTML='<span class="wb-swatch off"></span>Remove highlight and note?';showActive();return}
    const before=data.highlights;data.highlights=before.filter(h=>h.id!==cur.id);hlAct=null;paint(r);hidePop();
    try{if(cur.id>0){const d=await api('wisdom/highlight',{action:'remove',id:cur.id});data.highlights=d.highlights;if(reader()===r)paint(r)}toast('Highlight removed.')}
    catch(err){data.highlights=before;if(reader()===r)paint(r);toast('Couldn’t remove it. Try again.')}
   }
  };
  // Handles: drag to grow or shrink the active highlight, snapping to whole words.
  r.querySelectorAll('.wb-handle').forEach(hd=>{
   hd.onpointerdown=ev=>{
    if(!hlAct||ev.button)return;ev.preventDefault();ev.stopPropagation();try{hd.setPointerCapture(ev.pointerId)}catch{}
    // Keep the finger's offset from the text line, so the word being picked is never hidden under it.
    const end=hd.classList.contains('e'),rs=rectsFor(hlAct.start,hlAct.end),q=end?rs[rs.length-1]:rs[0];
    const cy=q?(q.top+q.bottom)/2:hd.getBoundingClientRect().top-12;
    hlHandle={end,id:ev.pointerId,dy:ev.clientY-cy,start:hlAct.start,stop:hlAct.end,replaces:hlAct.id};
    r.querySelector('.wb-hlpop').hidden=true;hd.classList.add('drag');
   };
   hd.onpointermove=ev=>{
    if(!hlHandle||ev.pointerId!==hlHandle.id)return;ev.preventDefault();
    selectionWord(r,wordAt(ev.clientX,ev.clientY-hlHandle.dy));holdCorner(r,ev);
   };
   const done=ev=>{
    if(!hlHandle||ev.pointerId!==hlHandle.id)return;clearCorner();const h=hlHandle;hlHandle=null;hd.classList.remove('drag');
    if(hlAct.pending||(hlAct.start===h.start&&hlAct.end===h.stop)){paint(r);showActive();return}
    commit(r,hlAct.start,hlAct.end,h.replaces);
   };
   hd.onpointerup=done;hd.onpointercancel=()=>{if(hlHandle)cancelSelectionDrag()};
   // Only this handle losing ITS pointer cancels; capture moving between elements is normal.
   hd.onlostpointercapture=ev=>{if(hlHandle&&ev.target===hd&&ev.pointerId===hlHandle.id)cancelSelectionDrag()};
  });
  // The reader's own long-press selection (with Copy) replaces the native one on the page;
  // pop-ups keep the native long-press menu so their text can be selected and copied.
  r.addEventListener('contextmenu',ev=>{if(!ev.target.closest?.(COPYABLE))ev.preventDefault()});
  r.addEventListener('selectstart',ev=>{if(ev.target.closest?.('.wb-stage')||ev.target.parentElement?.closest('.wb-stage'))ev.preventDefault()});
 }
 // Long-press on a word starts a selection; dragging extends it word by word; lifting saves it.
 function pressStart(r,ev){
  clearTimeout(hlPress);if(!ev.target.closest(HL_ROOTS)||ev.target.closest('a,button'))return;
  const x=ev.clientX,y=ev.clientY,id=ev.pointerId,stage=r.querySelector('.wb-stage');
  hlPress=setTimeout(()=>{
   if(!drag||drag.on)return;const i=wordAt(x,y);if(i<0)return;
   drag=null;if(glossOpen())closeGloss();deactivate();hlSel={a:i,c:i,id};buzz();try{stage.setPointerCapture(id)}catch{}
   const w=words()[i];paint(r,{start:w.s,end:w.e,pending:HL_MIN>1});
  },420);
 }
 function pressMove(r,ev){
  if(!hlSel||ev.pointerId!==hlSel.id)return false;
  const i=wordAt(ev.clientX,ev.clientY);if(i>=0&&i!==hlSel.c)selectionWord(r,i);
  holdCorner(r,ev);
  return true;
 }
 function pressEnd(r,ev){
  clearTimeout(hlPress);hlPress=0;if(!hlSel||(ev&&ev.pointerId!==hlSel.id))return false;clearCorner();
  const L=words(),n=Math.abs(hlSel.c-hlSel.a)+1,a=L[Math.min(hlSel.a,hlSel.c)],b=L[Math.max(hlSel.a,hlSel.c)];hlSel=null;
  suppressClick=true;setTimeout(()=>suppressClick=false,80);
  if(n>=HL_MIN)commit(r,a.s,b.e,undefined);else select(r,a.s,b.e);return true;
 }
 var glossHist=false,glossBack=false,gpSel=false;
 const COPYABLE='.wb-glosspop';
 function glossOpen(){const p=reader()?.querySelector('.wb-glosspop');return !!(p&&!p.hidden)}
 function closeGloss(fromBack){
  lookupCancel();
  const r=reader(),p=r?.querySelector('.wb-glosspop');if(p){if(selIn(p))getSelection().removeAllRanges();p.hidden=true}r?.querySelectorAll('.wb-gloss.on').forEach(x=>x.classList.remove('on'));
  if(glossHist&&!fromBack){glossHist=false;glossBack=true;history.back()}else if(fromBack)glossHist=false;
 }
 // A native text selection inside a pop-up (the user is copying) must not dismiss it.
 function selIn(el){const s=globalThis.getSelection?.();return !!(el&&s&&!s.isCollapsed&&s.rangeCount&&el.contains(s.getRangeAt(0).commonAncestorContainer))}
 function openGloss(r,el,x,y){
  lookupCancel();const k=el.dataset.gloss,g=(data.glosses||{})[k];if(!g)return;
  r.querySelectorAll('.wb-gloss.on').forEach(e=>e.classList.remove('on'));el.classList.add('on');
  // A glossed drop cap is painted by ::first-letter, so the span's own box is empty; anchor to its text.
  const rg=document.createRange();rg.selectNodeContents(el);const at=[...rg.getClientRects()].filter(q=>q.width>0);
  showDefinition(r,k,g,at.length?{getClientRects:()=>at,getBoundingClientRect:()=>rg.getBoundingClientRect()}:el,x,y);
 }
 function showDefinition(r,k,g,el,x,y){
  const p=r.querySelector('.wb-glosspop');if(!p)return;
  p.innerHTML=`<div class="wb-gp-script" lang="${esc(g.lang||'')}">${esc(k)}</div>${g.roman?`<div class="wb-gp-roman">${esc(g.roman)}</div>`:''}${g.say?`<div class="wb-gp-say">sounds like “${esc(g.say)}”</div>`:''}<p class="wb-gp-en">${esc(g.en).replace(/\n\n/g,'<br><br>')}</p>${g.note?`<p class="wb-gp-note">${esc(g.note)}</p>`:''}${g.language?`<small>${esc(g.language)}</small>`:''}`;
  p.hidden=false;
  // Anchor to the line that was tapped (a phrase can wrap across lines).
  const rects=[...el.getClientRects()],box=rects.find(q=>y>=q.top-4&&y<=q.bottom+4)||rects[0]||el.getBoundingClientRect();
  const W=innerWidth,H=innerHeight,w=Math.min(340,W-24);p.style.width=w+'px';
  const cx=x??(box.left+box.right)/2,h=p.offsetHeight;
  let top=box.bottom+10;if(top+h>H-12)top=box.top-10-h;top=Math.max(12,Math.min(top,H-12-h));
  p.style.left=Math.round(Math.min(W-12-w,Math.max(12,cx-w/2)))+'px';p.style.top=Math.round(top)+'px';
  // Back closes the popover first and keeps the chapter open.
  if(!glossHist){try{history.pushState(history.state,'',location.href);glossHist=true}catch{}}
 }
 window.addEventListener('popstate',ev=>{
  if(glossBack){glossBack=false;ev.stopImmediatePropagation();return}
  if(glossHist||glossOpen()){closeGloss(true);ev.stopImmediatePropagation()}
 },true);
 function bindReader(){
  const r=reader();if(!r)return;const stage=r.querySelector('.wb-stage'),track=r.querySelector('.wb-track');
  stage.ondragstart=ev=>ev.preventDefault();
  // A page swipe can start anywhere on the stage, including on a button, link or card, and follows the
  // same direction rule as text (more sideways than up/down), so a diagonal thumb swipe works everywhere
  // (James, 19 Oct: a ~40° swipe from Discuss with AI or the Next card did nothing). Controls only need a
  // few px more travel so finger jitter stays a tap; once it is a swipe the control's click is swallowed.
  // A real thumb rolls 10-20px sideways while pressing a button, so a press that starts on a control must
  // travel 24px before it becomes a swipe (James, 20 Oct: thumbs up/down needed two taps; at 10px the first
  // press was taken as a swipe and its click swallowed). Real swipes travel far more, so they still turn the page.
  // A glossed term (role=button) is still reader text: a tap translates it, a long press selects it,
  // including a glossed drop cap such as 道 opening a section (James, 19 Oct).
  // Desktop (James, 19 Oct: "follow Kindle"): a mouse never swipes. Press and drag over text selects it word by
  // word at once (no long press); a double-click selects one word. Pages turn with the edge arrows, the arrow
  // keys and the scroll wheel or trackpad; a plain click on text never turns the page. Touch is unchanged.
  stage.onpointerdown=ev=>{lastPointer=ev.pointerType;mouseSel=null;if(ev.button||ev.target.closest('input,textarea,select,[contenteditable]')){drag=null;return}
   // A mouse press-and-hold still selects like a long press; it just never starts a page drag.
   if(ev.pointerType==='mouse'){drag={x:ev.clientX,y:ev.clientY,t:Date.now(),on:false,ctl:false,mouse:true};if(ev.target.closest(HL_ROOTS)&&!ev.target.closest('a,button')){mouseSel={x:ev.clientX,y:ev.clientY,id:ev.pointerId,i:wordAt(ev.clientX,ev.clientY)};pressStart(r,ev)}return}
   const ctl=!!ev.target.closest('a,button,[role="button"]:not(.wb-gloss)');drag={x:ev.clientX,y:ev.clientY,t:Date.now(),on:false,ctl};if(!ctl)pressStart(r,ev)};
  if(!stage._wbSwallow){stage._wbSwallow=1;stage.addEventListener('click',ev=>{if(suppressClick){ev.stopPropagation();ev.preventDefault()}},true)}
  stage.onpointermove=ev=>{if(pressMove(r,ev))return;
   if(mouseSel&&ev.pointerId===mouseSel.id){if(Math.hypot(ev.clientX-mouseSel.x,ev.clientY-mouseSel.y)<5)return;const m=mouseSel;mouseSel=null;clearTimeout(hlPress);drag=null;
    const i=m.i>=0?m.i:wordAt(ev.clientX,ev.clientY);if(i<0)return;if(glossOpen())closeGloss();deactivate();hlSel={a:i,c:i,id:ev.pointerId};try{stage.setPointerCapture(ev.pointerId)}catch{}
    const w=words()[i];paint(r,{start:w.s,end:w.e,pending:HL_MIN>1});selectionWord(r,wordAt(ev.clientX,ev.clientY));return}
   if(!drag||drag.mouse)return;if(Math.hypot(ev.clientX-drag.x,ev.clientY-drag.y)>10)clearTimeout(hlPress);const dx=ev.clientX-drag.x,dy=ev.clientY-drag.y;if(!drag.on&&Math.abs(dx)>(drag.ctl?CTL_SLOP:8)&&Math.abs(dx)>Math.abs(dy)){drag.on=true;try{stage.setPointerCapture(ev.pointerId)}catch{}}if(drag.on){const edge=(page===0&&dx>0&&!r.dataset.prevRoute)||(page>=pages-1&&dx<0&&!r.querySelector('.wb-next'));track.style.transition='none';track.style.transform=`translate3d(${-page*pageW+(edge?dx/3:dx)}px,0,0)`}};
  const up=ev=>{if(!drag)return;const d=drag;drag=null;if(!d.on)return;suppressClick=true;setTimeout(()=>suppressClick=false,60);const dx=ev.clientX-d.x,v=Math.abs(dx)/Math.max(1,Date.now()-d.t);if(dx<-50||(dx<-12&&v>.45))step(1);else if(dx>50||(dx>12&&v>.45))step(-1);else go(page)};
  stage.onpointerup=ev=>{mouseSel=null;if(pressEnd(r,ev))return;clearTimeout(hlPress);up(ev)};stage.onpointercancel=()=>{mouseSel=null;if(drag?.on)go(page);cancelSelectionDrag()};
  // A real finger jitters during the hold, so the browser's implicit capture on the touched
  // paragraph is released when the stage takes capture. That bubbling event is not a cancel.
  stage.onlostpointercapture=ev=>{if(hlSel&&ev.target===stage&&ev.pointerId===hlSel.id)cancelSelectionDrag()};
  stage.onclick=ev=>{
   if(suppressClick||ev.target.closest('a,button'))return;
   // Desktop double-click selects the word (click detail, since a repaint between the clicks can drop dblclick).
   if(lastPointer==='mouse'&&ev.detail===2&&ev.target.closest(HL_ROOTS)&&!ev.target.closest('mark.wb-hl')){const i=wordAt(ev.clientX,ev.clientY);if(i>=0){if(glossOpen())closeGloss();const w=words()[i];select(r,w.s,w.e);return}}
   // A glossed phrase opens its translation; with one open, a tap elsewhere only closes it.
   // A tap on a glossed drop cap reports the paragraph as its click target; the hit test finds the gloss.
   const gl=ev.target.closest('.wb-gloss')||document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.wb-flow .wb-gloss');
   if(glossOpen()){const was=r.querySelector('.wb-gloss.on');if(gl&&gl!==was&&!hlAct){openGloss(r,gl,ev.clientX,ev.clientY);return}closeGloss();return}
   if(gl&&!hlAct){openGloss(r,gl,ev.clientX,ev.clientY);return}
   // A tap on a highlight makes it active (handles + Copy / Remove); with one active, any other tap only
   // dismisses it and never turns the page.
   const m=ev.target.closest('mark.wb-hl')||markNear(ev.clientX,ev.clientY);
   if(hlAct){if(m&&m.dataset.hl!=='live'&&+m.dataset.hl!==hlAct.id)activate(+m.dataset.hl);else deactivate();return}
   if(m&&m.dataset.hl!=='live'){activate(+m.dataset.hl);return}
   if(lastPointer==='mouse')return;
   const x=ev.clientX-stage.getBoundingClientRect().left,W=stage.clientWidth;if(x<W*.28)step(-1);else if(x>W*.72)step(1);else r.classList.toggle('wb-calm')};
  r.querySelectorAll('[data-wisdom-turn]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();if(hlAct)deactivate();step(+b.dataset.wisdomTurn)});
  // Wheel / trackpad: one page per gesture. Inertia keeps the lock until the wheel has been still for 220 ms.
  if(!stage._wbWheel){stage._wbWheel=1;stage.addEventListener('wheel',ev=>{
   if(ev.ctrlKey||hlSel||hlHandle)return;
   const sc=ev.target.closest?.('.wb-end,.wb-hlpop,.wb-glosspop');
   if(sc&&sc.scrollHeight>sc.clientHeight+2&&Math.abs(ev.deltaY)>=Math.abs(ev.deltaX)){const down=ev.deltaY>0;if(down?sc.scrollTop+sc.clientHeight<sc.scrollHeight-2:sc.scrollTop>0)return}
   ev.preventDefault();clearTimeout(wheelIdle);wheelIdle=setTimeout(()=>{wheelLock=0;wheelAcc=0},220);if(wheelLock)return;
   wheelAcc+=Math.abs(ev.deltaX)>Math.abs(ev.deltaY)?ev.deltaX:ev.deltaY*(ev.deltaMode===1?16:1);
   if(Math.abs(wheelAcc)>=40){const d=Math.sign(wheelAcc);wheelAcc=0;wheelLock=1;if(hlAct)deactivate();step(d)}
  },{passive:false})}
  const dc=r.querySelector('[data-wisdom-discuss-chapter]');if(dc)dc.onclick=ev=>{ev.stopPropagation();WisdomDiscussion.open({scope:'chapter'})};
  bindPop(r);
  const gp=r.querySelector('.wb-glosspop');if(gp){gp.onpointerdown=ev=>{ev.stopPropagation();gpSel=selIn(gp)};gp.onclick=ev=>{ev.stopPropagation();const had=gpSel;gpSel=false;if(had||selIn(gp))return;closeGloss()}}
  stage.onkeydown=ev=>{const gl=ev.target.closest?.('.wb-gloss');if(gl&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();ev.stopPropagation();const b=gl.getBoundingClientRect();openGloss(r,gl,(b.left+b.right)/2,b.top+2)}};
  // Group the closing "Sources" section so it sets in smaller type.
  r.querySelectorAll('.wb-flow h2').forEach(h=>{if(/^sources$/i.test(h.textContent.trim())){h.classList.add('wb-sources-h');let n=h.nextElementSibling;while(n&&n.tagName!=='H2'){n.classList.add('wb-sources');n=n.nextElementSibling}}});
  r.querySelectorAll('.wb-flow p').forEach(p=>{if(p.children.length===1&&p.firstElementChild.tagName==='STRONG'&&p.textContent.trim()===p.firstElementChild.textContent.trim())p.classList.add('wb-keyline')});
  paint(r);
  const fontsReady=document.fonts?.ready||Promise.resolve();
  layout(false);fontsReady.then(()=>layout(true));
 }
 let resizeTimer=0;
 window.addEventListener('resize',()=>{cancelSelectionDrag();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>layout(true),120)});
 window.addEventListener('blur',()=>cancelSelectionDrag());
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelSelectionDrag()});
 window.addEventListener('keydown',ev=>{if(!reader()||window.WisdomDiscussion?.isOpen()||ev.target.closest?.('input,textarea'))return;if(['ArrowRight','PageDown',' '].includes(ev.key)){ev.preventDefault();step(1)}else if(['ArrowLeft','PageUp'].includes(ev.key)){ev.preventDefault();step(-1)}});
 function progress(){const bar=document.querySelector('.wisdom-progress>span');if(!bar)return;const max=document.documentElement.scrollHeight-innerHeight;bar.style.transform=`scaleX(${max>0?Math.min(1,scrollY/max):0})`}
 window.addEventListener('scroll',progress,{passive:true});
 // The cover resting at a shelf's left edge shows in colour; the rest stay black and white.
 // Recomputed on scroll (rAF-throttled), so swiping through the shelf moves the light along.
 function litShelf(sh){
  const pick=()=>{const L=sh.getBoundingClientRect().left+parseFloat(getComputedStyle(sh).paddingLeft||0);let best=null,d=1e9;
   sh.querySelectorAll('.wb-cover').forEach(c=>{const x=Math.abs(c.getBoundingClientRect().left-L);if(x<d){d=x;best=c}});
   sh.querySelectorAll('.wb-cover.lit').forEach(c=>{if(c!==best)c.classList.remove('lit')});best?.classList.add('lit')};
  let raf=0;sh.onscroll=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;pick()})};pick();
 }
 // The Suggested grid scrolls with the page: the row nearest the upper third of the screen shows in colour.
 function litGrid(){
  const g=document.querySelector('.wb-suggest-grid');if(!g)return;const covers=[...g.querySelectorAll('.wb-cover')],tops=covers.map(c=>c.getBoundingClientRect().top);
  const mark=innerHeight*.38;let best=null,d=1e9;covers.forEach((c,i)=>{const x=Math.abs(tops[i]+c.offsetHeight/2-mark);if(x<d){d=x;best=tops[i]}});
  covers.forEach((c,i)=>c.classList.toggle('lit',Math.abs(tops[i]-best)<4));
 }
 let gridRaf=0;window.addEventListener('scroll',()=>{if(!gridRaf)gridRaf=requestAnimationFrame(()=>{gridRaf=0;litGrid()})},{passive:true});
 function bind(){
  document.querySelectorAll('[data-wisdom-id]').forEach(e=>e.onclick=ev=>{if(!ev.target.closest('a,button'))navigate('/read/'+e.dataset.wisdomId)});
  bindLinks(document);bindSearch();
  document.querySelectorAll('[data-wisdom-discussions]').forEach(b=>b.onclick=()=>WisdomDiscussion.list(b.dataset.wisdomDiscussions||undefined));
  document.querySelector('[data-wisdom-retry]')?.addEventListener('click',()=>load());

  document.querySelectorAll('[data-wisdom-pref]').forEach(e=>e.onclick=()=>{const id=e.dataset.wisdomPref,t=data.thinkers.find(x=>x.id===id);change({kind:'thinker',id,field:'more',value:!t.more},e)});
  document.querySelectorAll('[data-wisdom-entry]').forEach(e=>e.onclick=()=>{const id=e.dataset.wisdomEntry,field=e.dataset.field,item=data.entries.find(x=>x.id===id);change({kind:'entry',id,field,value:field==='done'?true:!item[field]},e)});
  document.querySelectorAll('[data-wisdom-size]').forEach(b=>b.onclick=()=>{rememberLine();size=Math.min(3,Math.max(0,size+Number(b.dataset.wisdomSize)));try{localStorage.setItem(sizeKey,String(size))}catch{}const r=document.querySelector('.wisdom-reader');if(r)r.dataset.size=size;document.querySelectorAll('[data-wisdom-size]').forEach(x=>x.disabled=Number(x.dataset.wisdomSize)<0?size<=0:size>=3);layout(true)});
  document.querySelectorAll('[data-wisdom-copy]').forEach(b=>b.onclick=async()=>{const h=(data.highlights||[]).find(x=>x.id===+b.dataset.wisdomCopy);if(h)toast(await copyText(h.text)?'Copied.':'Couldn’t copy. Try again.')});
  document.querySelectorAll('[data-wisdom-note]').forEach(b=>b.onclick=()=>{const h=(data.highlights||[]).find(x=>x.id===+b.dataset.wisdomNote);if(h)openNote({r:null,entry:h.entry_id,id:h.id,start:h.start,end:h.end,text:h.text,note:h.note||''})});
  document.querySelectorAll('[data-wisdom-remove-highlight]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const d=await api('wisdom/highlight',{action:'remove',id:+b.dataset.wisdomRemoveHighlight});data.highlights=d.highlights;if(location.hash==='#/highlights')enter();toast('Highlight removed.')}catch{b.disabled=false;toast('Couldn’t remove it. Try again.')}});
  document.querySelectorAll('[data-pct]').forEach(x=>x.style.width=x.dataset.pct+'%');
  document.querySelectorAll('.wb-shelf').forEach(litShelf);litGrid();
  // Thumbs register on the first touch (James, 20 Oct). The browser drops a touch click once the finger rolls
  // ~15px, so a touch that starts and ends on the button rates on lift; the click that may follow is ignored.
  document.querySelectorAll('[data-wisdom-rate]').forEach(b=>{
   const fire=()=>{const id=b.dataset.wisdomRate,v=+b.dataset.value,item=data.entries.find(x=>x.id===id);if(item)change({kind:'entry',id,field:'rating',value:item.rating===v?0:v},b)};
   b.onpointerdown=ev=>{b._touch=ev.pointerType==='touch'&&!ev.button?ev.pointerId:null};
   b.onpointerup=ev=>{if(ev.pointerId!==b._touch)return;b._touch=null;if(drag?.on)return;const k=b.getBoundingClientRect();if(ev.clientX<k.left-8||ev.clientX>k.right+8||ev.clientY<k.top-8||ev.clientY>k.bottom+8)return;b._lift=Date.now();fire()};
   b.onpointercancel=()=>{b._touch=null};
   b.onclick=ev=>{ev.stopPropagation();if(Date.now()-(b._lift||0)<700)return;fire()};
  });
  bindReader();
 }
 function syncHash(){if(!active()||location.hash!==currentRoute){remember();route='wisdom';epoch++;history.replaceState({wisdom:true,depth:history.state?.depth||0},'',location.href);enter()}}
 const atRoot=()=>['','#','#/'].includes(location.hash);
 // Reader Back is the book/thinker named by the visible arrow, including a
 // Currently reading shortcut or restored chapter with no parent history entry.
 function readerParent(){
  const [,kind,id,collection]=parseRoute(),entry=data?.entries.find(e=>e.id===id);
  if(kind!=='read')return '';
  const col=entry?colOf(entry,collection):null;
  return col?'/collection/'+col.id:collection?'/collection/'+collection:entry?'/thinker/'+thinker(entry).id:'';
 }
 function readerBack(){
  const parent=readerParent();remember();
  if(history.state?.depth>0&&history.state.previousRoute==='#'+parent)history.back();
  else navigate(parent,{replace:true});
  return true;
 }
 function canGoBack(){return !!document.querySelector('.wb-sheet')||glossOpen()||!!hlAct||!atRoot()}
 function back(){
  cancelSelectionDrag();
  if(document.querySelector('.wb-sheet')){closeSheet();return true}
  if(glossOpen()){closeGloss();return true}
  if(hlAct){deactivate();return true}
  if(parseRoute()[1]==='read')return readerBack();
  if(!atRoot()){remember();if(history.state?.depth>0)history.back();else{const [,kind,,collection]=parseRoute();navigate(kind==='read'&&collection?'/collection/'+collection:'',{replace:true})}return true}
  return false;
 }
 function popRoute(){
  // The shared standalone guard can pop without changing the URL (cold deep link).
  // Consume that Back as a domain step, not another render of the same collection.
  if(location.hash===currentRoute&&!atRoot()){back();return}
  remember();enter({restore:true});
 }
 function discussionContext(){const r=reader(),e=data?.entries?.find(x=>x.id===r?.dataset.read);return r?{entry_id:r.dataset.read,body_sha256:r.dataset.bodySha256,chapter_title:e?.title,page:page+1}:{};}
 async function locateDiscussion(t){
  if(!data?.entries?.some(e=>e.id===t.entry_id))return;
  if(reader()?.dataset.read!==t.entry_id){navigate('/read/'+t.entry_id);await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
  const r=reader();if(!r||r.dataset.bodySha256!==t.body_sha256)return;
  let offset=0;
  for(const node of highlightNodes(flowOf(r))){
   if(offset+node.length>t.start){const range=document.createRange();range.setStart(node,Math.max(0,t.start-offset));range.setEnd(node,Math.min(node.length,t.start-offset+1));const rect=range.getBoundingClientRect(),left=r.querySelector('.wb-stage').getBoundingClientRect().left;go(Math.floor((rect.left-left+page*pageW)/pageW),false);break;}offset+=node.length;
  }
 }
 let frozenReader=null,unfreezeTimer;
 // Overlays with a keyboard (Ask AI, Note) hold the page layout so the keyboard doesn't repaginate the chapter.
 function freezeReader(r=reader()){clearTimeout(unfreezeTimer);if(!r||r.dataset.discussionFrozen)return;frozenReader=r;r.style.height=r.getBoundingClientRect().height+'px';r.style.width=r.getBoundingClientRect().width+'px';r.dataset.discussionFrozen='1';}
 function unfreezeReader(){unfreezeTimer=setTimeout(()=>{const r=frozenReader;if(!r)return;const was=r.style.width+'x'+r.style.height;delete r.dataset.discussionFrozen;r.style.height='';r.style.width='';frozenReader=null;if(r!==reader())return;
  // Same size once the keyboard is gone: keep the page and any tapped highlight, just repaint.
  const b=r.getBoundingClientRect();if(was===b.width+'px'+'x'+b.height+'px'){paint(r);if(hlAct)showActive()}else{layout(true);paint(r)}},250);}
 window.addEventListener('wisdom:discussion-open',()=>freezeReader());
 window.addEventListener('wisdom:discussion-close',unfreezeReader);
 window.addEventListener('wisdom:discussions',()=>{const r=reader();const dc=r?.querySelector('[data-wisdom-discuss-chapter]');if(dc)dc.firstChild.textContent=window.WisdomDiscussion?.hasChapter?.(r.dataset.read,r.dataset.bodySha256)?'Continue discussion ':'Discuss with AI ';if(r&&!hlHandle&&!hlPress){paint(r);if(hlAct)showActive();}});
 return {discussionContext,locateDiscussion,render,bind,load,enter,navigate,active,remember,syncHash,refreshDay,canGoBack,back,atRoot,popRoute,restoreRoute};
})();
