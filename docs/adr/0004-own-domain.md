# ADR 0004: Our own domain, a Bluehost VPS and Cloudflare in front

- **Status:** accepted, 2026-10-10; the domain and the VPS aren't bought yet

## Context

The game runs on a Google Cloud VM at `35-206-75-121.sslip.io`. The download page is on GitHub Pages and the apps are GitHub releases. We want:

- a domain of our own, with a marketing site at its root, a wiki at `/wiki`, the browser client at `/play` and the downloads at `/download`;
- not to depend on GitHub Releases for good;
- big files (the 477 MB installers, the 430 MB of game files a browser player loads over time) not to use the game server's bandwidth.

We looked at Netlify (an account we already have):
- It can't proxy WebSockets, so `/ws` would need its own host.
- Its free plan's credits come to about 30 GB of bandwidth a month, and sites pause when they run out.
- Netlify Blobs has no public URLs, and its downloads draw on the same credits.

It would do for the static sites, not for the game files or the installers.

## Decisions

1. **The domain is registered with Cloudflare Registrar** (at cost) and its DNS is on Cloudflare (free). Cloudflare doesn't give domains away; its DNS, cache and R2 free tier cost nothing.
2. **A Bluehost VPS runs the stack as it is** (`deploy/docker-compose.yml`: blakserv, the gateway, Caddy). It needs root access and Docker, so it can't be shared hosting. blakserv is 32-bit but builds in its own image, so any x86-64 Linux will do.
3. **One domain, paths, everything through Caddy, Cloudflare in front:**

   | Address | Served by | What |
   |---|---|---|
   | `<domain>/` | Caddy, cached by Cloudflare | The marketing site (static files) |
   | `<domain>/wiki/` | Caddy, cached | The wiki (static files) |
   | `<domain>/play/` | Caddy, cached | The browser client, built with `--base /play/` |
   | `<domain>/assets/*` | Caddy, cached | The game files. They stay at the root: the client and both apps ask for `/assets/` |
   | `<domain>/ws` | Caddy → the gateway | The game connection (Cloudflare passes WebSockets through) |
   | `<domain>/download/` | A page of the marketing site | Its links go to `dl.<domain>` |
   | `dl.<domain>` | Cloudflare R2 | Installers, the APK and the update feeds. R2 charges nothing for downloads |
   | `game.<domain>` | The VPS, DNS only (not proxied) | Port 5959 for original Windows clients; Cloudflare's free plan only passes web traffic |

   The marketing site may use any path except `/play`, `/assets` and `/ws`.
4. **Cloudflare caches `/assets/*` and `/play/*`** (a Cache Rule: eligible for cache, respect the origin's headers). Caddy already marks hashed files immutable and `manifest.json` and `index.html` no-cache. By default Cloudflare only caches known extensions, and `.bgf`, `.roo` and `.rsb` aren't among them. After the first request for a file, the VPS barely sends it again.
5. **Player addresses come from `CF-Connecting-IP`, only from Cloudflare's ranges** (`deploy/web/Caddyfile`'s `trusted_proxies`). Caddy passes them to the gateway as the only `X-Forwarded-For` entry, so its 4-per-address limit stays per player. Requests from anywhere else use their own address, so the header can't be forged. The ranges are Cloudflare's published list (https://www.cloudflare.com/ips/); it rarely changes.
6. **TLS:** Cloudflare's SSL mode is Full (strict). Caddy keeps getting its own Let's Encrypt certificate: let it issue the first one with the record DNS-only, then turn the proxy on. If renewals through the proxy fail, use a Cloudflare Origin Certificate in Caddy instead (15 years, trusted by Cloudflare only, which is all that connects).
7. **Releases move to R2 later, in their own step:**
   - The desktop app's update feed becomes electron-builder's `generic` provider at `https://dl.<domain>/desktop/`.
   - The Android update check (`host.ts`, the GitHub API today) reads a `latest.json` there.
   - CI uploads to R2 (its S3 API, with keys as GitHub secrets) instead of making a GitHub release.
   - Installed apps look at GitHub for updates, so one last GitHub release carries the switch.
8. **During the move, both names work:** `SITE_ADDRESS` takes both hostnames (comma-separated), `GATEWAY_ORIGINS` lists `https://<domain>` next to the sslip.io one, and the apps' server lists (`apps/desktop/src/settings.ts`, `ShardsHost.java`) gain the domain before the old entry goes.

## Consequences

- The VPS carries the game connections (a few MB per player an hour) and cache misses only.
- The hosted browser client is at `/play/`, already on the Google Cloud VM, where everything else redirects there until the marketing site exists. The desktop and Android builds keep their pages at `/`.
- The game files are cached at Cloudflare. Cloudflare's terms discourage using its free cache mostly for large downloads such as video, which is why the installers go to R2, not the cache.
- Steps for us, in order:
  1. Buy the VPS; install Docker; follow `deploy/README.md` sections 3–5 with the new host.
  2. Buy the domain at Cloudflare. Add the DNS records: `<domain>` (DNS only at first, see 6), `game` (DNS only).
  3. Set `SITE_ADDRESS` and `GATEWAY_ORIGINS` on the VPS, push, check `https://<domain>/play/`, then turn the proxy on and add the cache rule.
  4. Add the domain to the apps' server lists and release.
  5. Move the savegame from the Google Cloud VM if it should carry over (the `savegame` volume), then retire the VM.
  6. Later: R2, the update feeds and the marketing site and wiki.
