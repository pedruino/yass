#!/usr/bin/env node
'use strict';

// Enqueue text to the daemon via HTTP POST /enqueue (formerly a unix socket).
// Cross-platform: no named pipe / file socket. Keeps the daemon auto-launch with
// retry so it doesn't block the Claude Code hook.

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const HTTP_PORT = parseInt(process.env.PORT, 10) || 3891;
const DAEMON = path.join(__dirname, 'yass-daemon.js');
const NODE = process.execPath;

// Args: --workspace ID --tab ID --project DIR --session ID, text via stdin
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const workspaceId = get('--workspace');
const tabId = get('--tab');
const project = get('--project');
const session = get('--session');
const terminal = get('--terminal');

let text = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { text += d; });
process.stdin.on('end', () => {
  text = text.trim();
  if (!text) process.exit(0);
  send(0);
});

function launchDaemon() {
  try {
    spawn(NODE, [DAEMON], { detached: true, stdio: 'ignore', env: { ...process.env } }).unref();
  } catch {}
}

function send(attempt) {
  const body = JSON.stringify({ text, workspaceId, tabId, project, session, terminal });
  const req = http.request(
    { host: '127.0.0.1', port: HTTP_PORT, path: '/enqueue', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 4000 },
    (res) => { res.on('data', () => {}); res.on('end', () => process.exit(0)); },
  );

  req.on('error', () => {
    // Daemon down: launch it and retry (up to 3x); then give up silently.
    if (attempt === 0) { launchDaemon(); setTimeout(() => send(1), 1500); }
    else if (attempt === 1) { setTimeout(() => send(2), 1500); }
    else process.exit(0);
  });
  req.on('timeout', () => { req.destroy(); process.exit(0); });

  req.write(body);
  req.end();
}
