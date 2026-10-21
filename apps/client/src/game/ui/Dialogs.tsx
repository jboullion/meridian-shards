// Dialogs: buying from a shopkeeper (buy.c), the bank vault (buy.c withdrawal), offering
// items (offer.c: selling to a shopkeeper is an offer they answer with shillings),
// depositing, and an amount prompt for number items (the options windows are in
// OptionsDialogs.tsx). Drawn with the Meridian
// dialog kit; item lists are the client's owner-drawn lists (white on black, the chosen rows
// black on white).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { UC, objId, type ObjectInfo, type ObjectRef } from "@shards/protocol";
import { isNumberItem, type GameSession, type OfferEvent, type TradeList, type TravelPlace } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { Button, ListBox, TextField, Window } from "./kit.tsx";
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
  items, icons, nameOf, cost, chosen, setChosen,
}: {
  items: ObjectInfo[];
  icons: IconRenderer;
  /** An item's name (ours: a revealed magic item's full name, session.itemName) */
  nameOf: (o: ObjectInfo) => string;
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
                {nameOf(o)}
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
  list, session, icons, onClose, onSell,
}: {
  list: TradeList;
  session: GameSession;
  icons: IconRenderer;
  onClose: () => void;
  /** Ours: a shopkeeper that also takes things shows Sell, which swaps this window for the offer window */
  onSell?: () => void;
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
        nameOf={(o) => session.itemName(o)}
        cost={buying ? (o) => costOf.get(o.id) : undefined}
        chosen={chosen}
        setChosen={setChosen}
      />
      {buying && <p className="total">Total cost: {total} shillings</p>}
      <div className="mk-buttons">
        <Button isDefault onClick={ok} disabled={!chosen.size}>
          {buying ? "Buy" : "Withdraw"}
        </Button>
        {buying && onSell && <Button onClick={onSell}>Sell</Button>}
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}

/** Ours: a fast travel portal's places (UC_TRAVEL_LIST, docs/adr/0011-fast-travel.md 6) */
const TRAVEL_REACH = 3 * 1024;

/**
 * Ours (docs/adr/0011-fast-travel.md 6): where a travel portal can take us. Travel sends
 * "travel <id>" (UC_SHARDS), which the server checks again. Greyed while the PvP lockout runs
 * (`pvpUntil`, ms); it closes when we walk away from the portal.
 */
export function TravelDialog({
  here, places, pvpUntil, session, onClose,
}: {
  here: number;
  places: TravelPlace[];
  pvpUntil: number;
  session: GameSession;
  onClose: () => void;
}) {
  // in alphabetical order (the server sends them in its table's)
  const others = places.filter((p) => p.id !== here).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const [picked, setPicked] = useState<number | null>(others[0]?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [from] = useState(() => {
    const self = session.world.self;
    return self ? { x: self.x, y: self.y } : null;
  });
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
      const self = session.world.self;
      if (from && self && Math.hypot(self.x - from.x, self.y - from.y) > TRAVEL_REACH) close.current();
    }, 250);
    return () => window.clearInterval(t);
  }, [session, from]);
  const wait = Math.ceil((pvpUntil - now) / 1000);
  const go = (id: number | null) => {
    if (id === null || wait > 0) return;
    session.shardsCommand(`travel ${id}`);
    onClose();
  };
  const name = places.find((p) => p.id === here)?.name ?? "this portal";
  return (
    <Dialog title={`The portal of ${name}`} onClose={onClose}>
      {others.length ? (
        <ListBox items={others.map((p) => ({ key: p.id, label: p.name }))} selected={picked} onSelect={setPicked} onActivate={go} autoFocus label="Travel to" />
      ) : (
        <p>You know no other portal yet. Touch one in another town to attune to it.</p>
      )}
      {wait > 0 && <p className="travel-pvp">You fought another player too recently: {wait} seconds left.</p>}
      <div className="mk-buttons">
        <Button isDefault onClick={() => go(picked)} disabled={picked === null || wait > 0}>
          Travel
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}

/** Choose inventory items to offer (sell) or deposit. */
export function GiveDialog({
  kind, target, session, icons, onClose, onOffered, sellable, asking,
}: {
  kind: "offer" | "deposit";
  target: { id: number; name: string };
  session: GameSession;
  icons: IconRenderer;
  onClose: () => void;
  /** Ours: what a buyer would take from us and pay for it, by object (UC_SELLABLE); without it, everything we carry is listed */
  sellable?: ReadonlyMap<number, number>;
  /** Ours: still waiting for the buyer's list */
  asking?: boolean;
  /** Ours: an offer went out, so the caller can say so when nobody answers it (the server only says why in the chat) */
  onOffered?: () => void;
}) {
  const [chosen, setChosen] = useState(new Map<number, number>());
  const items = [...session.world.inventory.values()].filter(
    (o) => !session.world.inUse.has(o.id) && (!sellable || sellable.has(objId(o.id))),
  );
  const ok = () => {
    if (!chosen.size) return;
    if (kind === "offer") {
      session.offerItems(target.id, refs(chosen));
      onOffered?.();
    } else session.depositItems(target.id, refs(chosen));
    onClose();
  };
  return (
    <Dialog title={`${kind === "offer" ? "Offer to" : "Deposit with"} ${target.name}`} onClose={onClose}>
      {asking && <p className="muted">Asking {target.name || "them"} what they buy…</p>}
      {sellable && (
        <p className="muted">
          {items.length ? `${target.name || "They"} buys these:` : `${target.name || "They"} doesn't want anything you're carrying.`}
        </p>
      )}
      {!asking && (sellable ? items.length > 0 : true) && (
        <ItemPicker
          items={items}
          icons={icons}
          nameOf={(o) => session.itemName(o)}
          cost={sellable ? (o) => sellable.get(objId(o.id)) || undefined : undefined}
          chosen={chosen}
          setChosen={setChosen}
        />
      )}
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
 * Where an offer stands (offer.c). We offered (`from` null): `mine` went out, `theirs` is
 * their counteroffer once it comes. They offered (`from` set): `theirs` is what they
 * offer, `mine` our counteroffer once the server echoes it (BP_COUNTEROFFERED).
 */
export interface OfferState {
  mine: ObjectInfo[];
  theirs: ObjectInfo[] | null;
  from: ObjectInfo | null;
}

/**
 * offer.c's two dialogs. Ours (SendOfferDialogProc): what we offered, and the other
 * side's counteroffer to accept. Theirs (RcvOfferDialogProc, IDD_OFFERRECEIVE): what
 * someone offers us; we answer with a counteroffer ("Set items..." or "Offer nothing"),
 * and only they can then accept. Double clicking an item looks at it.
 */
export function OfferDialog({
  state, session, icons, onLook, onClose,
}: {
  state: OfferState;
  session: GameSession;
  icons: IconRenderer;
  onLook: (id: number) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState(new Map<number, number>());
  const [answered, setAnswered] = useState(false);
  const rs = (id: number) => session.resource(id) ?? "";
  const list = (items: ObjectInfo[]) => (
    <span className="mk-edit list item-frame">
      <ul className="mk-list item-picker readonly">
        {items.map((o) => (
          <li key={o.id} onDoubleClick={() => onLook(o.id)}>
            <ObjIcon icons={icons} object={o} className="pick-icon" />
            <span className="pick-name">
              {isNumberItem(o.id) ? `${o.amount} ` : ""}
              {session.itemName(o)}
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
  // offer.c IDC_SETITEMS falls through to IDOK: send the counteroffer, then wait
  const answer = (items: ObjectRef[]) => {
    session.counteroffer(items);
    setPicking(false);
    setAnswered(true);
  };
  if (state.from && picking) {
    // offer.c IDC_SETITEMS: UserInventoryList(IDS_OFFERITEMS)
    const items = [...session.world.inventory.values()].filter((o) => !session.world.inUse.has(o.id));
    return (
      <Dialog title="Offer items" onClose={() => setPicking(false)}>
        <ItemPicker items={items} icons={icons} nameOf={(o) => session.itemName(o)} chosen={chosen} setChosen={setChosen} />
        <div className="mk-buttons">
          <Button isDefault onClick={() => answer(refs(chosen))} disabled={!chosen.size}>
            OK
          </Button>
          <Button onClick={() => setPicking(false)}>Cancel</Button>
        </div>
      </Dialog>
    );
  }
  if (state.from) {
    return (
      <Dialog title={`Offer from ${rs(state.from.nameRes)}`} onClose={cancel} wide>
        <div className="offer-columns">
          <div>
            <h4 className="dialog-heading">Receive</h4>
            {list(state.theirs ?? [])}
          </div>
          <div>
            <h4 className="dialog-heading">Send</h4>
            {list(state.mine)}
          </div>
        </div>
        <p className="muted">{answered ? "Waiting for response..." : "Select Set items to respond to offer."}</p>
        <div className="mk-buttons">
          <Button isDefault onClick={() => setPicking(true)} disabled={answered}>
            Set items...
          </Button>
          <Button onClick={() => answer([])} disabled={answered}>
            Offer nothing
          </Button>
          <Button onClick={cancel}>Cancel</Button>
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
export function reduceOffer(prev: OfferState | null, e: OfferEvent): OfferState | null {
  switch (e.type) {
    case "offered":
      return { mine: e.items, theirs: null, from: null };
    case "counteroffer":
      return prev ? { ...prev, theirs: e.items } : { mine: [], theirs: e.items, from: null };
    case "received":
      return prev ? prev : { mine: [], theirs: e.items, from: e.offerer };
    case "counteroffered":
      // offer.c Counteroffered: only shown while the Receive Offer dialog is up
      return prev?.from ? { ...prev, mine: e.items } : prev;
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

/** The most an item can be appraised for (shards-server util/shardsabilities.kod APPRAISE_MAX, as the Appraise spell allowed) */
export const APPRAISE_MAX = 130_000_000;

/** Ours: the Appraise button's picture, a pair of scales, in the text's colour */
export function AppraiseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v17M7 20h10M5 7h14M12 5l-1 2h2z" />
      <path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z" />
    </svg>
  );
}

/**
 * Ours (docs/adr/0016-abilities.md): Appraise, from a valuable item's description. The price it
 * sells for in the citizen's market (its current one filled in), or Clear to take it off; the
 * server checks the rest. A listing lasts 30 days, then the item goes back to the vault.
 */
export function AppraiseDialog({
  name, price: current, onAppraise, onClear, onClose,
}: {
  name: string;
  /** Its price now, 0 for none */
  price: number;
  onAppraise: (price: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(current ? String(current) : "");
  const n = Number.parseInt(price, 10) || 0;
  const ok = n >= 1 && n <= APPRAISE_MAX;
  return (
    // Over the Modern character window, whose inventory it's opened from (as the description is)
    <div className="mk-modal">
      <Window title={`Appraise ${name}`} onClose={onClose} className="appraise-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onAppraise(n);
          }}
        >
          <p className="appraise-note">
            The price it sells for in the citizen's market, in shillings. Offer it to Veydran Goldleaf in Barloque to list it; unsold after 30 days, it goes
            back to your vault.
          </p>
          <TextField className="amount-field" autoFocus value={price} onChange={(v) => setPrice(v.replace(/\D/g, ""))} maxLength={9} placeholder="1 to 130,000,000" />
          <div className="mk-buttons">
            <Button type="submit" isDefault disabled={!ok}>
              Appraise
            </Button>
            <Button onClick={onClear} title="Take the appraisal off" disabled={!current}>
              Clear
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </Window>
    </div>
  );
}

/**
 * merintr.rc IDD_SUICIDE (command.c CommandSuicide): the account's password, checked here,
 * before UC_SUICIDE starts the character over.
 */
export function SuicideDialog({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const [password, setPassword] = useState("");
  return (
    <Dialog title="Meridian Character Suicide" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // SuicideVerifyDialogProc: a wrong password just closes the dialog
          if (session.passwordMatches(password)) session.userCommand(UC.SUICIDE);
          onClose();
        }}
      >
        <p>
          Performing a suicide will destroy your character, and will create a new character for you to start over. You are responsible for your own
          choice to begin the game again.
        </p>
        <fieldset className="mk-group">
          <legend>Verification</legend>
          <label className="form-row">
            To verify that you wish to do this, enter your current account password here.
            <TextField type="password" autoFocus value={password} onChange={setPassword} />
          </label>
        </fieldset>
        <div className="mk-buttons">
          <Button type="submit" isDefault>
            Suicide
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** maindlg.c MINPASSWORD */
const MIN_PASSWORD = 6;

/** client.rc IDD_PASSWORD (maindlg.c PasswordDialogProc): the old password and the new one twice. */
export function PasswordDialog({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const [old, setOld] = useState("");
  const [new1, setNew1] = useState("");
  const [new2, setNew2] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog title="Change Password" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (new1 !== new2) return setError("You must type your new password twice identically.");
          if (new1.length < MIN_PASSWORD) return setError(`Your new password must be at least ${MIN_PASSWORD} characters long.`);
          session.changePassword(old, new1);
          onClose();
        }}
      >
        <p>
          It is important to protect your Meridian password. Changing your password regularly is recommended so that other people cannot ruin your game by
          using your character.
        </p>
        <fieldset className="mk-group">
          <legend>Your Password</legend>
          <label className="form-row">
            Old password: <TextField type="password" autoFocus value={old} onChange={setOld} />
          </label>
          <label className="form-row">
            New password: <TextField type="password" value={new1} onChange={setNew1} />
          </label>
          <label className="form-row">
            Verify new password: <TextField type="password" value={new2} onChange={setNew2} />
          </label>
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <div className="mk-buttons">
          <Button type="submit" isDefault>
            Change
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
        <p className="muted">
          Be careful not to give other players your account name or password; you are responsible for the actions of whoever uses your account.
        </p>
      </form>
    </Dialog>
  );
}
