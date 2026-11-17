const CACHE = "english-tutor-v11";
const ASSETS = ["/", "/index.html", "/style.css", "/app.js", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Don't cache API calls
  if (url.pathname.startsWith("/health") || url.pathname.startsWith("/chat") ||
      url.pathname.startsWith("/tts") || url.pathname.startsWith("/stt") ||
      url.pathname.startsWith("/exercise") || url.pathname.startsWith("/dictation") ||
      url.pathname.startsWith("/fillblank") || url.pathname.startsWith("/personalized") ||
      url.pathname.startsWith("/shadowing") || url.pathname.startsWith("/progress") ||
      url.pathname.startsWith("/warmup")) {
    return; // network only
  }
  // Network-first for everything else (always get fresh code when online)
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp && resp.status === 200 && resp.type === "basic") {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
