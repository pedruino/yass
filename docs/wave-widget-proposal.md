# YASS as a Wave Terminal widget: proposal

A proposal to ship YASS as an **official [Wave Terminal](https://waveterm.dev) widget**,
reaching the audience that wants it most (terminal devs + Claude Code).

## Pitch (1 line)

> **YASS gives your coding agents a voice.** When Claude Code finishes a task, YASS speaks the result out loud, with a visual queue and personas. Runs local.

## Why it fits Wave

- Wave already supports inline **web widgets** (`view: "web"`, url), and YASS is exactly that: a local page at `localhost:3891`.
- It complements Wave AI: Wave AI reads/analyzes, YASS **speaks** the agents' results.
- Zero coupling: the voice engine is an independent local daemon; Wave only hosts the UI.

## How to install today (manual, until it is official)

`~/.config/waveterm/widgets.json`:

```json
{
  "yass": {
    "icon": "solid@waveform-lines",
    "label": "YASS",
    "color": "#C77DFF",
    "description": "YASS: agent voice queue (TTS)",
    "blockdef": { "meta": { "view": "web", "url": "http://localhost:3891", "pinnedurl": "http://localhost:3891" } }
  }
}
```

Prerequisite: daemon running (`node yass-daemon.js` or via `install.sh` + hook).

## Paths to "official" / gaining visibility

1. **Wave Discord/feedback**: present the widget, ask for a spot in the community widget gallery.
2. **Public repo + demo GIF**: README with a copy-ready `widgets.json`; "Add to Wave in 30s".
3. **Post**: r/ClaudeAI, HN, X, "I gave Claude Code a voice (Wave widget)".
4. Propose a **community widget registry** to the Wave team (if none exists), with YASS as the example.

## Known limitation

Wave is one of the few terminals that embeds an inline web widget (Warp/iTerm/Kitty/Ghostty do
not). So Wave is great for **initial visibility**, but broad reach comes from the **standalone
app (Tauri menu-bar)**, see [tauri-spike.md](tauri-spike.md). The strategy: Wave for niche buzz,
Tauri for every terminal.
