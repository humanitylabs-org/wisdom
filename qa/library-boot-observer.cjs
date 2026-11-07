'use strict';
// Harness only. One pre-navigation CDP source; no injected app implementation.
function installBootObserver(arg){
 const identity=()=>({href:location.href,path:location.pathname,baseURI:document.baseURI,timeOrigin:performance.timeOrigin,now:performance.now(),src:window.frameElement?.getAttribute('src')??null,srcdoc:window.frameElement?.getAttribute('srcdoc')??null});
 const marker=window.__qaInit={...identity(),argType:typeof arg,events:[]};
 const boot=window.__qaBoot={timeOrigin:performance.timeOrigin};
 try{
  const {entryId,entryTitle,collectionId,collectionTitle}=arg;
  let observer;const tick=()=>{try{
   // Never discard the initial blank document: identity is checked on each tick.
   // No timestamp is backdated or measured from test attachment/wait completion.
   if(!location.pathname.startsWith('/wisdom/'))return;
   const t=performance.now(),home=document.querySelector('.wb-home'),r=window.frameElement?.getBoundingClientRect();
   if(window.WizardApp?.hosted&&boot.hosted===undefined)boot.hosted=t;
   const shown=home?.getClientRects().length&&r&&r.width>100&&r.height>100&&r.right>0&&r.left<parent.innerWidth&&r.bottom>0&&r.top<parent.innerHeight;
   const links=[...(home?.querySelectorAll('[data-wisdom-route]')||[])];
   const chapterLink=links.some(a=>a.dataset.wisdomRoute.startsWith('/read/'+entryId)&&a.textContent.includes(entryTitle));
   const collectionLink=links.some(a=>a.dataset.wisdomRoute==='/collection/'+collectionId&&a.textContent.includes(collectionTitle));
   if(shown&&home.querySelector('.wb-browse-card')&&(chapterLink||collectionLink)&&boot.usable===undefined){boot.usable=t;boot.identity=identity();boot.content={chapterLink,collectionLink};}
  }catch(e){marker.error=String(e.stack||e)}};
  marker.events.push({phase:'installed-before-app',...identity(),readyState:document.readyState,hasHome:!!document.querySelector('.wb-home')});
  observer=new MutationObserver(tick);observer.observe(document,{childList:true,subtree:true});setInterval(tick,20);
  document.addEventListener('DOMContentLoaded',()=>{marker.events.push({phase:'domcontentloaded',...identity()});tick()});tick();
 }catch(e){marker.error=String(e.stack||e)}
}
const observerSource=arg=>`(${installBootObserver.toString()})(${JSON.stringify(arg)});`;
module.exports={installBootObserver,observerSource};
