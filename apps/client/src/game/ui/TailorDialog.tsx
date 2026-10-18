// Ours (docs/adr/0012-cosmetics.md 3): a tailor's window. What of ours they can dye (worn first),
// the dyes as swatches, the chosen thing drawn in the chosen dye, and the price. Dye sends
// `tailor dye <slot> <dye>`, Remove dye `tailor undye <slot>`; the server answers with a new
// menu (UC_COSMETICS, util/cosmeticsbook.kod SendTailorMenu). Shop opens the tailor's wares.

import { useEffect, useState } from "react";
import { DYE_BASE, dyeSwatchIndex, encodeDye } from "@shards/render";
import { DYE_RAMP, tailorDyeCommand, tailorUndyeCommand, type CosmeticsEvent, type GameSession } from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import type { IconRenderer } from "../icons.ts";
import { Button, Window } from "./kit.tsx";
import { ObjIcon } from "./Sidebar.tsx";

type TailorMenu = Extract<CosmeticsEvent, { type: "tailor" }>;

/** An item's look in a dye field, on the ramp its art dyes */
const dyedTranslation = (ramp: number, field: number) =>
  field ? DYE_BASE | (ramp === DYE_RAMP.TRIM ? encodeDye(0, field) : encodeDye(field)) : 0;

export function TailorDialog({
  name, menu, session, assets, icons, onCommand, onShop, onClose,
}: {
  /** The tailor's name */
  name: string;
  menu: TailorMenu;
  session: GameSession;
  assets: AssetStore;
  icons: IconRenderer;
  onCommand: (line: string) => void;
  onShop: () => void;
  onClose: () => void;
}) {
  const [rgb, setRgb] = useState<Uint8Array | null>(null);
  const [slot, setSlot] = useState<number | null>(menu.items[0]?.slot ?? null);
  const [field, setField] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void assets.palette().then((p) => live && setRgb(p.rgb));
    return () => {
      live = false;
    };
  }, [assets]);

  const rs = (id: number) => session.resource(id) ?? "";
  const item = menu.items.find((i) => i.slot === slot) ?? null;
  const info = item ? (session.world.inventory.get(item.id) ?? null) : null;
  const dyeName = (f: number) => menu.dyes.find((d) => d.field === f)?.name ?? "";
  const preview = info && item ? { ...info, translation: field ? dyedTranslation(item.ramp, field) : info.translation } : null;
  const swatch = (f: number) => {
    if (!rgb) return undefined;
    const i = dyeSwatchIndex(f);
    return `rgb(${rgb[i * 3]}, ${rgb[i * 3 + 1]}, ${rgb[i * 3 + 2]})`;
  };

  return (
    <Window title={`${name}, tailor`} onClose={onClose} className="game-dialog wide tailor-dialog">
      {menu.items.length === 0 ? (
        <p className="panel-note">You have nothing {name} can dye. Clothes, armour, helmets, shields and weapons can be dyed; wands, bows and disciple robes can't.</p>
      ) : (
        <div className="tailor-body">
          <ul className="tailor-items">
            {menu.items.map((i) => {
              const o = session.world.inventory.get(i.id);
              return (
                <li key={i.slot}>
                  <button type="button" className={i.slot === slot ? "selected" : ""} onClick={() => (setSlot(i.slot), setField(null))}>
                    <ObjIcon icons={icons} object={o ?? null} />
                    <span>
                      {o ? rs(o.nameRes) : "?"}
                      {i.worn ? " (worn)" : ""}
                      {i.field ? <em> {dyeName(i.field)}</em> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="tailor-side">
            <div className="tailor-preview">
              <ObjIcon icons={icons} object={preview} />
              <span>{field ? dyeName(field) : item?.field ? dyeName(item.field) : "Undyed"}</span>
            </div>
            <div className="tailor-swatches">
              {menu.dyes.map((d) => (
                <button
                  key={d.field}
                  type="button"
                  title={d.name}
                  aria-label={d.name}
                  className={d.field === field ? "selected" : ""}
                  style={{ background: swatch(d.field) }}
                  onClick={() => setField(d.field)}
                />
              ))}
            </div>
            <p className="panel-note">
              A dye is {menu.dyePrice} shillings; taking one off is {menu.undyePrice}.
            </p>
          </div>
        </div>
      )}
      <div className="mk-buttons">
        <Button isDefault disabled={!item || !field || field === item.field} onClick={() => item && field && onCommand(tailorDyeCommand(item.slot, field))}>
          Dye
        </Button>
        <Button disabled={!item?.field} onClick={() => item && onCommand(tailorUndyeCommand(item.slot))}>
          Remove dye
        </Button>
        <Button onClick={onShop}>Shop</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Window>
  );
}
