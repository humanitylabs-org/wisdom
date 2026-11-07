/* WizOffline worker v1. App supplies only WIZ_OFFLINE_CONFIG then importScripts.
 * This is an opt-in replica, not an update/reload policy. Never navigate clients. */
'use strict';
(() => {
  const c = self.WIZ_OFFLINE_CONFIG;
  if (!c || !/^[a-z][a-z0-9-]*-$/.test(c.prefix) || !c.version) throw Error('Offline config required');
  const base = new URL('./', self.location.href);
  const url = s => new URL(s, base).href;
  const names = {shell: c.prefix+'shell-'+c.version, data: c.prefix+'data-v1', assets: c.prefix+'assets-v1'};
  const shell = new Set(c.shell.map(url));
  const match = (list, u) => (list || []).some(p => u.href.startsWith(url(p)));
  const unavailable = () => new Response(JSON.stringify({error:'Needs a connection'}), {status:503, headers:{'Content-Type':'application/json'}});
  async function networkFirst(request, kind) {
    const cache = await caches.open(names[kind]);
    try {
      const response = await fetch(request, {cache:'no-store'});
      if(response.status>=500){const saved=await cache.match(request,{ignoreSearch:kind==='shell'});if(saved)return saved;}
      // Never replace good data with an error, redirect, or login HTML.
      if (response.ok && !response.redirected && kind !== 'shell') await cache.put(request, response.clone());
      return response;
    } catch (e) {
      const saved = await cache.match(request, {ignoreSearch:kind==='shell'});
      if (saved) return saved;
      if (request.mode==='navigate') {
        const home = await cache.match(url('./'));
        if (home) return home;
      }
      throw e;
    }
  }
  self.addEventListener('install', e => e.waitUntil((async () => {
    const cache = await caches.open(names.shell);
    // Reject install on any incomplete shell; old generation stays usable.
    await Promise.all([...shell].map(async u => {
      const r = await fetch(u, {cache:'no-store', credentials:'same-origin'});
      if (!r.ok || r.redirected) throw Error('Offline shell unavailable: '+u);
      await cache.put(u, r);
    }));
    await self.skipWaiting(); // activation is safe: no reload or client navigation
  })()));
  self.addEventListener('activate', e => e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(c.prefix+'shell-') && key!==names.shell) await caches.delete(key);
    await self.clients.claim();
  })()));
  self.addEventListener('fetch', e => {
    const r=e.request, u=new URL(r.url);
    if (u.origin!==base.origin) return;
    if (match(c.onlineOnly,u) && self.navigator.onLine===false) {e.respondWith(unavailable());return;}
    if (r.method!=='GET') return; // writes belong to the durable client outbox, never CacheStorage
    const clean = new URL(u);clean.search='';
    if (r.mode==='navigate' && u.pathname.startsWith(base.pathname) || shell.has(clean.href)) e.respondWith(networkFirst(r,'shell'));
    else if ((c.data||[]).some(p=>u.pathname===new URL(p,base).pathname)) e.respondWith(networkFirst(r,'data'));
    else if (match(c.assets,u)) e.respondWith((async()=>{
      const cache=await caches.open(names.assets), saved=await cache.match(r);
      if(saved)return saved;const response=await fetch(r);
      if(response.ok&&!response.redirected)await cache.put(r,response.clone());return response;
    })());
    else if (match(c.onlineOnly,u)) e.respondWith(fetch(r).catch(unavailable));
  });
})();
