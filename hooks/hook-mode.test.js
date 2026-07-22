'use strict';

// Guarantees the self-hosted Stop hook: `yass-daemon --hook` reads the Claude
// payload, gates on the integration toggle, and POSTs to the daemon /enqueue.
// This is the wiring that replaced `node speak-hook.js` (which broke when `node`
// was off the hook shell's PATH on Windows).
//   node --test hooks/

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DAEMON = path.join(__dirname, '..', 'yass-daemon.js');

// Fresh YASS_DATA with the toggle set (or absent), so the gate is deterministic.
function makeData(enabled) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yass-hookmode-'));
  const data = path.join(home, '.yass');
  fs.mkdirSync(data, { recursive: true });
  if (enabled !== undefined) {
    fs.writeFileSync(path.join(data, 'claude-integration.json'), JSON.stringify({ enabled }));
  }
  return { home, data };
}

// Run the daemon in --hook mode against a throwaway server; resolves to the
// captured POST (or null if none arrived before the child exited).
function runHook(payload, { enabled = true, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    let captured = null;
    const server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        captured = { path: req.url, method: req.method, body: JSON.parse(b || '{}') };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"id":"test"}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const { home, data } = makeData(enabled);
      const child = spawn(process.execPath, [DAEMON, '--hook'], {
        env: {
          ...process.env, HOME: home, USERPROFILE: home, YASS_DATA: data,
          PORT: String(port), TERM_PROGRAM: 'iTerm.app',
          WAVETERM_WORKSPACEID: '', WAVETERM_TABID: '', ...env,
        },
      });
      child.on('error', reject);
      child.on('close', () => {
        setTimeout(() => { server.close(); resolve(captured); }, 30);
      });
      child.stdin.end(JSON.stringify(payload));
    });
  });
}

test('enqueues the assistant reply with origin context', async () => {
  const got = await runHook({
    session_id: 'abcd1234-session',
    cwd: '/home/x/myproj',
    last_assistant_message: 'Bom dia, senhor.',
  });
  assert.ok(got, 'expected an /enqueue POST');
  assert.equal(got.path, '/enqueue');
  assert.equal(got.body.text, 'Bom dia, senhor.');
  assert.equal(got.body.session, 'abcd1234-session');
  assert.equal(got.body.project, '/home/x/myproj');
  assert.equal(got.body.terminal, 'iTerm.app');
});

test('falls back to the transcript when no direct message', async () => {
  const tpath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yass-tr-')), 'transcript.jsonl');
  fs.writeFileSync(tpath, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta do transcript' }] } }),
  ].join('\n'));
  const got = await runHook({ session_id: 's', cwd: '/p', transcript_path: tpath });
  assert.ok(got, 'expected an /enqueue POST from transcript fallback');
  assert.equal(got.body.text, 'resposta do transcript');
});

test('does NOT enqueue when the toggle is disabled', async () => {
  const got = await runHook(
    { session_id: 's', cwd: '/p', last_assistant_message: 'nao deveria falar' },
    { enabled: false },
  );
  assert.equal(got, null, 'the toggle gate should have blocked the enqueue');
});

test('enqueues when no pref file exists yet (default on)', async () => {
  const got = await runHook(
    { session_id: 's', cwd: '/p', last_assistant_message: 'padrao ligado' },
    { enabled: undefined },
  );
  assert.ok(got, 'absent pref should not block (default on)');
  assert.equal(got.body.text, 'padrao ligado');
});

test('does NOT enqueue when stop_hook_active (anti-loop)', async () => {
  const got = await runHook({
    session_id: 's', cwd: '/p', stop_hook_active: true,
    last_assistant_message: 'loop',
  });
  assert.equal(got, null, 'stop_hook_active should short-circuit');
});

test('does NOT enqueue an empty reply', async () => {
  const got = await runHook({ session_id: 's', cwd: '/p', last_assistant_message: '   ' });
  assert.equal(got, null, 'blank text should not enqueue');
});
