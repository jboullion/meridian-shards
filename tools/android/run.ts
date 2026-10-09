// Builds the Android app (apps/android, ADR 0003) and runs it on a phone or the emulator:
//   1. the client build (apps/client/dist), copied into the Android project (cap sync)
//   2. the debug APK with Gradle, which runs on JDK 21 (org.gradle.java.home in
//      ~/.gradle/gradle.properties, or JAVA_HOME; Gradle 8.14 can't run on Android Studio's JDK 25)
//   3. adb: install it, `adb reverse tcp:5173 tcp:5173` (the app's "Local (dev)" server is the
//      dev stack's Vite on this machine), and launch it
//
//   npm run android [-- --device <serial>] [--no-build] [--bundle] [--release]
//
// --bundle puts the game files (dist/assets, about 430 MB) in the debug APK, as release builds have them.
// --release builds the signed release APK as players get it (app/build.gradle: the key in
// ~/.meridian-shards), with the game files and only the hosted server. Android won't put it over a
// debug build (another key) or the other way round; then the app is uninstalled first, data and all.
//
// The SDK comes from ANDROID_HOME, ANDROID_SDK_ROOT or apps/android/android/local.properties.
// `cap run android` would do steps 2 and 3, but it runs `./gradlew`, which cmd.exe can't.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT = join(ROOT, "apps", "android", "android");
const APP_ID = "net.meridianshards.client";
const { values: opt } = parseArgs({
  options: {
    device: { type: "string" },
    "no-build": { type: "boolean", default: false },
    bundle: { type: "boolean", default: false },
    release: { type: "boolean", default: false },
  },
});

function sdkDir(): string {
  const env = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (env) return env;
  const props = join(PROJECT, "local.properties");
  // local.properties escapes ":" and "\" (sdk.dir=J\:\\AndroidSDK)
  const line = existsSync(props) ? /^sdk\.dir=(.*)$/m.exec(readFileSync(props, "utf8"))?.[1] : undefined;
  if (line) return line.trim().replace(/\\(.)/g, "$1");
  console.error("No Android SDK: set ANDROID_HOME, or sdk.dir in apps/android/android/local.properties");
  process.exit(2);
}

/**
 * The JDK for gradlew: JAVA_HOME, else org.gradle.java.home from ~/.gradle/gradle.properties
 * (the wrapper itself needs a java to start, not only the build).
 */
function javaHome(): string {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const props = join(homedir(), ".gradle", "gradle.properties");
  const line = existsSync(props) ? /^org\.gradle\.java\.home=(.*)$/m.exec(readFileSync(props, "utf8"))?.[1] : undefined;
  if (line) return line.trim().replace(/\\(.)/g, "$1");
  console.error("No JDK 21: set JAVA_HOME, or org.gradle.java.home in ~/.gradle/gradle.properties");
  process.exit(2);
}

const win = process.platform === "win32";
const adb = join(sdkDir(), "platform-tools", win ? "adb.exe" : "adb");

/** A command that must succeed, its output shown. */
function step(label: string, cmd: string, args: string[], cwd = ROOT, shell = false, env = process.env): void {
  console.log(`[android] ${label}`);
  // gradlew.bat and npm's .cmd shim need the shell on Windows; neither path has spaces
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell, env });
  if (r.status !== 0) {
    console.error(`[android] ${label} failed`);
    process.exit(r.status ?? 1);
  }
}

if (!opt["no-build"]) {
  step("building the client and copying it into the Android project", win ? "npm.cmd" : "npm", ["run", "android:sync"], ROOT, win);
  // By full path: cmd.exe may not look in the current folder (NoDefaultCurrentDirectoryInExePath)
  const gradlew = join(PROJECT, win ? "gradlew.bat" : "gradlew");
  const task = opt.release ? "assembleRelease" : "assembleDebug";
  const bundle = opt.bundle && !opt.release ? ["-PshardsBundleAssets"] : [];
  step(`building the ${opt.release ? "release" : "debug"} APK`, gradlew, [task, "--console=plain", "-q", ...bundle], PROJECT, win, { ...process.env, JAVA_HOME: javaHome() });
}

const devices = execFileSync(adb, ["devices"], { encoding: "utf8" })
  .split("\n")
  .slice(1)
  .map((l) => l.trim().split(/\s+/))
  .filter(([serial, state]) => serial && state === "device")
  .map(([serial]) => serial);
const device = opt.device ?? (devices.length === 1 ? devices[0] : undefined);
if (!device || !devices.includes(device)) {
  console.error(
    devices.length
      ? `[android] pick a device with --device: ${devices.join(", ")}`
      : "[android] no device: start the emulator, or plug in a phone with USB debugging on",
  );
  process.exit(2);
}
const onDevice = (label: string, ...args: string[]) => step(label, adb, ["-s", device, ...args]);
const apk = opt.release
  ? join(PROJECT, "app", "build", "outputs", "apk", "release", "app-release.apk")
  : join(PROJECT, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
// An update keeps the app's data; a build signed with another key (a debug build over a release
// one, or the other way) won't go over the one there, so that's uninstalled first, data and all
console.log(`[android] installing on ${device}`);
const install = spawnSync(adb, ["-s", device, "install", "-r", apk], { encoding: "utf8" });
const said = `${install.stdout ?? ""}${install.stderr ?? ""}`;
if (install.status !== 0 && /INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(said)) {
  console.log("[android] the installed app is signed with another key: uninstalling it first");
  spawnSync(adb, ["-s", device, "uninstall", APP_ID], { stdio: "ignore" });
  onDevice(`installing on ${device}`, "install", "-r", apk);
} else if (install.status !== 0) {
  console.error(said.trim());
  console.error("[android] installing failed");
  process.exit(install.status ?? 1);
} else console.log(said.trim().split("\n").pop());
onDevice("forwarding the device's localhost:5173 to the dev stack", "reverse", "tcp:5173", "tcp:5173");
onDevice("launching", "shell", "am", "start", "-n", `${APP_ID}/.MainActivity`);
console.log("[android] running. Console and DevTools: chrome://inspect in Chrome on this machine.");
