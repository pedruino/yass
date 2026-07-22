'use strict';

// Guarantees the Claude Stop hook -> daemon /enqueue pipeline: gate, payload
// parsing, transcript fallback, and origin context. Zero deps (node:test).
//   node --test hooks/

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'speak-hook.js');

// Fresh HOME with (or without) the speak-mode flag, so the gate is deterministic.
function makeHome(withFlag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yass-hook-'));
  if (withFlag) {
    fs.mkdirSync(path.join(home, '.yass'), { recursive: true });
    fs.writeFileSync(path.join(home, '.yass', 'speak-mode'), '');
  }
  return home;
}

// Run the hook against a throwaway daemon; resolves to the captured POST (or null
// if none arrived before the child exited).
function runHook(payload, { withFlag = true, env = {} } = {}) {
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
      const home = makeHome(withFlag);
      const child = spawn(process.execPath, [HOOK], {
        env: {
          ...process.env, HOME: home, USERPROFILE: home,
          PORT: String(port), TERM_PROGRAM: 'iTerm.app',
          WAVETERM_WORKSPACEID: '', WAVETERM_TABID: '', ...env,
        },
      });
      child.on('error', reject);
      child.on('close', () => {
        // give a beat for the server handler to flush, then tear down
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
  assert.equal(got.method, 'POST');
  assert.equal(got.body.text, 'Bom dia, senhor.');
  assert.equal(got.body.session, 'abcd1234-session');
  assert.equal(got.body.project, '/home/x/myproj');
  assert.equal(got.body.terminal, 'iTerm.app');
});

test('prefers workspace.project_dir over cwd', async () => {
  const got = await runHook({
    session_id: 's',
    cwd: '/tmp/fallback',
    workspace: { project_dir: '/home/x/realproj' },
    last_assistant_message: 'oi',
  });
  assert.equal(got.body.project, '/home/x/realproj');
});

test('falls back to the transcript when no direct message', async () => {
  const home = os.tmpdir();
  const tpath = path.join(fs.mkdtempSync(path.join(home, 'yass-tr-')), 'transcript.jsonl');
  fs.writeFileSync(tpath, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta do transcript' }] } }),
  ].join('\n'));
  const got = await runHook({ session_id: 's', cwd: '/p', transcript_path: tpath });
  assert.ok(got, 'expected an /enqueue POST from transcript fallback');
  assert.equal(got.body.text, 'resposta do transcript');
});

test('does NOT enqueue without the speak-mode flag', async () => {
  const got = await runHook(
    { session_id: 's', cwd: '/p', last_assistant_message: 'nao deveria falar' },
    { withFlag: false },
  );
  assert.equal(got, null, 'gate should have blocked the enqueue');
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
  assert.equal(got, null, 'empty text should not enqueue');
});
