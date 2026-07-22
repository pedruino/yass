# Spike: YASS as a menu-bar app (Tauri v2)

> Status: shipped. This is the original spike proposal, kept for context. The Tauri
> shell, the daemon sidecar, and the build now live in `app/src-tauri/`; the "prerequisite"
> and "pending decision" sections below reflect the pre-implementation state.

Goal: free the widget from its terminal dependency. A **menu-bar app** (icon at the top of
macOS) that opens the widget in a popover. It works with **any** terminal, because the voice
engine is already universal (Claude Code's Stop hook).

## What Tauri is (short)

A framework that packages a **native desktop app** using your web front (**YASS's React, no
rewrite**) plus a Rust core. Bundle ~5 MB (Electron would be ~150 MB). Native tray/menu-bar.

- Docs: https://v2.tauri.app
- macOS menu-bar example: https://github.com/ahkohd/tauri-macos-menubar-app-example

## Spike architecture

```
[menu-bar icon] --click--> [borderless popover, always-on-top]
                                 └─ loads http://localhost:3891  (YASS daemon)
```

- The Tauri window points at `http://localhost:3891` (the daemon already serves UI + API/SSE),
  so `/events`, `/config`, `/voices` keep working with no front-end changes.
- The daemon runs as it does today (or the app can launch it as a **sidecar** in a phase 2).

## Prerequisite (not installed on this machine)

```bash
# Rust (rustup): required to compile Tauri
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Xcode Command Line Tools (if you do not have them yet)
xcode-select --install
```

## Spike commands (after Rust)

```bash
cd app
npm i -D @tauri-apps/cli@latest
npm i @tauri-apps/api@latest tauri-plugin-positioner-api
# init src-tauri/ (frontendDist = dist; devUrl = http://localhost:3891)
npx tauri init
# menu-bar config: borderless window + skipTaskbar + tray icon (see example above)
npm run tauri dev      # runs the native app
npm run tauri build    # builds .app + .dmg
```

## Distribution (launch phase)

- **Homebrew cask** + signed/notarized **DMG**.
- Tagline "Give Claude Code a voice" + GIF → HN, r/ClaudeAI, X.

## Effort

- Functional spike (tray + popover pointing at 3891): ~0.5 to 1 day after Rust is installed.
- Polish (daemon sidecar, autostart, icon, notarization): ~1 week.

## Pending decision

Build **here** (install Rust on this machine) **or** delegate the build to **Devin** (its own
toolchain, autonomous). Recommended: Devin for the heavy toolchain spike.
