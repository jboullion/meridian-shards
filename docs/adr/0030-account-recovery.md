# ADR 0030: Account recovery (link an email on the website, reset through it)

- Status: accepted (2026-10-31). Built: blakserv's `account` commands, the account service, deployment and the login screen's link. The website pages are in meridian-shards-website.
- Builds on: the live stack ([deploy/README.md](../../deploy/README.md)) and our own domain ([ADR 0004](0004-own-domain.md)).

## Context

Logging in with a name nobody has used creates the account (shards-server `blakserv/synched.c` `SynchedAcceptLogin`). That keeps joining to one step, and we keep it. The cost: a player who forgets their password loses the account, because the server knows nothing else about them. Accounts have always had an `email` field (saved in the `accounts` file), but nothing fills it: auto-created accounts get none.

## Decision

1. **Sign-up stays as it is.** Linking an email is optional, on the website (`/account/`): sign in with the account name and password, enter an email, and open the link that's emailed. The email is stored only once the link is opened.
2. **A linked email unlocks recovery:**
   - Forgot password: by account name or email. A reset link that works for an hour goes to the linked address.
   - Forgot account name: every account linked to an email is listed in one message.
3. **One email can link to many accounts** (alts).
4. **The account service** (`tools/accounts/`, container `accounts`) serves `POST /api/account/<route>` behind Caddy. The routes are `status`, `link`, `verify`, `unlink`, `forgot`, `names` and `reset`.
   - It runs in blakserv's network namespace, so it reaches the maintenance port on 127.0.0.1. That port still accepts no other connection.
5. **blakserv's `account` maintenance commands** (`blakserv/adminfn.c`, `admin_account_table`). Each answers in one-line `ACCOUNT ...` records:
   - `byname`, `byid`, `byemail`: the id, a stamp, the email and the name.
   - `check <hex> <name>`: tests a password digest.
   - `digest <id> <hex>`: sets a password digest.
   - `email <id> <addr|->`: sets or clears the email.

   The stored digest never leaves the server. The stamp is an MD5 of it, which changes whenever the password does.
6. **Passwords travel as the login digest.** The pages send the same MD5 the game client sends at login (`packages/protocol` `md5.ts`, as hex), never the plain password. A reset sets that digest directly. So the website and the game agree with no plaintext anywhere and no second hash to keep in step.
7. **Links are signed, not stored.** A token is HMAC-SHA256 (`ACCOUNTS_SECRET`) over the purpose, account id, email, expiry and the account's stamp.
   - A reset link dies once the password changes, its own use included.
   - A pending link dies if the password changes before it's opened.
   - The service keeps no state, so a restart loses nothing.
8. **Abuse:**
   - Forgot and names give the same answer whether or not anything matched.
   - Per-address limit: 20 requests per 10 minutes.
   - At most 3 emails per hour to an account or an address.
   - Cloudflare Turnstile on the forms when `TURNSTILE_SECRET` is set.
   - Changing, removing or resetting sends a notice to the address that was linked.
9. **Mail goes through Resend's HTTP API** from `noreply@m59-shards.com`. The domain is verified with DNS records in Cloudflare. Without `RESEND_API_KEY` the emails are only logged, which is how it runs locally.

### Sessions and the account page (2026-11-01)

10. **`/account` remembers who signed in**, so it shows accounts and characters instead of a form on every visit. There are two ways to sign in:
    - `login`: account name and password. The session covers that one account and ends when its password changes, because it carries the stamp.
    - `signin`: emails a sign-in link that works for 15 minutes. `session` swaps the link for a session that covers every account linked to that email.
11. **The session is a signed token in an HttpOnly cookie**:
    - The cookie is `shards_session`, with `Path=/api/account; SameSite=Strict`, plus `Secure` in production, and lasts 30 days.
    - Page scripts never see it, and the service still stores nothing.
    - `logout` clears it.
    - `link` and `unlink` now act on a session's account (`{accountId}`) instead of taking the password each time.
12. **`me` shows each account's last login and its characters**, from two blakserv sources:
    - `account byid/byname/byemail` records now carry `login=` (unix seconds).
    - **`account characters <id>`** lists each character that has been played: id, online, max hit points, faction and renown, then name, guild and renown rank, separated by `|`.
    - Characters read the Kod properties by name (`GetPropertyIDByName`). A slot where `IsFirstTime` is still true has no character in it, so it isn't listed.
    - `me` doesn't count towards the per-address limit, since the page asks it on every visit.
13. **The website's header** has an account button in place of the Discord and GitHub icons, which stay in the footer.

## Consequences

- Players who never link an email are no better off. The login screen's "Forgot your password?" link leads to the page that explains linking. An in-game reminder for unlinked accounts is not built: Kod can't see the email.
- Password storage is still one unsalted MD5, as the protocol requires. Hardening it changes the login message and is a separate decision.
- The service waits a minute after starting before its first maintenance command (`ACCOUNTS_START_DELAY_MS`). On 2026-10-12, an early command hung blakserv.
- When blakserv is recreated on its own, the account service needs `docker compose up -d accounts` to join its new network. A full `up -d --build` does both.

## Verifying

- `npx vitest run tools/accounts`: tokens, reply parsing and every route, against a fake blakserv.
- End to end on the testbench sandbox (port 9999): `MAINT_PORT=9999 ACCOUNTS_PORT=8061 node tools/accounts/accounts.ts`, then link, verify, forgot and reset. Check that a reused link is refused, and that `account check` takes the new digest.
