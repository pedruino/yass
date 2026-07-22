#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  YASS: local installer (macOS)
#  Wires this repo into Claude Code via symlinks. Idempotent.
#  Usage:  ./install.sh
#  WARNING: replaces the live voice daemon at ~/.claude/mcp-servers/speak
#  (backs it up first). Run only when you want YASS as the active voice system.
# ════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
DAEMON_TARGET="$CLAUDE_DIR/mcp-servers/speak"
HOOK_TARGET="$CLAUDE_DIR/hooks/speak-hook.js"

echo "▸ YASS install, repo: $REPO_DIR"

# 1. .env (single source of keys, at the root)
if [ ! -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "  ⚠  .env created from the example: fill in FISH_API_KEY (or use the ⚙ panel)."
else
  echo "  ✓ .env already exists"
fi

# 2. Daemon deps (npm)
echo "▸ Installing daemon deps…"
( cd "$REPO_DIR" && npm install --silent )

# 2b. Build the app (React/Vite -> app/dist, served by the daemon)
echo "▸ Building app (React/Vite)…"
( cd "$REPO_DIR/app" && npm install --silent && npm run build )

# 3. Symlinks, backing up whatever exists
backup() { [ -e "$1" ] && [ ! -L "$1" ] && mv "$1" "$1.bak.$(date +%s)" && echo "  ↺ backup: $1.bak.*"; }
mkdir -p "$CLAUDE_DIR/mcp-servers" "$CLAUDE_DIR/hooks"
backup "$DAEMON_TARGET"
ln -sfn "$REPO_DIR" "$DAEMON_TARGET"
echo "  ✓ daemon/app/mcp -> $DAEMON_TARGET"
backup "$HOOK_TARGET"
ln -sfn "$REPO_DIR/hooks/speak-hook.js" "$HOOK_TARGET"
echo "  ✓ hook -> $HOOK_TARGET"

# 4. Menu-bar app (.app) -> /Applications (optional; requires a Tauri build)
APP_REL="$REPO_DIR/app/src-tauri/target/release/bundle/macos/YASS.app"
APP_DBG="$REPO_DIR/app/src-tauri/target/debug/bundle/macos/YASS.app"
SRC_APP=""
[ -d "$APP_REL" ] && SRC_APP="$APP_REL"
[ -z "$SRC_APP" ] && [ -d "$APP_DBG" ] && SRC_APP="$APP_DBG"
if [ -n "$SRC_APP" ]; then
  echo "▸ Installing YASS.app into /Applications…"
  pkill -9 -f "YASS.app" 2>/dev/null || true
  rm -rf "/Applications/YASS.app"
  cp -R "$SRC_APP" "/Applications/YASS.app"
  killall Dock 2>/dev/null || true   # clears the macOS icon cache
  echo "  ✓ /Applications/YASS.app updated (new icon applied)"
else
  echo "  ⚠ .app not built: run (cd app && npx tauri build) and re-run to install the icon."
fi

cat <<EOF

✔ Installed.
  • Daemon + app (port 3891):      node $DAEMON_TARGET/yass-daemon.js
  • Enable speech on Claude Stop:  touch ~/.yass/speak-mode
  • Register the Stop hook:        add to ~/.claude/settings.json (hooks.Stop):
        {"type":"command","command":"node $HOOK_TARGET"}
  • Register the MCP:              claude mcp add yass node $DAEMON_TARGET/index.js
EOF
