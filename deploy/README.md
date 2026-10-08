# Hosting Meridian Shards

The hosted stack is three containers on one small Linux VM:

| Container | What it is |
|---|---|
| `blakserv` | The unmodified Server 104 server, built for Linux (32-bit), with the compiled Kod, resources and rooms from our build. Game state lives on the `savegame` volume. |
| `gateway` | The WebSocket-to-TCP gateway (`tools/gateway/gateway.ts`). |
| `web` | Caddy: HTTPS (Let's Encrypt), the game assets at `/assets/`, the gateway at `/ws`, and the desktop app's download page (`/download/`; the installers are on GitHub Releases). Every other path, `/` included, redirects to the download page: the browser client isn't hosted (since 2026-10-08), so players use the desktop or Android app. |

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
GATEWAY_ORIGINS=app://shards,https://localhost,app://meridian-remastered
```

`app://shards` is the desktop app's page origin; without it the gateway turns the desktop app away. `app://meridian-remastered` is the Unreal remaster (`meridian-unreal`, its ADR 0010), which plays on this server too. After changing `.env`, restart the gateway: `docker compose up -d gateway`.

## 5. Deploy (and redeploy)

From the repo root on your PC:

```bash
node tools/deploy/push.ts --host shards@<EXTERNAL_IP> --key $HOME/.ssh/meridian_shards
```

The first push uploads about 450 MB (mostly the game assets). For code-only updates add `--skip-assets`. The first start takes a minute: Docker builds blakserv, and Caddy fetches the certificate. Then open `https://<dashed-ip>.sslip.io`, which should show the download page.

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
- the `publish` job checks every platform's files are there and publishes the release as the latest.

The script prints each job's progress and ends with the release link, or names the failed job and step. A failed build leaves the draft unpublished, so players never get half a release. `npm run release -- --watch 0.1.3` follows a run again; `--no-wait` pushes and leaves.

Don't create releases by hand. A release that already exists for the tag makes the builds skip their uploads, and the script refuses a version that has one.

Installed apps find the new release at their next launch, download the changed blocks in the background, and offer "Restart to update" on the login screen. Unsigned macOS builds can't update themselves. The download page at `https://<dashed-ip>.sslip.io/download/` always lists the latest published release.

To build only Windows locally: `npm run desktop:dist` makes the installer in `apps/desktop/dist/`. `npm run desktop:release` uploads it to the draft release too, with a token in `GH_TOKEN`.

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

blakserv saves every 30 minutes (`[Auto] SavePeriod`). Run "save game" before stopping the VM or redeploying.

## Notes

- **The Linux build** needed two compiler flags and the `-i` (console) option; see the comments in `blakserv/Dockerfile`. Kod names a few room files in a different case than the files on disk, which Linux minds, so `stage.ts` lists those spellings and the image links them.
- **blakserv.cfg** here is the Linux copy of `server/config/blakserv.cfg`. Keep them in step (the SecretKey above all: the client build reads it from `server/config/blakserv.cfg`).
- The maintenance port (9998) never leaves the container.
