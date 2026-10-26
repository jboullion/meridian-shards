// Ours (ADR 0024): the emoji the chat's picker offers, from emoji.json (apps/client/tables, served
// with the game's files; clientTables.ts loads it). Any emoji can be typed or pasted (the OS emoji
// keyboard, a phone's keyboard); these are the ones a fantasy game's chat reaches for.

/** emoji.json: the picker's emoji in groups (faces, hands, ...), in its order */
export interface EmojiTable {
  groups: { name: string; emoji: string[] }[];
}

let emoji: readonly string[] = [];

/** The picker's emoji, from the game's files (clientTables.ts) */
export function setEmojiTable(t: EmojiTable): void {
  emoji = t.groups.flatMap((g) => g.emoji);
}

/** The emoji the chat's picker offers, in its order */
export const chatEmoji = (): readonly string[] => emoji;
