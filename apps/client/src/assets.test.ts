import { afterEach, describe, expect, test, vi } from "vitest";
import { AssetStore } from "./assets.ts";

interface Manifest {
  generated: string;
  rsbHash: string;
  files: Record<string, { size: number; hash: string }>;
}

/** A server whose manifest can change between requests; it records what was asked for */
function server(manifest: Manifest) {
  const s = { manifest, requests: [] as string[] };
  vi.stubGlobal("fetch", async (url: string) => {
    s.requests.push(url);
    return url.endsWith("manifest.json") ? new Response(JSON.stringify(s.manifest)) : new Response(new Uint8Array([1, 2, 3]));
  });
  return s;
}

afterEach(() => vi.unstubAllGlobals());

describe("AssetStore.refresh", () => {
  test("forgets only the files whose hash changed, and fetches them again by their new hash", async () => {
    const s = server({ generated: "1", rsbHash: "r", files: { "tos.roo": { size: 3, hash: "a" }, "raza.roo": { size: 3, hash: "b" } } });
    const assets = new AssetStore("/assets/");
    await assets.init();
    await assets.fetchBytes("tos.roo");
    await assets.fetchBytes("raza.roo");

    s.manifest = { ...s.manifest, generated: "2", files: { ...s.manifest.files, "tos.roo": { size: 3, hash: "c" } } };
    expect(await assets.refresh()).toEqual(["tos.roo"]);
    await assets.fetchBytes("tos.roo");
    await assets.fetchBytes("raza.roo");

    expect(s.requests.filter((u) => !u.endsWith("manifest.json"))).toEqual(["/assets/tos.roo?v=a", "/assets/raza.roo?v=b", "/assets/tos.roo?v=c"]);
  });
});
