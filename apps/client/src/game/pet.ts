// Ours (docs/adr/0006-pets.md 1.1): each character's pet, kept per browser in localStorage
// (shards.pet.<game socket url>.<character>): its kind, colour and name. None at first.

import { readPetChoice, type PetChoice } from "@shards/world";

const key = (server: string, character: string) => `shards.pet.${server}.${character.toLowerCase()}`;

export function loadPet(storage: Pick<Storage, "getItem">, server: string, character: string): PetChoice | null {
  try {
    const raw = storage.getItem(key(server, character));
    return raw ? readPetChoice(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePet(storage: Pick<Storage, "setItem" | "removeItem">, server: string, character: string, pet: PetChoice | null): void {
  try {
    if (pet) storage.setItem(key(server, character), JSON.stringify(pet));
    else storage.removeItem(key(server, character));
  } catch {
    // Storage full or gone: kept for this session
  }
}
