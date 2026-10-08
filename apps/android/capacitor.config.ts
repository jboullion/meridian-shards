// Meridian Shards for Android: the browser client (apps/client/dist) in the system WebView.
// See docs/adr/0003-android.md. The page is https://localhost/, served from the APK by
// Capacitor; /assets/* is answered by our own ShardsWebViewClient from the selected server,
// and the game socket goes from the page to that server's /ws (apps/client/src/host.ts).

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "net.meridianshards.client",
  appName: "Meridian Shards",
  webDir: "../client/dist",
  android: {
    path: "android",
  },
  plugins: {
    // A game wants the whole screen: no status or navigation bar (a swipe shows them)
    SystemBars: { hidden: true, style: "DARK" },
  },
};

export default config;
