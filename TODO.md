# TODOs and Branstorming



## Releases

- **Android version (wanted, do eventually).** The cheapest way to get Meridian onto phones, because the web client already runs in a mobile browser and needs no new renderer. Ship it as a PWA or wrapped with Capacitor (Play Store).
  - Needs a touch layout: virtual joystick or tap-to-move, a camera/turn drag area, an on-screen hotbar and spell bar, a "go" button for doors and exits, tap-to-pick-up and tap-to-place in the inventory, bigger touch targets and safe-area padding.
  - Chat and login must work with the soft keyboard (keep the viewport from jumping).
  - Check download size and memory (textures, sprites) on mid-range phones.
  - iOS would come almost for free from the same wrapper (Safari/PWA, or Capacitor), but needs an Apple Developer account for the App Store.
  - Background and notes: the Unreal repo's docs/adr/0011-linux-and-mac-builds.md "Android".
  - Investigated 2026-10-08: the plan is [ADR 0003](docs/adr/0003-android.md) (Capacitor, a native port of the asset cache, a signed APK on GitHub releases first). Start with its Phase 0 spike on a real phone.


## UI

- Minimap
  - Typing in the chat window and zooming in both cause the minimap to "flash" a little bit. The zoom issue might just be that any keyboard input causes the minimap to flash




## Interactions




## Actions
- 