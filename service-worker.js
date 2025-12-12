const CACHE_NAME = "musichub-v1";
const ASSETS_TO_CACHE = [
    "/",
    "/index.html",
    "/style.css",
    "/app.js",
    "/manifest.json",
    "/icons/logo.png",
    "/icons/background.jpg",
    "/icons/icon-192.png",
    "/icons/icon-512.png"
];

// Dynamically cache all songs in mshub folder
const SONGS = [
    // List your songs here manually or generate via script
    "mshub/song1.mp3",
    "mshub/song2.mp3",
    "mshub/song3.mp3"
];

// Merge static assets + songs
const FILES_TO_CACHE = ASSETS_TO_CACHE.concat(SONGS);

// Install event — cache essential files
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log("Caching assets for offline use...");
                return cache.addAll(FILES_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event — clean old caches
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log("Deleting old cache:", key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event — serve cached content first
self.addEventListener("fetch", (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((cached) => {
                if (cached) return cached;
                return fetch(event.request)
                    .then((response) => {
                        // Cache dynamically fetched files
                        return caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request.url, response.clone());
                            return response;
                        });
                    })
                    .catch(() => {
                        // Optional fallback for offline (could serve default image)
                        if (event.request.destination === "image") {
                            return caches.match("/icons/logo.png");
                        }
                    });
            })
    );
});
