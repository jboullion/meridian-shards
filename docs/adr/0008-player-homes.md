# ADR 0008: Player homes and rented inn rooms

- **Status:** proposed, 2026-10-15. Not built. Amends [ADR 0001](0001-direction.md) decision 4 (2 below).
  - Changed 2026-10-15 ([ADR 0015](0015-social-on-our-server.md)): our client sends its `#` commands as `UC_SHARDS` lines, the same words without the `#`, instead of speaking them. Nothing is spoken, so there are no lines to hide.

## Context

Two features are wanted:
- **Player homes ("plots"):** buildings in the cities whose doors lead nowhere today get an interior that a player buys, for 50,000 to 500,000 shillings depending on where it is. Inside, the player keeps items and decorates: we build the geometry and the starting props, and the owner adds and removes props.
  - A sign outside says whether the plot is for sale or owned, never by whom.
  - Only the owner, their other characters and the guests they name can go in.
- **Rented inn rooms:** about 1000 shillings a real day. They're instanced, so every renter at an inn shares the same door. Gear can be stored there and guests can visit. This covers Tos, Barloque, Cor Noth, Ko'catan and the like.

### What Server 104 already has

Server 104 already has much of this. Paths below are under `server/src/kod/`.

**Instanced rented rooms**, in three inns only: Barloque, Marion and Ko'catan.
- **Where the code is:**
  - `util/rntmaint.kod`: `RentableRoomMaintenance`, a singleton reached with `SYS@GetRentableRoomMaintenance`.
  - `object/active/holder/room/rentroom.kod`: `RentableRoom`.
  - `rentroom/barrent.kod`, `marrent.kod`, `kocrent.kod`.
- **One room file, many renters:** each rental is its own room object.
  - Its room number is the first free one from `RID_RENTABLE_START` (10000), created with `SYS@CreateOneRoomIfNew`.
  - Every renter at one inn shares one `.roo`.
  - The client already copes:
    - `roomCache.ts` keys on the file.
    - Each `BP_PLAYER` builds a fresh `LiveRoom`, so one renter's carpet and wallpaper changes stay in their own room.
- **Renting:** say "rent room" to the innkeeper (`bqinnk.kod`, `mrinnk.kod`, `kcinnk.kod`).
  - 5000 shillings, which includes 85 game days.
  - After that, 75 per game day, paid by giving the innkeeper shillings (`GotRent`), up to 1440 days.
  - A game day is 2 real hours, so that's about 900 a real day.
  - One room per character per inn.
- **Keys:** a gold `RoomKey` that can't leave the renter, and silver `RoomKeyCopy`s at 500 each that anyone can hold or trade.
  - To go in, use the key while standing at the inn's locked door (`RoomKeyCopy.NewApplied`, then each inn's `EnterRentableRoom`).
  - The door's `plExits` entry is `ROOM_LOCKED_DOOR`.
- **Decorating:** a `Decorator` NPC (`object/active/holder/nomoveon/battler/monster/towns/decoratr.kod`), called with a bell. Only the renter can use it.
  - It places props snapped to fine 16 or 48 in the renter's square, and removes the nearest one (`rentroom.kod TryPlaceObject`, `TryRemoveObject`).
  - The props come in tiers unlocked with heartstones.
  - Prices: 500 a prop, 4500 more for a storage box. A removed prop refunds 80% as credit.
  - At most 2 `StorageBox`es per room.
- **Sanctuaries:** no combat, no portals, no tokens.
- **Expiry:** warnings by mail, then the room is deleted.
  - Anyone inside goes to safety.
  - The keys delete themselves.
  - **The boxes and everything in them are lost:** `EnterLimbo`, then deleted 6 hours later.

### What it lacks

- **No guest, friend or ignore list anywhere in Kod.** Our friends ([ADR 0005](0005-friends.md)) live only in each client and on the relay, which knows nothing about the game, so the server can't enforce them.
- **Kod can't see a character's account.** blakserv keeps `user_node.account_id` (`blakserv/user.c CreateNewUser`), but no Kod built-in returns it.
- **Floor drops don't last.** Items dropped on the floor are deleted by `Room.DisposeTimer` once nobody is in the room. Props (`OrnamentalObject`) and boxes stay.
- **Signs have fixed text.** `object/passive/sign.kod` takes its text as a resource in its constructor.
- **Messages from the client are fixed in C** (`blakserv/sprocket.c`'s tables). Kod hears new commands only as speech, as the decorator does. (Kod can send the client new ones: [ADR 0009](0009-quests.md) 3.2.)
- **Dead doors** are `ROOM_LOCKED_DOOR` entries in a room's `plExits`, which says "the door is locked" (`room.kod SomethingTryGo`). Tos has 16, Barloque's port 29, Ko'catan south 27, Jasper west 15. A room can override `SomethingTryGo` to send a door somewhere, as `kocinn.kod` does.
- ~~**Nothing we change on the server is in git.** Our Kod lives in the git-ignored `server/src` beside the savegames, and so do room sources.~~ Changed 2026-10-15: `server/src` is a junction to the shards-server repository, so Kod and room changes are committed there (only its `run/` folder is ignored).

### What we have to build with

- **meridian-editor** (`E:\2026_Experiments\meridian-editor`):
  - It compiles `.room.json` sources to `.roo` (`roomc --target 104`, byte for byte what roomedit makes).
  - `tools/shards/install.ts` puts a new room and its Kod class on our server.
- **New rooms and art reach players with a server deploy.** `npm run assets` updates the manifest hashes, and the desktop, Android and browser clients fetch what changed, so no app release is needed.
- **Payment in Kod:** `GetMoneyObject` and `SubtractNumber` on shillings. Shillings weigh nothing (`money.kod viWeight = 0`), so 500,000 can be carried.
- **Vaults** (`object/passive/storage.kod`): `CanDepositItems` / `DepositItems` with a capacity, found with `SYS@FindVaultByNum`.
- **Room numbers:** 8000-8999 are unused. Survival rooms use 9500-9999 and rentals 10000 and up (`include/blakston.khd`).

## Decisions

The user decided these on 2026-10-15:
- plots have no upkeep, and are kept until sold back for half the price or foreclosed after 90 days inactive;
- only our client needs a UI;
- one plot per character, so up to four per account;
- all of an account's characters share its plots and rooms;
- guests come from a list kept on the server;
- storage is owner-only;
- a home's stored items are never lost: they go to a chest at the bank;
- homes are bought and sold at the city's bank (say "properties" or "houses" for the list); inn rooms are rented from the innkeeper, and the bank deals only with homes;
- Barloque gets a bank;
- props are free to place, only limited in number;
- which doors become homes, and their prices, are settled city by city when it's built;
- Marion has inn rooms but no homes; Raza's inns get no rooms;
- guild halls are not part of this ADR: they get their own updates.

### 1. Built in Kod, on the rented rooms' pattern

1. **Homes and inn rooms share one design.** Each kind has a manager object, as `RentableRoomMaintenance` is. Each interior template is one `.roo` file, and each home or rented room is its own room object of that template, created when it's bought or rented.
2. **Everything is server-side.** Access, ownership, storage and props live in Kod and the savegame; nothing in this ADR uses the relay.
3. **This is the biggest Kod change yet**, against ADR 0001's "Kod changes allowed later but kept minimal". Messages from the client don't change (they're fixed in C), so every new command is spoken (8).

### 2. Characters on the same account

1. **One C built-in:** `GetUserAccount(user)` returns the user's `account_id`.
   - It goes in `blakserv/ccode.c`, the built-in table, and the compiler's list of built-ins (`blakcomp`).
   - It is blakserv's first and only C change, so it amends ADR 0001 decision 4 ("unmodified blakserv, config changes only"). It needs our Linux build to carry it too (`deploy/blakserv/Dockerfile`).
2. **Same account counts as the owner.** Any character on the owner's account counts as the owner everywhere below: going in, the boxes, decorating, guests.
3. **The per-character limit stays per character** (5.4). Four characters can hold four plots, and each can use all four.
4. **Rejected:** pairing characters with a one-time code said on each, all in Kod. It proves one person holds both, but it's clumsy, and it falls apart when a character is deleted and remade.

### 3. First: our Kod and rooms in git

Before any of this:
1. **Our Kod changes are versioned in this repo.** For example, a `server/kod/` tree that `server/build.cmd` lays over `server/src/kod`, and the C patch for 2. Losing `server/src` must never lose them.
2. **Room sources** (`.room.json`) are committed where meridian-editor's ADR decision 6 says, with `npm run assets` compiling them.
3. **Saves are migrated on a copy first.** Adding properties to `RentableRoom`, `User` and the inns' room classes changes a live save. We try `reload system` and a restart on a copy of `server/src/run/server` before the VM's.

### 4. Rented inn rooms

1. **Which inns:**
   - Barloque, Marion and Ko'catan keep theirs. Marion has rooms only: no homes (5.2).
   - Tos (Familiars, `tosinn`, RID 52) and Cor Noth (`corinn`, RID 153) get rooms of their own: new interiors built in meridian-editor, or a copy of `barrent.roo` to start.
   - **Jasper** (the Yonder Inn, `jasinn.roo`, RID 370) may get rooms. Its room has no way upstairs, so `jasinn.roo` needs a small edit first: import it into meridian-editor, add the stairs and the rental door, and compile it back. A changed original room means `npm run assets` again (its nav grid, as it has ambient life) and, on the website, rerunning `node scripts/location-art.mjs` and the world map.
   - **Raza's inns get no rooms.**
2. **The innkeeper rents them**, as now: each inn's own keeper (`bqinnk.kod`, `mrinnk.kod`, `kcinnk.kod`, and new ones' for Tos, Cor Noth and Jasper). Banks have nothing to do with inn rooms.
3. **Price: about 1000 shillings per real day.** That's `piPerDayCost` 84 per game day (12 game days to a real day).
   - Renting pays for the first real day, in place of today's 5000 for 85 game days.
   - The 1440-day cap, paying the innkeeper to extend, and the warning mails stay.
4. **One door per inn, walked through.** The inn's `SomethingTryGo` handles its rental door square(s):
   - the renter, or a character on their account, goes to their own room;
   - a guest (6) goes to the one room at this inn that lists them;
   - a guest of several rooms there says `visit <name>`, which our client asks with a picker;
   - anyone else gets the locked door's message.
   
   Keys keep working as now, for anyone the renter gives one to.
5. **Expiry loses nothing.** The boxes' contents go into a chest the **innkeeper** keeps for the renter, in place of `EnterLimbo`: the same kind of chest as a bank's (5.10), emptied the same way, at the inn. The expiry mail says which inn.

### 5. Plots

1. **A table of plots.** The plots are editorial data in a Kod `PlotMaintenance` table, one entry per plot:
   - the city room and the door square(s)
   - the sign's square
   - the interior template
   - the price
   - a display name ("a house on Tos's east street")
   - the city's bank, which sells it and keeps the chest for its contents (5.5, 5.10)
2. **Which doors: a pass over each city when it's built.**
   - The rule: every door in a city that has no room behind it becomes a home. Those are the `ROOM_LOCKED_DOOR` exits, and any drawn door with no exit at all; the pass finds both, room by room.
   - Tos and Barloque will have the most. Ko'catan's are likely all along the outer walls.
   - **Marion gets no homes**, only inn rooms (4.1).
   - The user sets every plot's price in the same pass (from 50,000 to 500,000), and which template it gets.
   - A city needs a bank to have homes. Tos, Jasper, Ko'catan, Raza and Bergen have one (`*bank.kod`).
   - **Barloque gets a bank**: a new room behind one of its dead doors, built in meridian-editor, with a banker like Tos's (money accounts as well as homes). It has a vault (`barvault`, RID 114) but no bank today.
   - **Cor Noth has no bank either**, so it gets one in the same way or has no homes; the city pass decides.
3. **Fixed room numbers.** Each plot gets a fixed number from a range reserved for plots, 8000-8999 (`RID_PLOT_START` in `blakston.khd`). Its room object is created the first time it's bought (`CreateOneRoomIfNew`) and kept while owned.
4. **One plot per character.** There's no upkeep. A plot is held until it's sold back (5.9) or foreclosed (5.10).
5. **Buying, at the city's bank.**
   - Near the banker, say **"properties"** or **"houses"**. The banker opens the game's own Buy window with the homes for sale at that bank: one entry per free plot, named and described (the street, the template), at its price.
   - It's built from what Kod already has, so it needs no new message:
     - the banker calls `Send(who,@UserBuy,#what=self)`, which sends `BP_BUY_LIST` from the banker's `GetForSale` and `GetPrice` (`user.kod UserBuy`);
     - `GetForSale` gives a deed object per free plot;
     - buying one goes through `UserBuyItems` to the banker's `Buy` (`monster.kod`), which the banker overrides: it checks the plot is still free and the character holds none, takes the shillings carried, makes them the owner and deletes the deed.
   - Paid in shillings carried, which weigh nothing (`money.kod`).
6. **The door** works like an inn's (4.4): the owner, their account's characters and their guests walk in, and anyone else is told "This home is locked."
7. **The sign** is a new `PlotSign`: the sign's art and its highlight light, set in the city room's `CreateStandardObjects`. Looking at it says one of two things, worked out when it's looked at:
   - "For sale: N shillings, at the bank of <city>."
   - "This home is owned."
   
   It never names the owner.
8. **Interiors come in two or three templates by price**, for example a cottage, a townhouse and a manor.
   - Each is built in meridian-editor, with its starting props placed by the template's Kod (`CreateStandardObjects`, as rooms place ornaments).
   - The template sets how many storage boxes it has, for example 2, 4 and 6.
   - The owner can remove the starting props.
9. **Selling back, for half the price, at the bank.**
   - At the bank that sold it, the owner (or a character on their account) says `sell house`; a second `sell house` within 30 s confirms.
   - They're paid half of what was paid for the plot, in shillings. The price paid is kept on the plot, so a later change of price doesn't change the refund.
   - The boxes' contents go to the owner's bank chest (5.10), and anyone inside is moved out to the door.
   - The room goes back to its template's starting props.
   - The plot is for sale again at its listed price, and its guest list is emptied.
10. **Foreclosure after 90 days inactive.**
    - Server-wide, a player becomes inactive after **90 days** without logging on: `USER_INACTIVE_TIME` in `user.kod` goes from 60 to 90 days. It also changes the other two things that use it: Frular's count of a guild's active members (`gcreator.kod`) and the factions (`parlia.kod IsUserInactive`).
    - Once a day (`SYS@NewGameDay`, or the real-time callbacks in `util/realtime.kod`), `PlotMaintenance` checks every owner. A plot is foreclosed when **no character on the owner's account** has logged on for 90 days (`IsUserInactive` on each, found through 2): people play their other characters.
    - **The bank forecloses**: the plot is for sale again, its guests and props are cleared as for a sale, and nothing is paid back.
    - **Everything stored goes to a chest at the bank.** The boxes' contents move into a bank chest kept for that character at the plot's bank, which they empty the next time they come by. It has no capacity limit, and it's deleted once empty. To check: whether the banker can answer the vault's Withdraw window (`BP_REQ_WITHDRAWAL`, `user.kod UserWithdrawal`, which also asks `GetForSale`), so the existing window is the way to take things out; else a spoken `chest` at the banker.
    - The owner hears it by mail when it happens, and on logging on while their chest holds anything. The mail and the logon line name the bank.
11. **A deleted character's plot** is freed (the `User` delete path), with its contents. There's no chest for a character that no longer exists.

### 6. Guests

1. **A list per home and per rented room**, of user objects (names change; objects follow them through saves). Up to 20 each.
2. **Commands:** `guest add <name>`, `guest remove <name>` and `guest list`. The owner says them inside or at the door; the list itself is checked only at the door.
3. **What guests can do:** go in, and nothing more. Boxes, decorating and the guest list are for the owner and their account (2.2).
4. **Removed guests leave.**
   - A guest removed while inside is moved out to the door.
   - A guest who logs on inside a room they no longer may enter is sent to safety (`AdminGoToSafety`, as rented rooms already do).
5. **Still sanctuaries:** no combat, portals or tokens, as rented rooms are now. Players' own items dropped on the floor still vanish (`DisposeTimer`): storage is the boxes.

### 7. Decorating

1. **It extends the decorator's commands** (`decoratr.kod`). In homes the bell isn't needed: the owner says the commands.
2. **Props are free.** Placing one costs nothing, and removing one pays nothing back; the only limit is how many (4). The decorator's prices, credit and heartstone tiers go, in inn rooms too, so both work the same way.
3. **Placing:**
   - A prop goes exactly where the owner stands, at their fine position and facing, not snapped to 16 or 48.
   - `move <id>` and `remove <id>` act on a prop by its object id (our client sends the target's). Ids change at saves, so they're only good for a moment, which is all a command needs.
4. **A cap on props.** Each home template, and the inn rooms, has a cap (for example 60 in a home), counting the starting props, so saves and `BP_ROOM_CONTENTS` stay small. Storage boxes are counted apart, by the template (5.8).
5. **The catalogue:** today's props, all of them open to everyone, plus new props over time. New art is `.bgf` in the original palette: a rebuilt `rsc0000.rsb`, then a server deploy.
6. **Changing surfaces:** the carpet, wallpaper and the like keep using `ChangeTexture` / `SetSector`, as rented rooms do. The client already applies those per visit (`LiveRoom`).

### 8. The command channel, and our client

1. **Commands are spoken.** (Changed by [ADR 0015](0015-social-on-our-server.md): they're `UC_SHARDS` lines, `home guest add Alice`, handled by its dispatcher, so no room has to swallow speech.)
   - Every new command is a line said with a reserved prefix, for example `#home guest add Alice`.
   - The room's (or the inn's) `SomeoneSaid` takes such lines before they're passed on, so nobody else hears them. To check: that a room can swallow speech this way.
   - The answers come back to the speaker only.
2. **Our client** gives them a UI:
   - **A Homes tab** beside Friends and Pets (`Sidebar.tsx TABS`):
     - the character's home and rooms, and their guests
     - **Add from my friends**: picks among the relay's friends and sends `guest add` for each; the server only ever sees the owner's choice
     - where a bank or inn chest is waiting
     - the picker for `visit` (4.4)
   - **At a bank:** Properties and Sell house buttons, which send the spoken commands. The list of homes for sale is the existing Buy window (`GameView askTrader`), with nothing new needed to show it.
   - **A decorate mode:** the catalogue, how many props are left under the cap, Place here, Turn, and Remove or Move on the target.
   - ~~**Hidden lines:** the command lines and their answers are hidden through `GameSession.lineFilter`, as friend tells are (`social.ts hideFriendTells`).~~ Not needed with `UC_SHARDS` (ADR 0015).
   - **Room names:** plot and rental rooms get names for a friend's Locate. They have no fixed number and `rooms.json` skips them (`roomLinks.ts parseRoom`), so Locate shows a bare file name today.
   - **No critters:** housing files are left out of `critters.ts habitatOf`, whose name prefixes would give `barrent.roo` and any `tos*` house rats.
   - **No ambient life:** homes are left out of `ambientRooms.ts`.

### 9. The website (meridian-shards-website)

1. **The wiki** gets a Housing page and the inns' rooms, from the imported Kod once it exists: prices, templates and which cities. Nothing is written about it before it's built (that repo's rule on honest copy).
2. **The world map** marks plot doors.
   - Its door markers come from Kod `plExits` (`scripts/world-map/source.mjs`), and plot doors aren't in them.
   - So it either reads the `PlotMaintenance` table or gets a `plots` list in the region files.
3. **No live "which plots are free"** on the site.
   - It's static by rule and would need an endpoint run by the game.
   - The sign in the game is where to look.
   - Revisit only with a concrete need.

### 10. The order to build it

1. Our Kod and rooms in git, and the migration test (3). The C built-in (2).
2. The chest (4.5, 5.10), then guest lists, walk-in doors, same-account access and the new price on the three inns that have rooms, with expiry into the innkeeper's chest (4, 6).
3. Rooms at Tos and Cor Noth, then Jasper after its room is edited (4.1).
4. Plots: one template in Tos (it has a bank), its signs, the bank's properties list, selling back and foreclosure (5). The inactive time goes to 90 days with it.
5. Free decorating with the cap, in homes and inn rooms (7).
6. Barloque's bank, and Cor Noth's if it gets homes (5.2).
7. The city pass, city by city: which doors, prices and templates (5.2).
8. Our client's Homes tab, bank buttons and decorate mode (8.2). The commands work typed before that.
9. The website (9).

### 11. Not in this ADR

- **Guild halls** get their own updates, separately: no guests, decorating or foreclosure from here.

### 12. Left to settle when it's built

- **Which doors, prices and templates**, in the city pass (5.2).
- **Whether Jasper gets rooms**, once its room can be edited (4.1).
- **How a chest is emptied:** the Withdraw window or a spoken command (5.10).
- **Whether Cor Noth gets a bank, and so homes** (5.2).
- **Where Barloque's bank goes:** which dead door (5.2).

## Consequences

- **First C change:** blakserv gets its first C change, and the Linux image has to build it.
- **Inactive at 90 days, server-wide:** the change of `USER_INACTIVE_TIME` also moves when a player stops counting for guild creation and the factions.
- **The biggest Kod change yet**, which only becomes safe once our Kod is in git (3).
- **Saves grow** with every home's props, boxes and their contents. The caps (5.8, 6.1, 7.4) are what keep that in hand.
- **The commands are a protocol.** The spoken commands become a protocol between our client and our Kod. Changing a command means changing both, deployed together.
- **Rooms without fixed numbers:** rented rooms and homes have no fixed number in `rooms.json`. They show by file name in tools that rely on it until 8.2 names them, and in the remaster's parity notes.
- **Docs to update** as each part lands:
  - `AGENTS.md` and `docs/missing-features.md`
  - `docs/admin-console.md` (granting and freeing a plot, emptying a room)
  - the website's wiki
