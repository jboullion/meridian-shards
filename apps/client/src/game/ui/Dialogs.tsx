// Dialogs: buying from a shopkeeper (buy.c), the bank vault (buy.c withdrawal), offering
// items (offer.c: selling to a shopkeeper is an offer they answer with shillings),
// depositing, an amount prompt for number items, and the settings.

import { useEffect, useState, type ReactNode } from "react";
import type { ObjectInfo, ObjectRef } from "@shards/protocol";
import { isNumberItem, type GameSession, type OfferEvent, type TradeList } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import {
  ACTION_LABELS, ACTIONS, PRESETS, applyPreset, bindingLabel, updateSettings, type Action, type KeyBinding, type Settings,
} from "../settings.ts";
import { ObjIcon } from "./Sidebar.tsx";

function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={wide ? "dialog wide" : "dialog"} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Pick items with amounts for number items; shared by buying, withdrawing, offering and depositing. */
function ItemPicker({
  items, icons, rs, cost, chosen, setChosen,
}: {
  items: ObjectInfo[];
  icons: IconRenderer;
  rs: (id: number) => string;
  cost?: (o: ObjectInfo) => number | undefined;
  chosen: Map<number, number>;
  setChosen: (m: Map<number, number>) => void;
}) {
  const toggle = (o: ObjectInfo) => {
    const m = new Map(chosen);
    if (m.has(o.id)) m.delete(o.id);
    else m.set(o.id, isNumberItem(o.id) ? Math.max(1, o.amount) : 1);
    setChosen(m);
  };
  return (
    <ul className="item-picker">
      {items.map((o) => {
        const on = chosen.has(o.id);
        const c = cost?.(o);
        return (
          <li key={o.id} className={on ? "chosen" : ""} onClick={() => toggle(o)}>
            <input type="checkbox" checked={on} readOnly />
            <ObjIcon icons={icons} object={o} className="pick-icon" />
            <span className="pick-name">
              {isNumberItem(o.id) && o.amount ? `${o.amount} ` : ""}
              {rs(o.nameRes)}
            </span>
            {c !== undefined && <span className="pick-cost">{c}</span>}
            {on && isNumberItem(o.id) && (
              <input
                type="number"
                className="pick-amount"
                min={1}
                max={o.amount || undefined}
                value={chosen.get(o.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setChosen(new Map(chosen).set(o.id, Math.max(1, Number(e.target.value) || 1)))}
              />
            )}
          </li>
        );
      })}
      {items.length === 0 && <li className="muted">Nothing.</li>}
    </ul>
  );
}

const refs = (chosen: Map<number, number>): ObjectRef[] =>
  [...chosen].map(([id, amount]) => (isNumberItem(id) ? { id, amount } : { id }));

/** buy.c BuyDialogProc / WithdrawalDialogProc. */
export function TradeDialog({
  list, session, icons, onClose,
}: {
  list: TradeList;
  session: GameSession;
  icons: IconRenderer;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(new Map<number, number>());
  const rs = (id: number) => session.resource(id) ?? "";
  const costOf = new Map(list.items.map((i) => [i.object.id, i.cost]));
  const buying = list.kind === "buy";
  const total = [...chosen].reduce((sum, [id, n]) => sum + (costOf.get(id) ?? 0) * (isNumberItem(id) ? n : 1), 0);
  const ok = () => {
    if (!chosen.size) return;
    if (buying) session.buyItems(list.seller.id, refs(chosen));
    else session.withdrawItems(list.seller.id, refs(chosen));
    onClose();
  };
  return (
    <Dialog title={`${buying ? "Buy from" : "Withdraw from"} ${rs(list.seller.nameRes)}`} onClose={onClose}>
      <ItemPicker
        items={list.items.map((i) => i.object)}
        icons={icons}
        rs={rs}
        cost={buying ? (o) => costOf.get(o.id) : undefined}
        chosen={chosen}
        setChosen={setChosen}
      />
      {buying && <p className="total">Total cost: {total} shillings</p>}
      <div className="buttons">
        <button onClick={ok} disabled={!chosen.size}>
          {buying ? "Buy" : "Withdraw"}
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

/** Choose inventory items to offer (sell) or deposit. */
export function GiveDialog({
  kind, target, session, icons, onClose,
}: {
  kind: "offer" | "deposit";
  target: { id: number; name: string };
  session: GameSession;
  icons: IconRenderer;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(new Map<number, number>());
  const rs = (id: number) => session.resource(id) ?? "";
  const items = [...session.world.inventory.values()].filter((o) => !session.world.inUse.has(o.id));
  const ok = () => {
    if (!chosen.size) return;
    if (kind === "offer") session.offerItems(target.id, refs(chosen));
    else session.depositItems(target.id, refs(chosen));
    onClose();
  };
  return (
    <Dialog title={`${kind === "offer" ? "Offer to" : "Deposit with"} ${target.name}`} onClose={onClose}>
      <ItemPicker items={items} icons={icons} rs={rs} chosen={chosen} setChosen={setChosen} />
      <div className="buttons">
        <button onClick={ok} disabled={!chosen.size}>
          {kind === "offer" ? "Offer" : "Deposit"}
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

/**
 * offer.c's two dialogs. Ours (Send Offer): what we offered, and the other side's
 * counteroffer to accept. Theirs (Receive Offer): what someone offers us.
 */
export function OfferDialog({
  state, session, icons, onClose,
}: {
  state: { mine: ObjectInfo[]; theirs: ObjectInfo[] | null; from: ObjectInfo | null };
  session: GameSession;
  icons: IconRenderer;
  onClose: () => void;
}) {
  const rs = (id: number) => session.resource(id) ?? "";
  const list = (items: ObjectInfo[]) => (
    <ul className="item-picker readonly">
      {items.map((o) => (
        <li key={o.id}>
          <ObjIcon icons={icons} object={o} className="pick-icon" />
          <span className="pick-name">
            {isNumberItem(o.id) ? `${o.amount} ` : ""}
            {rs(o.nameRes)}
          </span>
        </li>
      ))}
      {items.length === 0 && <li className="muted">Nothing.</li>}
    </ul>
  );
  const cancel = () => {
    session.cancelOffer();
    onClose();
  };
  const accept = () => {
    session.acceptOffer();
    onClose();
  };
  if (state.from) {
    return (
      <Dialog title={`${rs(state.from.nameRes)} offers you`} onClose={cancel}>
        {list(state.theirs ?? [])}
        <div className="buttons">
          <button onClick={accept}>Accept</button>
          <button onClick={cancel}>Decline</button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title="Your offer" onClose={cancel}>
      {list(state.mine)}
      <h4>In return</h4>
      {state.theirs ? list(state.theirs) : <p className="muted">Waiting for an answer…</p>}
      <div className="buttons">
        <button onClick={accept} disabled={!state.theirs}>
          Accept
        </button>
        <button onClick={cancel}>Cancel</button>
      </div>
    </Dialog>
  );
}

/** Follows the offer exchange from the session's events. */
export function reduceOffer(
  prev: { mine: ObjectInfo[]; theirs: ObjectInfo[] | null; from: ObjectInfo | null } | null,
  e: OfferEvent,
): { mine: ObjectInfo[]; theirs: ObjectInfo[] | null; from: ObjectInfo | null } | null {
  switch (e.type) {
    case "offered":
      return { mine: e.items, theirs: null, from: null };
    case "counteroffer":
      return prev ? { ...prev, theirs: e.items } : { mine: [], theirs: e.items, from: null };
    case "received":
      return prev ? prev : { mine: [], theirs: e.items, from: e.offerer };
    case "canceled":
      return null;
  }
}

/** inventry.c: how many of a number item (dropping part of a stack). */
export function AmountDialog({
  object, verb, session, onDone, onClose,
}: {
  object: ObjectInfo;
  verb: string;
  session: GameSession;
  onDone: (amount: number) => void;
  onClose: () => void;
}) {
  const [n, setN] = useState(object.amount);
  return (
    <Dialog title={`${verb} how many ${session.resource(object.nameRes) ?? ""}?`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDone(Math.max(1, Math.min(object.amount, n)));
        }}
      >
        <input autoFocus type="number" min={1} max={object.amount} value={n} onChange={(e) => setN(Number(e.target.value) || 1)} />
        <div className="buttons">
          <button type="submit">{verb}</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SettingsDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [listening, setListening] = useState<{ action: Action; index: number } | null>(null);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Alt") return;
      if (e.key !== "Escape") {
        const b: KeyBinding = e.altKey ? { code: e.code, alt: true } : { code: e.code };
        const list = [...settings.keys[listening.action]];
        list.splice(listening.index, 1, b);
        updateSettings({ keys: { ...settings.keys, [listening.action]: list } });
      }
      setListening(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, settings]);

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const remove = (a: Action, i: number) =>
    set({ keys: { ...settings.keys, [a]: settings.keys[a].filter((_, j) => j !== i) } });

  return (
    <Dialog title="Settings" onClose={() => !listening && onClose()} wide>
      <div className="settings">
        <section>
          <h4>Sound</h4>
          <label className="check">
            <input type="checkbox" checked={settings.music} onChange={(e) => set({ music: e.target.checked })} /> Music
          </label>
          <label className="range">
            Music volume
            <input type="range" min={0} max={100} value={settings.musicVolume} onChange={(e) => set({ musicVolume: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.sound} onChange={(e) => set({ sound: e.target.checked })} /> Sound effects
          </label>
          <label className="range">
            Sound volume
            <input type="range" min={0} max={100} value={settings.soundVolume} onChange={(e) => set({ soundVolume: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.loopSounds} onChange={(e) => set({ loopSounds: e.target.checked })} /> Looping
            sounds (ambience)
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.randomSounds} onChange={(e) => set({ randomSounds: e.target.checked })} /> Random
            sounds (birds, waves)
          </label>
          <h4>Mouse</h4>
          <label className="range">
            Mouselook speed
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={settings.mouseSpeed}
              onChange={(e) => set({ mouseSpeed: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.invertMouse} onChange={(e) => set({ invertMouse: e.target.checked })} /> Invert
            mouse up/down
          </label>
        </section>
        <section>
          <h4>Keys</h4>
          <div className="preset">
            <button className={settings.preset === "modern" ? "active" : ""} onClick={() => applyPreset("modern")}>
              Modern (WASD)
            </button>
            <button className={settings.preset === "original" ? "active" : ""} onClick={() => applyPreset("original")}>
              Original
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.typeToChat} onChange={(e) => set({ typeToChat: e.target.checked })} /> Typing a
            letter starts a chat line
          </label>
          <table className="keys">
            <tbody>
              {ACTIONS.map((a) => (
                <tr key={a}>
                  <td>{ACTION_LABELS[a]}</td>
                  <td>
                    {settings.keys[a].map((b, i) => (
                      <span key={i} className="key">
                        <button onClick={() => setListening({ action: a, index: i })}>
                          {listening?.action === a && listening.index === i ? "press a key…" : bindingLabel(b)}
                        </button>
                        <button className="x" title="Remove" onClick={() => remove(a, i)}>
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      className="add"
                      title="Add a key"
                      onClick={() => setListening({ action: a, index: settings.keys[a].length })}
                    >
                      {listening?.action === a && listening.index === settings.keys[a].length ? "press a key…" : "+"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="link" onClick={() => set({ keys: PRESETS[settings.preset] })}>
            Reset keys to the {settings.preset} preset
          </button>
        </section>
      </div>
      <div className="buttons">
        <button onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
