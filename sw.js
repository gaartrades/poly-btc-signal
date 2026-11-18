/* Cache the shell only. Polymarket API calls MUST stay fresh. */
const SHELL_CACHE='poly-btc-shell-v1-5';
const FILES=['./','./index.html','./styles.css?v=5','./engine.js?v=5','./tracker.js?v=5','./app.js?v=5','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL_CACHE).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==SHELL_CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return; // NEVER cache or intercept market/index requests.
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok){const copy=r.clone();caches.open(SHELL_CACHE).then(c=>c.put(e.request,copy));}
    return r;
  }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
