const CACHE='beer-save-kanlog-20261020-backups';
const PREFIX='beer-save-';
const ASSETS=['./','./index.html','./log.html','./kanlog.css','./kanlog-app.js','./kanlog-maintenance.js','./beer-core.js','./beer-store.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./beer-catalog.js','./beer-recognition.js','./beer-live-barcode.js','./beer-camera-ui.js','./vendor/zxing-browser-0.2.1.min.js'];
const ROOT=new URL('./',self.location.href);
const URLS=new Set(ASSETS.map(path=>new URL(path,ROOT).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(path=>new Request(new URL(path,ROOT).href,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith(PREFIX)&&key!==CACHE)||key==='beer-ocr-runtime-v1').map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);url.search='';url.hash='';
  if(url.origin!==ROOT.origin||!URLS.has(url.href))return;
  const cacheKey=url.pathname===ROOT.pathname?new URL('./index.html',ROOT).href:url.href;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(cacheKey,copy)));}return response;
  }).catch(()=>caches.open(CACHE).then(cache=>cache.match(cacheKey)).then(response=>response||Response.error())));
});
