// The Android app's updates (ours, ADR 0003; host.ts androidBridge, the native side WebUpdates
// and ApkUpdates). A release on GitHub carries the APK and the page by itself, as
// Meridian-Shards-web-<version>-shell<n>.zip (tools/android/web-bundle.ts): the client build, for
// an app whose shell (apps/android/shell.json) is at least n. With a shell that new, an update is
// that zip (about 1 MB); otherwise the APK.

/** A file of a release, as GitHub's API lists it */
export interface ReleaseFile {
  name: string;
  browser_download_url: string;
  /** "sha256:<hex>", where GitHub gives it */
  digest?: string | null;
  /** Bytes */
  size?: number;
}

export interface Release {
  version: string;
  files: ReleaseFile[];
}

/** A release's page bundle: where it is, the shell it needs, its SHA-256 (hex) if GitHub gave one. */
export interface WebBundle {
  url: string;
  shell: number;
  sha256: string;
}

/** The page bundle of `release`, if it has one for its own version. */
export function webBundleOf(release: Release): WebBundle | null {
  for (const f of release.files) {
    const m = /^Meridian-Shards-web-(\d+\.\d+\.\d+)-shell(\d+)\.zip$/.exec(f.name);
    if (!m || m[1] !== release.version) continue;
    const sha = /^sha256:([0-9a-f]{64})$/i.exec(f.digest ?? "")?.[1] ?? "";
    return { url: f.browser_download_url, shell: Number(m[2]), sha256: sha.toLowerCase() };
  }
  return null;
}

/** The release's APK, if it has one. */
export function apkOf(release: Release): ReleaseFile | null {
  return release.files.find((f) => f.name.endsWith(".apk")) ?? null;
}

/** GitHub's latest-release JSON as a Release, or null when it isn't one. */
export function parseRelease(json: unknown): Release | null {
  const r = json as { tag_name?: unknown; assets?: unknown };
  if (typeof r?.tag_name !== "string" || !Array.isArray(r.assets)) return null;
  const files = (r.assets as ReleaseFile[]).filter((f) => typeof f?.name === "string" && typeof f?.browser_download_url === "string");
  return { version: r.tag_name.replace(/^v/, ""), files };
}

// ---- the browser's Download button (ours, TitleBar.tsx): the same rules as the website's
// download page (meridian-shards-website app/lib/releases.ts), so both offer the same file

export type Platform = "windows" | "mac" | "linux" | "android";

/** The visitor's system from the user agent; null where there's no app (iPhone, iPad) or no telling. Android first: its browsers say Linux too. */
export function detectPlatform(userAgent: string): Platform | null {
  if (/Android/.test(userAgent)) return "android";
  if (/Windows/.test(userAgent)) return "windows";
  if (/iPhone|iPad|iPod/.test(userAgent)) return null;
  if (/Mac OS X|Macintosh/.test(userAgent)) return "mac";
  if (/Linux|X11/.test(userAgent)) return "linux";
  return null;
}

/** Each system's file (apps/desktop/electron-builder.yml artifactName; the APK from CI): the website's first choice for it */
const INSTALLERS: Record<Platform, RegExp> = {
  windows: /\.exe$/,
  mac: /-mac\.dmg$/,
  linux: /\.AppImage$/,
  android: /\.apk$/,
};

/** The release's installer for `platform`, if it has one. */
export function installerOf(release: Release, platform: Platform): ReleaseFile | null {
  return release.files.find((f) => INSTALLERS[platform].test(f.name) && !f.name.includes("__uninstaller")) ?? null;
}
