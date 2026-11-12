/* ==========================================
   MONEYMENTOR — SERVICE WORKER
   Guarda la interfaz para que abra rápido y sin conexión.
   No toca las peticiones a la API: los datos siempre vienen de MySQL.
========================================== */

const CACHE_NAME = "moneymentor-v2";

const APP_SHELL = [
    "./",
    "./index.html",
    "./css/style.css",
    "./js/app.js",
    "./manifest.json",
    "./img/icons/icon-192.png",
    "./img/icons/icon-512.png",
    "./img/icons/icon-maskable-192.png",
    "./img/icons/icon-maskable-512.png",
    "./img/icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// Borra cachés de versiones anteriores
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Primero la red (siempre la versión más nueva) y, si no hay conexión, la copia guardada
self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);

    // Solo archivos propios de la app; la API y otros sitios pasan directo
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(request, { ignoreSearch: true });
                if (cached) return cached;
                if (request.mode === "navigate") return caches.match("./index.html");
                return Response.error();
            })
    );
});