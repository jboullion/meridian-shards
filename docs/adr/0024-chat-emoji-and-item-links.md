# ADR 0024: Emoji and item links in chat

- Status: built (2026-10-24). Tried in the browser client on the local server: emoji (typed and from the palette) and three item links went to the server and back intact; the byte check refused a 560-byte line. Not yet seen by a second player.
- Builds on: the chat window (`GameView.tsx`), the `~` style codes (`@shards/world` `text.ts`), the icon renderer (`icons.ts`, `ObjIcon`) and the magic item ring (`magicRing.ts`).

## Context

Players asked to use emoji and the game's own icons in chat (say, emote, yell, broadcast, tell, guild).

- **The server already passes chat bytes through.** blakserv copies a `BP_SAY_TO` or `BP_SAY_GROUP` string with `memcpy` (`parsecli.c`) and sends it back with `AddPacket` (`commcli.c`); nothing checks characters or converts encodings. Kod rejects (doesn't cut) a say longer than `MAX_CHAT_LEN`, 550 bytes (`user.kod` `ReceiveClient`, `blakston.khd`). Player text goes back out as the `%q` parameter of `BP_SAID` (`user_said_str = "%s says, \"%q~n\""` and the rest, `user.kod`).
- **Our client was the blocker.** Wire strings were Latin-1 both ways (`packages/protocol/src/bytes.ts`). `latin1ToBytes` kept only the low byte of each UTF-16 unit, so 😀 went out as `=` and a NUL.
- **The original Windows client** is an ANSI build: it shows UTF-8 as Windows-1252 (😀 as `ðŸ˜€`) and sends `?` for an emoji. The Unreal remaster reads strings as bytes too.

## Decisions

1. **Player speech goes as UTF-8.** `buildSay` and `buildSayGroup` encode their text with `utf8ToBytes`. Every other wire string stays byte-exact Latin-1: resources, names, the redbook token, the chess state.
2. **Player text is decoded as UTF-8 when it is valid UTF-8.** `formatServerMessage` passes each `%q` parameter through `decodePlayerText`. If the bytes aren't valid UTF-8 (the original client's Windows-1252, such as `é` as the single byte E9), it keeps the old one-byte-per-character reading. ASCII is the same either way. `%s` resources stay Latin-1.
3. **Only our clients matter** for how this looks (browser, desktop, Android). Players on the original client or the Unreal remaster see emoji as mojibake and links as their raw tokens. The user accepted this on 2026-10-24.
4. **Emoji:** any emoji can be typed, pasted or picked from the OS or phone emoji keyboard. A palette button at the end of the chat line (`ui/EmojiPicker.tsx`, list in `emoji.ts`) offers 81 that suit the game. The chat log and input put the colour emoji fonts (Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji) after Georgia.
5. **Item links:** Shift+click an item in the inventory (Classic sidebar or the Modern character window's bag) to put `[Full Name]` in the chat line at the caret. The line shows the item's inventory icon, with its colours and magic ring, then `[name]`. A link is only a picture and a name, not a live link to the item.
6. **The link token**, inside the said text: `{i:<file>:<translation>:<magic>|<name>}`. For example, `{i:longswrd:12:6b|Enormous Longsword of Siphoning}`.
   - `file` is the `.bgf` base name, lower case, `[A-Za-z0-9_-]`.
   - `translation` is the icon's colour translation, 0-255.
   - `magic` is the object flags' magic ring bits (`MAGIC_FLAGS_MASK`), shifted down 20, in hex.
   - `name` is at most 80 characters, without `{ } | ~ \``.
   - Tokens avoid `~` and `` ` `` because the say filter and the style codes treat them as codes. The input keeps a map from each `[Full Name]` to its token, and `expandChatLinks` swaps tokens in as the line is sent. Text that only looks like a link stays text.
   - `splitChatLinks` (`@shards/world` `chatLinks.ts`) runs after `parseMarkup` on every chat line and gives the link its own span, with `item` set, and the text `[name]`. Anything that joins span text (speech bubbles, the agent and headless tools) therefore reads `[name]`. A malformed token stays as text. A file missing from the assets shows the name without an icon.
7. **The byte budget:** the chat line still allows 500 characters. Before sending, `sayFilter` counts the line's UTF-8 bytes, with links expanded, and refuses one over 550 with a chat notice, since the server would drop it silently. An emoji is 4 bytes, and a link is about 20 bytes plus its name.

## Consequences

- **Links can be faked.** Anyone can type a token with any name and picture. This is cosmetic, as in other games' chat; validating links on the server would need Kod to check the sender's inventory.
- **The server needs no change.** It is unaware of links and UTF-8.
- **Other player text is not covered yet:** mail, guild MOTDs, recruiting notices, bios and object inscriptions still go as Latin-1. `utf8ToBytes` and `decodePlayerText` would extend to them.
- A Latin-1 message that happens to be valid UTF-8 (such as `Ã©` typed on the original client) would show decoded. This is unlikely in practice.
- Tests: `packages/world/test/chatLinks.test.ts` (UTF-8 both ways, `%q` decoding, tokens) and `apps/client/src/game/chatInput.test.ts` (bytes, expanding links, the caret, the say filter keeping emoji).
