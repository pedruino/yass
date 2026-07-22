#!/usr/bin/env node
'use strict';

// Cross-platform Claude Code Stop hook (replaces the bash speak-mode.sh).
// Reads the Stop payload on stdin, extracts the assistant's reply plus origin
// context (project/session/terminal), and POSTs it to the daemon /enqueue.
// Pure Node: no bash, no grep/xargs, no symlinks. Works on macOS/Linux/Windows.
//
// Register in Claude Code settings.json (Stop hook):
//   { "type": "command", "command": "node \"<abs>/hooks/speak-hook.js\"" }

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Gate: only speak when the persistent flag exists (toggled by the /speak skill).
// Legacy /tmp flag still honored for back-compat.
const flag = path.join(os.homedir(), '.yass', 'speak-mode');
const legacy = path.join(os.tmpdir(), 'yass-speak-mode');
if (!fs.existsSync(flag) && !fs.existsSync(legacy)) process.exit(0);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch { process.exit(0); }

  // Anti-loop: the Stop hook must not re-trigger on its own continuation.
  if (payload.stop_hook_active) process.exit(0);

  const text = extractText(payload);
  if (!text) process.exit(0);

  const body = JSON.stringify({
    text,
    // Terminal-agnostic origin, straight from the Claude payload + env.
    project: (payload.workspace && payload.workspace.project_dir) || payload.cwd || null,
    session: payload.session_id || null,
    terminal: process.env.TERM_PROGRAM || null,
    // Wave enrichment (optional; empty everywhere else).
    workspaceId: process.env.WAVETERM_WORKSPACEID || null,
    tabId: process.env.WAVETERM_TABID || null,
  });
  enqueue(body);
});

// The assistant reply: prefer the direct field, else the last assistant message
// in the transcript JSONL (Claude Code stopped sending last_assistant_message).
function extractText(payload) {
  let raw = payload.last_assistant_message || '';
  if (!raw && payload.transcript_path) {
    try {
      const lines = fs.readFileSync(payload.transcript_path, 'utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const m = JSON.parse(lines[i]);
          const msg = m.message || m;
          if ((m.type === 'assistant' || msg.role === 'assistant') && msg.content) {
            const c = msg.content;
            raw = Array.isArray(c)
              ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ')
              : String(c);
            if (raw.trim()) break;
          }
        } catch { /* skip malformed line */ }
      }
    } catch { /* no transcript */ }
  }
  return String(raw).replace(/\s+/g, ' ').trim();
}

function enqueue(body) {
  const port = parseInt(process.env.PORT, 10) || 3891;
  const req = http.request(
    {
      host: '127.0.0.1', port, path: '/enqueue', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 4000,
    },
    (res) => { res.on('data', () => {}); res.on('end', () => process.exit(0)); },
  );
  // Daemon down (app closed): nothing to do, fail silent so the hook never blocks Claude.
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.write(body);
  req.end();
}
