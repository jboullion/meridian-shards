import { describe, expect, it } from "vitest";
import { rememberStartCity, takeStartCity } from "./startCity.ts";

/** A Storage stand-in */
function memory(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("the creator's starting city", () => {
  it("is kept per server and character, and taken once", () => {
    const s = memory();
    rememberStartCity(s, "ws://a", "Rodric", "marion");
    expect(takeStartCity(s, "ws://b", "Rodric")).toBeNull();
    expect(takeStartCity(s, "ws://a", "rodric")).toBe("marion");
    expect(takeStartCity(s, "ws://a", "Rodric")).toBeNull();
  });

  it("forgets a cleared choice, and ignores a city it doesn't know", () => {
    const s = memory();
    rememberStartCity(s, "ws://a", "Rodric", "tos");
    rememberStartCity(s, "ws://a", "Rodric", null);
    expect(takeStartCity(s, "ws://a", "Rodric")).toBeNull();
    s.setItem("shards.startCity.ws://a.rodric", "atlantis");
    expect(takeStartCity(s, "ws://a", "Rodric")).toBeNull();
  });
});
