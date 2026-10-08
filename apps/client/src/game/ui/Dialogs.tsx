// Dialogs: buying from a shopkeeper (buy.c), the bank vault (buy.c withdrawal), offering
// items (offer.c: selling to a shopkeeper is an offer they answer with shillings),
// depositing, and an amount prompt for number items (the options windows are in
// OptionsDialogs.tsx). Drawn with the Meridian
// dialog kit; item lists are the client's owner-drawn lists (white on black, the chosen rows
// black on white).

import { useState, type ReactNode } from "react";
import type { ObjectInfo, ObjectRef } from "@shards/protocol";
import { isNumberItem, type GameSession, type OfferEvent, type TradeList } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { Button, TextField, Window } from "./kit.tsx";
import { ObjIcon } from "./Sidebar.tsx";

function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <Window title={title} onClose={onClose} className={wide ? "game-dialog wide" : "game-dialog"}>
      {children}
    </Window>
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
    <span className="mk-edit list item-frame">
      <ul className="mk-list item-picker">
        {items.map((o) => {
          const on = chosen.has(o.id);
          const c = cost?.(o);
          return (
            <li key={o.id} className={on ? "selected" : ""} onClick={() => toggle(o)}>
              <input type="checkbox" checked={on} readOnly tabIndex={-1} />
              <ObjIcon icons={icons} object={o} className="pick-icon" />
              <span className="pick-name">
                {isNumberItem(o.id) && o.amount ? `${o.amount} ` : ""}
                {rs(o.nameRes)}
              </span>
              {c !== undefined && <span className="pick-cost">{c}</span>}
              {on && isNumberItem(o.id) && (
                <span onClick={(e) => e.stopPropagation()}>
                  <TextField
                    className="pick-amount"
                    type="number"
                    min={1}
                    max={o.amount || undefined}
                    value={chosen.get(o.id) ?? 1}
                    onChange={(v) => setChosen(new Map(chosen).set(o.id, Math.max(1, Number(v) || 1)))}
                  />
                </span>
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="muted">Nothing.</li>}
      </ul>
    </span>
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
      <div className="mk-buttons">
        <Button isDefault onClick={ok} disabled={!chosen.size}>
          {buying ? "Buy" : "Withdraw"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
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
      <div className="mk-buttons">
        <Button isDefault onClick={ok} disabled={!chosen.size}>
          {kind === "offer" ? "Offer" : "Deposit"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
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
    <span className="mk-edit list item-frame">
      <ul className="mk-list item-picker readonly">
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
    </span>
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
        <div className="mk-buttons">
          <Button isDefault onClick={accept}>
            Accept
          </Button>
          <Button onClick={cancel}>Decline</Button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title="Your offer" onClose={cancel}>
      {list(state.mine)}
      <h4 className="dialog-heading">In return</h4>
      {state.theirs ? list(state.theirs) : <p className="muted">Waiting for an answer…</p>}
      <div className="mk-buttons">
        <Button isDefault onClick={accept} disabled={!state.theirs}>
          Accept
        </Button>
        <Button onClick={cancel}>Cancel</Button>
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
        <TextField className="amount-field" autoFocus type="number" min={1} max={object.amount} value={n} onChange={(v) => setN(Number(v) || 1)} />
        <div className="mk-buttons">
          <Button type="submit" isDefault>
            {verb}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
