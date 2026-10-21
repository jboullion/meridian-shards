// Ours (the magic item revamp): an elder's or a smith's window. What of ours they can work on
// (worn first), each with its price; Reveal sends `reveal <slot>`, Repair `repair <slot>`, and the
// server answers with a new menu (UC_ITEM_SERVICE, shards-server util/itemservicebook.kod).
// A smith's window has a Shop button for their wares, as a tailor's does.

import { useState } from "react";
import { revealCommand, repairCommand, type GameSession, type ItemServiceEvent } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { Button, Window } from "./kit.tsx";
import { ObjIcon } from "./Sidebar.tsx";

export function ItemServiceDialog({
  name, menu, session, icons, onCommand, onShop, onClose,
}: {
  /** The elder's or smith's name */
  name: string;
  menu: ItemServiceEvent;
  session: GameSession;
  icons: IconRenderer;
  onCommand: (line: string) => void;
  /** A smith's wares; an elder has none */
  onShop?: () => void;
  onClose: () => void;
}) {
  const [slot, setSlot] = useState<number | null>(menu.items[0]?.slot ?? null);
  const reveal = menu.type === "reveal";
  const item = menu.items.find((i) => i.slot === slot) ?? menu.items[0] ?? null;
  const worn = (id: number) => session.world.inUse.has(id);
  const condition = (hits: number, maxHits: number) => (hits <= 0 ? "broken" : `${hits}/${maxHits}`);

  return (
    <Window title={`${name}, ${reveal ? "elder" : "smith"}`} onClose={onClose} className="game-dialog wide item-service-dialog">
      {menu.items.length === 0 ? (
        <p className="panel-note">
          {reveal
            ? `You carry nothing with hidden magic for ${name} to reveal.`
            : `Nothing you carry or wear needs ${name}'s hammer. Weapons and armour wear down in battle; bring them here when they do.`}
        </p>
      ) : (
        <>
          <ul className="tailor-items item-service-items">
            {menu.items.map((i) => {
              const o = session.world.inventory.get(i.id);
              return (
                <li key={i.slot}>
                  <button type="button" className={i.slot === item?.slot ? "selected" : ""} onClick={() => setSlot(i.slot)}>
                    <ObjIcon icons={icons} object={o ?? null} />
                    <span>
                      {o ? session.itemName(o) : "?"}
                      {worn(i.id) ? " (worn)" : ""}
                      {!reveal && <em> {condition(i.hits, i.maxHits)}</em>}
                    </span>
                    <span className="item-service-price">{i.price.toLocaleString()} shillings</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="panel-note">
            {reveal
              ? `${name} reveals every hidden property of a magic item for ${item?.price.toLocaleString() ?? ""} shillings.`
              : `${name} makes a weapon or piece of armour as good as new, broken or not. The more worn it is, the more it costs.`}
          </p>
        </>
      )}
      <div className="mk-buttons">
        <Button isDefault disabled={!item} onClick={() => item && onCommand(reveal ? revealCommand(item.slot) : repairCommand(item.slot))}>
          {reveal ? "Reveal" : "Repair"}
        </Button>
        {onShop && <Button onClick={onShop}>Shop</Button>}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Window>
  );
}
