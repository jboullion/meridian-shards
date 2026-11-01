import { describe, expect, it } from "vitest";
import { webAppManifest } from "../pwa/plugin.ts";

describe("the web app manifest (docs/adr/0032-installable-web-client.md)", () => {
  it("is scoped to the client's base, /play/ on our server", () => {
    const m = webAppManifest("/play/", (f) => `assets-client/${f}`);
    expect(m).toMatchObject({ id: "/play/", start_url: "/play/", scope: "/play/", display: "standalone", display_override: ["window-controls-overlay"] });
  });

  it("has the icons Chrome needs to install it, plain and maskable", () => {
    const icons = webAppManifest("/", (f) => `/src/icons/${f}`).icons as { src: string; sizes: string; purpose: string }[];
    for (const purpose of ["any", "maskable"])
      for (const sizes of ["192x192", "512x512"]) expect(icons.some((i) => i.purpose === purpose && i.sizes === sizes)).toBe(true);
    expect(icons[0].src).toBe("/src/icons/icon-192.png");
  });

  it("is relative, without an id, for a relative base (the itch.io build)", () => {
    const m = webAppManifest("./", (f) => f);
    expect(m.id).toBeUndefined();
    expect(m.scope).toBe("./");
  });
});
