// The browser client's service worker (docs/adr/0032-installable-web-client.md), at /play/sw.js
// with the scope /play/ (in development /sw.js, scope /). apps/client/pwa/plugin.ts serves it and
// copies it into the build as it is; src/webApp.ts registers it in a plain browser only.
//
// It caches nothing. Pages (navigations) always come from the network, preloaded while the worker
// starts; with no network at all it answers a small page that says so, instead of the browser's
// own. Every other request (the game files, the client's bundles, the socket) isn't touched: the
// install step routes them straight to the network where the browser can (Chrome's static
// routing), and the fetch handler lets them go by where it can't.
//
// KILL SWITCH, if a bad worker ships: set KILL_SWITCH to true and ship (npm run ship, or only the
// client: tools/deploy/stage.ts --client-only). Browsers fetch this file again at every visit
// (Caddy serves it no-cache, and it's registered with updateViaCache "none"), so at each player's
// next page load the new worker installs, unregisters itself and reloads its pages, which then
// run with no worker at all. Deleting sw.js instead does NOT do it: a browser keeps a worker
// whose script answers 404. webApp.ts SERVICE_WORKER = false is the page's own switch (it
// unregisters rather than registers), for as long as the worker still lets pages load.
// One player alone: DevTools > Application > Service workers > Unregister (or Application >
// Storage > Clear site data), or chrome://serviceworker-internals.

const sw = self;

const KILL_SWITCH = false;

sw.addEventListener("install", (e) => {
  void sw.skipWaiting();
  // Chrome 123+ (static routing): only pages come to this worker; nothing else waits for it to start
  if (!KILL_SWITCH && typeof e.addRoutes === "function")
    e.waitUntil(Promise.resolve(e.addRoutes({ condition: { not: { requestMode: "navigate" } }, source: "network" })).catch(() => {}));
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      if (KILL_SWITCH) {
        await sw.registration.unregister();
        for (const client of await sw.clients.matchAll({ type: "window" })) void client.navigate(client.url).catch(() => {});
        return;
      }
      // The page's request starts while the worker does
      await sw.registration.navigationPreload?.enable().catch(() => {});
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (e) => {
  if (KILL_SWITCH || e.request.mode !== "navigate") return;
  e.respondWith(page(e));
});

/** A page from the network, always (Caddy serves index.html no-cache); the offline page without one. */
async function page(e) {
  try {
    return (await e.preloadResponse) ?? (await fetch(e.request));
  } catch {
    return new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

// The colours and type of the client's own pages (apps/client/src/styles.css :root)
const OFFLINE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#cccccc">
<title>Meridian Shards</title>
<style>
html, body { margin: 0; height: 100%; background: #0c0a08; color: #e8dcc2; font-family: Georgia, "Times New Roman", serif; color-scheme: dark; }
body { display: grid; place-items: center; text-align: center; padding: 16px; box-sizing: border-box; }
h1 { color: #d4a94e; font-weight: normal; font-size: 28px; margin: 0 0 12px; }
p { color: #a8977a; margin: 0 0 20px; max-width: 32em; }
button { font: inherit; color: #e8dcc2; background: #1b1612; border: 1px solid #4a3b26; padding: 8px 24px; cursor: pointer; }
button:hover, button:focus-visible { border-color: #d4a94e; outline: none; }
</style>
</head>
<body>
<main>
<h1>Meridian Shards</h1>
<p>You're not connected to the internet. Check your connection, then try again.</p>
<button type="button" onclick="location.reload()">Try again</button>
</main>
<script>addEventListener("online", () => location.reload());</script>
</body>
</html>
`;
