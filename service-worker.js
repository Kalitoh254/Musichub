const CACHE_NAME = "musichub-v4";
const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.json",
  "songs.json",
  "icons/logo.png",
  "icons/005.jpg"
];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map(scopedUrl)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("musichub-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || request.headers.has("range")) {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const networkFirst = /\/(index\.html|app\.js|style\.css|songs\.json|manifest\.json|service-worker\.js)$/.test(url.pathname);

  if (networkFirst) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok && response.status === 200 && response.type === "basic") {
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        if (request.mode === "navigate") {
          return caches.match(scopedUrl("index.html"));
        }
        throw new Error("Resource unavailable offline: " + request.url);
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (
          response.ok &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          const requestUrl = new URL(request.url);
          const scopeUrl = new URL(self.registration.scope);

          if (requestUrl.pathname.startsWith(scopeUrl.pathname)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
        }
        return response;
      }).catch(() => {
        if (request.mode === "navigate") {
          return caches.match(scopedUrl("index.html"));
        }
        throw new Error("Resource unavailable offline: " + request.url);
      });
    })
  );
});
