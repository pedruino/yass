# Spec: Waveform reactive to speech rhythm (widget + tray)

Approach **A: envelope in the daemon** (audio stays on `afplay`, universal). Target: the widget's
now-playing bar **and** the menu-bar (tray) icon. ffmpeg 8.1 available.

## 1. Daemon: extract envelope at synthesis
After generating the mp3 (`synthesize()` / before `playFile`), compute amplitude per window:
```bash
ffmpeg -i <file>.mp3 -ac 1 -ar 8000 -f s16le -  # PCM mono 16-bit
```
- Read the PCM (Int16), RMS per ~80ms window (~640 samples) → array normalized 0..1 (e.g. 60 to 120 values).
- Store `item.envelope = number[]` and `item.durationMs`.
- Reuse via `spawnSync('ffmpeg', …)` in Node (ffmpeg already installed).

## 2. Daemon: sync playback
- When an item starts playing: `broadcast('update', {…status:'playing', envelope, durationMs, startedAt})`.
- `GET /history` already carries the envelope on items (a freshly opened widget gets the state).

## 3. Widget: waveform in the now-playing bar (`PlayerBar.tsx` + `indicators/Indicator.tsx`)
- Render N bars (e.g. 5 to 7). While `status==='playing'`:
  - `t = (Date.now() - startedAt) / durationMs` → index into the envelope.
  - Each bar's height = envelope window around `t` (moving average), with light smoothing.
  - `requestAnimationFrame` to update; drop to low bars when idle.
- Style: thin bars, `--accent`/`--info` color, rounded corners (prototype option 4 style).

## 4. Tray (menu bar): envelope-driven frames (`src-tauri/src/lib.rs`)
- Pre-generate ~6 monochrome waveform PNGs (varying heights) OR draw via `image`/`tiny-skia` at runtime.
- Replace the current ●/◌ polling with: read envelope+startedAt from the daemon (`/history`), pick the frame by instantaneous level, `tray.set_icon(frame)` at ~12fps while playing; idle → base icon.
- Simple alternative: 5 PNGs (levels 0 to 4) and map the current RMS → level.

## 5. Verification
- `node yass-daemon.js`; `POST /speak`; the widget bar pulses in rhythm (matches the audio).
- Tauri app: the menu-bar icon animates as a waveform only while speaking; stops when done.
- Check cost: ffmpeg extraction < 100ms per utterance; no stalling the queue.

## Files
- `yass-daemon.js`: envelope (ffmpeg), broadcast with startedAt/durationMs.
- `app/src/components/PlayerBar.tsx`: the now-playing bar; renders `<Indicator>`.
- `app/src/components/indicators/Indicator.tsx`: waveform render from envelope.
- `app/src-tauri/src/lib.rs`: tray frames from envelope (replaces ●/◌).
