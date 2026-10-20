// The agent's helpers on the maintenance port (docs/adr/0020-ai-playtester.md), local servers
// only: the admin dashboard's recipes (apps/client/src/admin/api.ts, Dashboard.tsx), run as
// maintenance commands so the agent's character stays an ordinary player.

import { maint, returnedObject } from "../maint/maintClient.ts";

/** Whether a gateway address is this machine: the maintenance port is only ever ours */
export const isLocal = (gateway: string): boolean => /^(wss?|https?):\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(gateway);

/** Who and where we are (play.ts context): object ids change at every save, so asked each time */
export interface Me {
  playerId: number;
  row: number;
  col: number;
}

const created = (out: string | undefined, what: string): number => {
  const id = /Created object (\d+)/.exec(out ?? "")?.[1];
  if (!id) throw new Error(`create object ${what}: ${(out ?? "").trim() || "no answer"}`);
  return Number(id);
};

export async function teleport(me: Me, rid: number): Promise<string> {
  const [out] = await maint(`send object ${me.playerId} TeleportTo RID int ${rid}`);
  return (out ?? "").trim();
}

/** An item into our inventory; a number item (shillings, reagents) as `amount` of them */
export async function giveItem(className: string, me: Me, amount: number): Promise<string> {
  let [out] = await maint(`create object ${className} number int ${Math.max(1, amount)}`);
  // Items that aren't number items refuse the number: make them one at a time
  if (!/Created object/.test(out ?? "")) [out] = await maint(`create object ${className}`);
  const id = created(out, className);
  await maint(`send object ${me.playerId} NewHold what object ${id}`);
  return `Made ${className} (object ${id}) and put it in your inventory.`;
}

/** Monsters of a class on the square east of us, in the room we're in (GetOwner's return line, never the player) */
export async function spawnBeside(className: string, me: Me, count: number): Promise<string> {
  const [owner] = await maint(`send object ${me.playerId} GetOwner`);
  const room = returnedObject(owner ?? "");
  if (room === null || room === me.playerId) throw new Error("Couldn't find the room we're in.");
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const [out] = await maint(`create object ${className}`);
    const id = created(out, className);
    await maint(
      `send object ${id} SetDontDispose`,
      `send object ${room} NewHold what object ${id} new_row int ${me.row} new_col int ${me.col + 1} fine_row int ${8 + ((i * 13) % 48)} fine_col int ${8 + ((i * 29) % 48)}`,
    );
    ids.push(id);
  }
  return `Made ${count} ${className} at row ${me.row}, col ${me.col + 1} (objects ${ids.join(", ")}).`;
}

/** The server's hour, for everyone */
export async function setHour(hour: number): Promise<string> {
  const [out] = await maint(`send object 0 SetHour iNum int ${hour}`);
  return (out ?? "").trim() || `The hour is ${hour}.`;
}
