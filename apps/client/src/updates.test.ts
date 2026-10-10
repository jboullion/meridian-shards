import { describe, expect, it } from "vitest";
import { apkOf, parseRelease, webBundleOf } from "./updates.ts";

const SHA = "ab".repeat(32);

const json = {
  tag_name: "v0.7.0",
  assets: [
    { name: "Meridian-Shards-0.7.0.apk", browser_download_url: "https://x/apk" },
    { name: "Meridian-Shards-web-0.7.0-shell2.zip", browser_download_url: "https://x/web", digest: `sha256:${SHA.toUpperCase()}` },
    { name: "Meridian-Shards-Setup-0.7.0.exe", browser_download_url: "https://x/exe" },
  ],
};

describe("android updates", () => {
  it("finds a release's page bundle, the shell it needs and its SHA-256", () => {
    const r = parseRelease(json)!;
    expect(r.version).toBe("0.7.0");
    expect(webBundleOf(r)).toEqual({ url: "https://x/web", shell: 2, sha256: SHA });
    expect(apkOf(r)?.browser_download_url).toBe("https://x/apk");
  });

  it("ignores a bundle for another version, and does without a digest", () => {
    expect(webBundleOf({ version: "0.7.1", files: json.assets })).toBeNull();
    const plain = { version: "0.7.0", files: [{ name: "Meridian-Shards-web-0.7.0-shell1.zip", browser_download_url: "https://x/w" }] };
    expect(webBundleOf(plain)).toEqual({ url: "https://x/w", shell: 1, sha256: "" });
  });

  it("isn't fooled by other JSON", () => {
    expect(parseRelease({ message: "Not Found" })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
});
