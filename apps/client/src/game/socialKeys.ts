// Ours (docs/adr/0005-friends.md 2.1): each character's key pair for the friends relay, one per
// character per server, made on first use. The private key is non-extractable, so it's kept in
// IndexedDB (localStorage can't hold a CryptoKey). Losing it (cleared site data, another device)
// means pairing friends again. Without IndexedDB, a key for this session only.

import { generateIdentity } from "@shards/world";

const DB = "shards-social";
const STORE = "keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB"));
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("indexedDB"));
  });
}

const isPair = (v: unknown): v is CryptoKeyPair =>
  !!v && typeof v === "object" && (v as CryptoKeyPair).privateKey instanceof CryptoKey && (v as CryptoKeyPair).publicKey instanceof CryptoKey;

/** This character's key pair on this server, made and kept the first time */
export async function characterKeys(server: string, character: string): Promise<CryptoKeyPair> {
  const id = `${server}|${character.toLowerCase()}`;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return generateIdentity();
  }
  try {
    const found: unknown = await request(db.transaction(STORE).objectStore(STORE).get(id));
    if (isPair(found)) return found;
    const keys = await generateIdentity();
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(keys, id));
    return keys;
  } catch {
    return generateIdentity();
  } finally {
    db.close();
  }
}
