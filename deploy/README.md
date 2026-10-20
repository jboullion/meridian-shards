# Hosting Meridian Shards

The hosted stack is three containers on one small Linux VM:

| Container | What it is |
|---|---|
| `blakserv` | The unmodified Server 104 server, built for Linux (32-bit), with the compiled Kod, resources and rooms from our build. Game state lives on the `savegame` volume. |
| `gateway` | The WebSocket-to-TCP gateway (`tools/gateway/gateway.ts`), with the arena's feed on `/social` and the arena it runs (friends and pets are kept by blakserv since ADR 0015) ([ADR 0007](../docs/adr/0007-arena.md)). The arena's season lives on the `arena` volume (`/srv/gateway/state/arena-state.json`). |
| `web` | Caddy: HTTPS (Let's Encrypt), the website at `/` (the landing page, `/download/` and the wiki: the `meridian-shards-website` repository next to this one), the browser client at `/play/`, the game assets at `/assets/`, the gateway at `/ws` and the arena's feed at `/social` (in the gateway's process; it keeps nothing on disk but the arena's season). Friends and pets are kept by blakserv ([ADR 0015](../docs/adr/0015-social-on-our-server.md)). Without a staged website every other path redirects to `/play/`, as before. The browser client was taken down on 2026-10-08 and is back since 2026-10-09; most players use the desktop or Android app. |

Port 5959 is also open for original Windows clients built with our `SecretKey`. Our apps only need 443.

It needs about 200 MB of RAM (blakserv about 150 MB). An e2-small is comfortable; the free-tier e2-micro (1 GB) also fits.

## 1. Try it locally first

Needs Docker Desktop. From the repo root, after `server\build.cmd` and `npm run assets`:

```bash
node tools/deploy/stage.ts
docker compose -f deploy/docker-compose.yml up -d --build
```

`deploy/.env` sets the local ports (8080 for the site, 5960 for the game, so it doesn't clash with the Windows server). Open http://localhost:8080. Stop it with `docker compose -f deploy/docker-compose.yml down` (add `-v` to also wipe the local game).

## 2. Create the VM on Google Cloud

In the Google Cloud console (console.cloud.google.com):

1. Create a project (e.g. `meridian-shards`), make sure billing is on (your monthly credit applies), and enable the Compute Engine API.
2. **Compute Engine → VM instances → Create instance:**
   - **Name:** `shards-1`
   - **Region:** a US region near your players, e.g. `us-central1` (Iowa) or `us-east1`.
   - **Machine type:** `e2-small` (2 vCPU shared, 2 GB). The always-free `e2-micro` works too in `us-central1`, `us-east1` or `us-west1`.
   - **Boot disk:** the default Debian 12 or Ubuntu 24.04 LTS (x86/64), 20 GB balanced persistent disk (30 GB standard for the free tier).
   - **Firewall:** tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
3. **Static IP:** VPC network → IP addresses → find the VM's external address → **Promote to static**. A static address attached to a running VM costs the same as the default ephemeral one, and it keeps the site's hostname from changing.
4. **Game port for original clients (optional):** VPC network → Firewall → Create rule: name `shards-game`, targets "All instances", source `0.0.0.0/0`, TCP `5959`.

Approximate cost for e2-small in `us-central1`: VM about $12–13/month, external IPv4 about $3.65/month, disk about $2/month; your $10 credit covers most of it. Stopping the VM stops the VM charge (the IP and disk still cost a little).

## 3. SSH access

On your PC (PowerShell), make a key just for this server:

```bash
ssh-keygen -t ed25519 -f $HOME/.ssh/meridian_shards -C shards
```

Copy the contents of `$HOME\.ssh\meridian_shards.pub`, then in the console: the VM → **Edit** → **SSH Keys** → **Add item** → paste it → Save. The line ends with the username (`shards`), which is the user you log in as. Check it works:

```bash
ssh -i $HOME/.ssh/meridian_shards shards@<EXTERNAL_IP>
```

## 4. Prepare the VM (once)

In that SSH session:

Install Docker Engine and the compose plugin from Docker's own repository (works on the
Debian 12 image Google Cloud picks by default; on Ubuntu replace `debian` with `ubuntu`):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl && sudo install -m 0755 -d /etc/apt/keyrings && sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list && sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```bash
mkdir -p ~/meridian-shards/deploy && nano ~/meridian-shards/deploy/.env
```

Put this in `.env`, using **your** static IP with dashes (34.123.45.67 becomes `34-123-45-67.sslip.io`):

```
SITE_ADDRESS=34-123-45-67.sslip.io
GATEWAY_ORIGINS=https://34-123-45-67.sslip.io,app://shards,https://localhost,app://unreal-meridian
```

The first entry is the site itself, for the browser client; without it the gateway turns browser players away. `app://shards` is the desktop app's page origin; without it the gateway turns the desktop app away. `app://unreal-meridian` is the Unreal remaster (`meridian-unreal`, its ADR 0010), which plays on this server too. After changing `.env`, restart the gateway: `docker compose up -d gateway`.

## 5. Deploy (and redeploy)

**The one-button way** (since 2026-10-20), from the repo root on your PC:

```bash
npm run ship -- -m "What changed"
```

`tools/deploy/ship.ts`:
- builds the server (`server\build.cmd`: the quests, the Kod, blakserv) and the game files, and runs `npm run check`;
- commits whatever changed in both repositories (meridian-browser and shards-server, through `server/src`) with that message, and pushes both;
- on the VM, saves the game, then deploys with `push.ts`. The game files go up only when they changed since the last ship;
- waits for blakserv to listen again, then `Recreate`s every room built from a `.roo` that changed since the last ship (`dist/assets/rooms.json` maps files to rooms). With no record yet, it compares against shards-server as it was at the last release tag;
- writes what it shipped to `~/.meridian-shards/last-ship.json`.

The VM comes from `.env`: `SHARDS_DEPLOY_HOST` and `SHARDS_DEPLOY_KEY`. Other options:
- `--message-file` takes a longer message;
- `--skip-build` and `--skip-checks` skip those steps;
- `--no-deploy` commits and pushes only;
- `--dry-run` prints every step without doing it.

**Releases** run a ship first, then `release.ts` with the next version (section 6):

```bash
npm run release:patch -- -m "What changed"
```

```bash
npm run release:minor -- -m "What changed"
```

`release:patch` is an incremental release (0.12.0 to 0.12.1); `release:minor` goes to 0.13.0. `--skip-ship` releases what's already deployed, and `--no-wait` pushes the tag and leaves.

**By hand:**

From the repo root on your PC:

```bash
node tools/deploy/push.ts --host shards@<EXTERNAL_IP> --key $HOME/.ssh/meridian_shards
```

The first push uploads about 450 MB (mostly the game assets). For code-only updates add `--skip-assets`. To update only the browser client, the website and Caddy's config, add `--web-only`: it rebuilds the client and the website, recreates only the `web` container and leaves blakserv and the gateway running, so nobody is disconnected. The first start takes a minute: Docker builds blakserv, and Caddy fetches the certificate. Then open `https://<dashed-ip>.sslip.io`, which should show the website, and `/play/`, which should show the browser client's log on screen.

`stage.ts` builds the website from `../meridian-shards-website` (or the folder in `SHARDS_SITE`; run `npm install` there once). Set `SITE_URL` to the site's `https://` origin when it's on its final address: that turns on canonical URLs, the sitemap and indexing. `--skip-site` leaves it out.

The move to our own domain, with Cloudflare in front, is planned in [ADR 0004](../docs/adr/0004-own-domain.md). Caddy is ready for it: it takes player addresses from Cloudflare's `CF-Connecting-IP` header, but only from Cloudflare's published ranges.

## 6. The desktop app

The desktop app (`apps/desktop`, [ADR 0002](../docs/adr/0002-desktop-shell.md)) carries the game files in its installer and asks the server only for files that changed since. Its installers and updates come from GitHub Releases, not the VM. The server needs nothing new except `app://shards` in `GATEWAY_ORIGINS` (above). To release:

1. Deploy the server first (section 5). The release build copies the game files from the VM's `/assets/`.
2. From a clean, up-to-date `main`, release the next version:

```bash
npm run release -- 0.1.3
```

`tools/deploy/release.ts` checks the tree, bumps `apps/desktop/package.json`, commits "Release v0.1.3", tags and pushes with git. Then it follows the **Desktop builds** workflow:
- the `draft` job creates a draft release with generated notes;
- the three `build` jobs build Windows, macOS and Linux and upload into the draft;
- the `android` job builds the signed APK (`Meridian-Shards-<version>.apk`) and the page by itself (`Meridian-Shards-web-<version>-shell<n>.zip`, for updates without a new APK) and uploads them too;
- the `publish` job checks every platform's files are there and publishes the release as the latest.

The script prints each job's progress and ends with the release link, or names the failed job and step. A failed build leaves the draft unpublished, so players never get half a release. `npm run release -- --watch 0.1.3` follows a run again; `--no-wait` pushes and leaves.

Don't create releases by hand. A release that already exists for the tag makes the builds skip their uploads, and the script refuses a version that has one.

Installed apps find the new release at their next launch, download the changed blocks in the background, and offer "Restart to update" on the login screen. Unsigned macOS builds can't update themselves. The download page always lists the latest published release.

**The download page** is the website's `/download/` (`meridian-shards-website`, `app/routes/download.tsx`). It reads the latest release from GitHub's API when it's opened, so releases never need the site rebuilt. The old copy on GitHub Pages (`deploy/web/site/download/`) stays up until the website is live on the server:
- `.github/workflows/pages.yml` publishes it when that folder changes on `main`, or from the Actions tab.
- The repository's Pages source must be **GitHub Actions** (Settings → Pages).

To build only Windows locally: `npm run desktop:dist` makes the installer in `apps/desktop/dist/`. `npm run desktop:release` uploads it to the draft release too, with a token in `GH_TOKEN`.

## 7. The Android app

The Android app (`apps/android`, [ADR 0003](../docs/adr/0003-android.md)) ships in the same release as the desktop installers: one APK with the game files inside, about 380 MB. Players download it from the release or the download page and install it themselves the first time. After that the app updates itself from the releases ([ADR 0003](../docs/adr/0003-android.md) section 7):
- **Most releases change only the page.** The app downloads the release's `-web-` zip in the background (about 330 KB), checks it, and offers "Restart to update" on its login screen. A page that doesn't start is rolled back at the next launch.
- **When the native side changes**, bump `apps/android/shell.json` before releasing. Apps with an older shell then get the APK instead: the app downloads it and opens Android's installer (the first time, Android asks to allow the app to install apps).
- Apps from 0.6.1 and before only link to the APK, which the phone's browser downloads; one install of a newer APK gives them the rest.

**The release key.** Android installs an update only if it carries the same signature as the installed app, so every APK is signed with one key, kept for good:
- `~/.meridian-shards/android-release.jks` and `android-release.properties` (its password) on the machine that made it. Back both up. If they're lost, players must uninstall to get a newer version.
- In the repository's secrets (Settings → Secrets and variables → Actions):
  - `ANDROID_KEYSTORE_BASE64`: the `.jks` in base64 (`android-release.jks.base64.txt` beside it);
  - `ANDROID_KEYSTORE_PASSWORD`: `storePassword` from the properties file.
- Without the secrets, the `android` job fails, and so does the release.

To build a signed APK locally and run it on a phone or the emulator: `npm run android:run -- --release`. It uninstalls a debug build first, because that's signed with another key.

## Running it

All of these run on the VM, in `~/meridian-shards`:

| Task | Command |
|---|---|
| Status | `sudo docker compose -f deploy/docker-compose.yml ps` |
| Logs | `sudo docker compose -f deploy/docker-compose.yml logs -f --tail 100` |
| Admin command | `sudo docker compose -f deploy/docker-compose.yml exec blakserv maint "who"` |
| Save the game now | `sudo docker compose -f deploy/docker-compose.yml exec blakserv maint "save game"` |
| Server console | `sudo docker attach meridian-shards-blakserv-1` (detach with Ctrl+P, Ctrl+Q) |
| Restart | `sudo docker compose -f deploy/docker-compose.yml restart` |
| Change the message of the day | Edit `server/config/motd.txt` and redeploy, or on the VM: `sudo docker compose -f deploy/docker-compose.yml cp motd.txt blakserv:/srv/blakserv/motd.txt` then `... exec blakserv maint "reload motd"` (lasts until the container is recreated) |
| Back up the game | `sudo docker run --rm -v meridian-shards_savegame:/s -v $PWD:/b ubuntu tar czf /b/savegame-$(date +%F).tgz -C /s .` |
| Change the arena's fights | Write an `arena.json` (every field in [ADR 0007](../docs/adr/0007-arena.md) 6), then `sudo docker compose -f deploy/docker-compose.yml cp arena.json gateway:/srv/gateway/state/arena.json` and `... restart gateway`. The log says what it didn't understand. It stays on the `arena` volume across deploys; delete it there to go back to the defaults |
| The arena's season | `sudo docker compose -f deploy/docker-compose.yml exec gateway cat /srv/gateway/state/arena-state.json` (each server's season, roster, records and champions). Removing it starts a new roster now, without the old champions |

blakserv saves every 30 minutes (`[Auto] SavePeriod`). Run "save game" before stopping the VM or redeploying.

**Old saves are pruned every hour.** blakserv writes a whole save set each time (`accounts`, `dynarscs`, `gameuser` and `striings`, named by the save's time) and never deletes one: by 2026-10-17 the volume held 474 sets, 1.7 GB. `deploy/prune-saves.sh` keeps the newest 48 (a day's), the last of each day for 14 days, and always the one `lastsave.txt` names; it touches nothing else in the volume (`old-world/`). Cron runs it as root at :17, clear of the saves:
- Set it up once (done on 2026-10-17): `echo "17 * * * * root sh /home/shards/meridian-shards/deploy/prune-saves.sh >> /var/log/meridian-shards-saves.log 2>&1" | sudo tee /etc/cron.d/meridian-shards-saves`.
- Each deploy brings the script up to date, as it's in `deploy/`.
- `sudo DRY_RUN=1 sh deploy/prune-saves.sh` says what it would remove; `KEEP_RECENT` and `KEEP_DAYS` change how much stays. `/var/log/meridian-shards-saves.log` has a line per run.
- To go further back than 14 days, back the game up (above) and keep the copy off the VM.

**A save the new Kod can't load starts a new world.** If any saved object's class is gone from the Kod, blakserv's `LoadGame` fails. It then starts a fresh world with the old accounts but no characters (`blakserv/loadall.c`), and its next save overwrites the old world.
- **After Kod changes that remove classes,** try the VM's save on a copy first. Copy the latest `accounts`, `dynarscs`, `gameuser` and `striings` files and `lastsave.txt` into the `savegame/` of a copy of the local run folder. Change its ports, start it, and look for `LoadObject can't find class name` in `channel/error.txt`.
- **After a fresh start,** give each account its character slots again with `create user <account>`, four each.
- **This happened on 2026-10-16,** when the server cleanup's removed crafting and monster classes met the old save. The old save is backed up on the VM (`~/savegame-before-phase5-1792167724.tgz`) and in `~/.meridian-shards/backups` on the PC that deployed.

**Don't send maintenance commands while blakserv is starting** (the first minute after a deploy or restart). On 2026-10-12 a `show status` sent during startup never answered and left the server's main loop hung: the port still accepted connections, but every login waited forever (the gateway logged `down 0 B`). The way out is `sudo docker compose -f deploy/docker-compose.yml restart blakserv`. To see whether it's up, try logging in, or watch for `network worker thread started` in `channel/debug.txt`.

## Notes

- **The Linux build** needed two compiler flags and the `-i` (console) option; see the comments in `blakserv/Dockerfile`. Kod names a few room files in a different case than the files on disk, which Linux minds, so `stage.ts` lists those spellings and the image links them.
- **blakserv.cfg** here is the Linux copy of `server/config/blakserv.cfg`. Keep them in step (the SecretKey above all: the client build reads it from `server/config/blakserv.cfg`).
- The maintenance port (9998) never leaves the container.
