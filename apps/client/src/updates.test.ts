import { describe, expect, it } from "vitest";
import { apkOf, detectPlatform, installerOf, parseRelease, webBundleOf } from "./updates.ts";

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

describe("the browser's download button", () => {
  const release = parseRelease({
    tag_name: "v0.7.0",
    assets: [
      { name: "Meridian-Shards-Setup-0.7.0.exe", browser_download_url: "https://x/exe", size: 480_000_000 },
      { name: "__uninstaller-nsis-meridian-shards.exe", browser_download_url: "https://x/uninstaller" },
      { name: "Meridian-Shards-0.7.0-mac.dmg", browser_download_url: "https://x/dmg" },
      { name: "Meridian-Shards-0.7.0-mac.zip", browser_download_url: "https://x/zip" },
      { name: "Meridian-Shards-0.7.0-x86_64.AppImage", browser_download_url: "https://x/appimage" },
      { name: "Meridian-Shards-0.7.0-amd64.deb", browser_download_url: "https://x/deb" },
      { name: "Meridian-Shards-0.7.0.apk", browser_download_url: "https://x/apk" },
    ],
  })!;

  it("tells the system from the user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0")).toBe("linux");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 16; Pixel 10a) AppleWebKit/537.36 Chrome/141.0 Mobile")).toBe("android");
    // No app for these: the download page instead
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15")).toBeNull();
    expect(detectPlatform("Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)")).toBe("linux");
    expect(detectPlatform("curl/8.0")).toBeNull();
  });

  it("picks the installer the download page puts first", () => {
    expect(installerOf(release, "windows")).toMatchObject({ browser_download_url: "https://x/exe", size: 480_000_000 });
    expect(installerOf(release, "mac")?.browser_download_url).toBe("https://x/dmg");
    expect(installerOf(release, "linux")?.browser_download_url).toBe("https://x/appimage");
    expect(installerOf(release, "android")?.browser_download_url).toBe("https://x/apk");
    expect(installerOf({ version: "0.7.0", files: [] }, "windows")).toBeNull();
  });
});
