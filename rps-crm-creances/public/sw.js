/* Mode dégradé lecture (CDC-05 §8, palier 1) : les pages déjà vues restent consultables hors réseau,
   avec leur date. Les actions (POST) sont impossibles hors ligne. Aucun calcul côté client. */
const CACHE = "rps-crm-pages-v1";
const STATIQUE = "rps-crm-statique-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE && k !== STATIQUE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icone.svg") {
    e.respondWith(caches.open(STATIQUE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  // pages : réseau d'abord, cache en repli (page « telle que vue le … »)
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok && r.headers.get("content-type")?.includes("text/html")) caches.open(CACHE).then((c) => c.put(req, r.clone()));
      return r;
    }).catch(async () => {
      const c = await caches.open(CACHE);
      const enCache = await c.match(req);
      if (enCache) {
        const h = new Headers(enCache.headers);
        h.set("X-Hors-Ligne", "1");
        return new Response(enCache.body, { status: 200, headers: h });
      }
      return new Response("<!doctype html><html lang='fr'><body style='font-family:Arial;padding:24px'><h1>Hors ligne</h1><p>Cette page n'a pas encore été consultée : elle n'est pas disponible sans réseau. Les pages déjà ouvertes (tableau de bord, clients, fiches) restent consultables.</p></body></html>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    })
  );
});
