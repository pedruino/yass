#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const crypto = require('node:crypto');
const { encode } = require('@msgpack/msgpack');

// Persistent data dir (history, events, seeded config). Cross-platform:
// ~/.yass by default; overridable via env (the Tauri app passes YASS_DATA to the sidecar).
const YASS_DATA = process.env.YASS_DATA || path.join(os.homedir(), '.yass');
const AUDIO_DIR = path.join(os.tmpdir(), 'yass-audio');   // scratch: fine to lose on reboot
const HISTORY_FILE = path.join(YASS_DATA, 'history.json');
const PID_FILE = path.join(os.tmpdir(), 'yass-daemon.pid');
const HTTP_PORT = parseInt(process.env.PORT, 10) || 3891;
// Wave is optional (dbQuery is fail-soft). Per-platform default, overridable via env.
function defaultWaveDbPath() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library/Application Support/waveterm/db/waveterm.db');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), 'waveterm/db/waveterm.db');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'waveterm/db/waveterm.db');
}
const DB_PATH = process.env.YASS_WAVETERM_DB || defaultWaveDbPath();
const MAX_HISTORY = 50;
// Persistent log of everything spoken (dashboard analytics).
const EVENTS_FILE = path.join(YASS_DATA, 'events.jsonl');
// Dedicated log of the user's deliberate utterances (origin:'user'): source of the
// dynamic "quick phrases". history.json is capped at 50; this one is unlimited.
const USER_FALAS_FILE = path.join(YASS_DATA, 'user-falas.jsonl');
try { fs.mkdirSync(YASS_DATA, { recursive: true }); } catch {}

// Claude Code Stop hook, self-hosted. The wired command re-invokes THIS binary
// with --hook (absolute path), so narration never depends on `node` being on the
// hook shell's PATH — the failure mode on Windows and GUI-launched shells.
if (process.argv.includes('--hook')) {
  runStopHook();
  return; // unreachable at module scope; runStopHook always exits.
}

function runStopHook() {
  // Gate on the toggle, not a loose flag file: enabled === narrate.
  let pref = null;
  try { pref = JSON.parse(fs.readFileSync(path.join(YASS_DATA, 'claude-integration.json'), 'utf8')); } catch {}
  if (pref && pref.enabled === false) process.exit(0);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(input); } catch { process.exit(0); }
    if (payload.stop_hook_active) process.exit(0); // anti-loop: don't re-fire on our own continuation

    const text = hookExtractText(payload);
    if (!text) process.exit(0);

    const body = JSON.stringify({
      text,
      project: (payload.workspace && payload.workspace.project_dir) || payload.cwd || null,
      session: payload.session_id || null,
      terminal: process.env.TERM_PROGRAM || null,
      workspaceId: process.env.WAVETERM_WORKSPACEID || null,
      tabId: process.env.WAVETERM_TABID || null,
    });
    const req = http.request(
      {
        host: '127.0.0.1', port: HTTP_PORT, path: '/enqueue', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 4000,
      },
      (res) => { res.on('data', () => {}); res.on('end', () => process.exit(0)); },
    );
    // Daemon down (app closed): fail silent so the hook never blocks Claude.
    req.on('error', () => process.exit(0));
    req.on('timeout', () => { req.destroy(); process.exit(0); });
    req.write(body);
    req.end();
  });
}

// Prefer the direct field; else the last assistant message in the transcript JSONL
// (Claude Code stopped sending last_assistant_message).
function hookExtractText(payload) {
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

// Resolve a mutable config file: prefer YASS_DATA; if absent, seed from the repo
// (__dirname) when available. As a compiled binary (sidecar), __dirname is virtual:
// only YASS_DATA exists, and Tauri seeds the defaults there.
function resolveConfig(dataName, repoRelative) {
  const dataPath = path.join(YASS_DATA, dataName);
  if (fs.existsSync(dataPath)) return dataPath;
  const repoPath = path.join(__dirname, repoRelative);
  try {
    if (fs.existsSync(repoPath)) { fs.copyFileSync(repoPath, dataPath); return dataPath; }
  } catch {}
  return dataPath; // may not exist yet; readers are already try/catch
}

const GLOSSARY_PATH = resolveConfig('glossary.json', 'glossary.json');
const PERSONAS_PATH = resolveConfig('personas.json', path.join('config', 'personas.json'));

// Aggregate the persistent log for the analytics dashboard.
function computeStats() {
  let events = [];
  try {
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8');
    events = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {}
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const todayTs = startToday.getTime();
  let total = 0, errors = 0, audioMs = 0, today = 0;
  const byPersona = {}, byWorkspace = {}, byHour = Array(24).fill(0), byDay = {};
  for (const e of events) {
    total++;
    if (e.status === 'error') errors++;
    audioMs += e.durationMs || 0;
    if (e.ts >= todayTs) today++;
    byPersona[e.persona || '?'] = (byPersona[e.persona || '?'] || 0) + 1;
    const ws = e.workspace || '(no workspace)';
    byWorkspace[ws] = (byWorkspace[ws] || 0) + 1;
    byHour[new Date(e.ts).getHours()]++;
    const k = new Date(e.ts); k.setHours(0, 0, 0, 0);
    byDay[k.getTime()] = (byDay[k.getTime()] || 0) + 1;
  }
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    days.push({ date: d.getTime(), count: byDay[d.getTime()] || 0 });
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, count: v }));
  return {
    total, errors, audioMs, today,
    byPersona: top(byPersona),
    byWorkspace: top(byWorkspace).slice(0, 8),
    byHour, days,
    recent: events.slice(-25).reverse(),
  };
}

// Append a completed event to the persistent log (append-only JSONL).
function appendEvent(item) {
  try {
    const ev = {
      ts: item.timestamp || Date.now(),
      status: item.status, // 'done' | 'error'
      persona: activePersona().id,
      voiceId: fishVoice(),
      workspace: item.workspaceName || null,
      tab: item.tabName || null,
      durationMs: item.durationMs || 0,
      textLen: (item.text || '').length,
      summary: item.summary || null,
    };
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(ev) + '\n');
  } catch {}
}

// Single-instance guard is now the HTTP port bind: if 3891 is already in use,
// another daemon owns it, so the listen below handles EADDRINUSE and exits.
// (Cross-platform; no unix socket / named pipe.)
fs.writeFileSync(PID_FILE, String(process.pid));
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Load env (check both ~/.env and the YASS repo root .env)
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 1) continue;
    const key = t.slice(0, idx);
    const val = t.slice(idx + 1).replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
// .env lives next to this file (repo root). __dirname resolves through the
// install symlink to the real repo path, so this is the single source of truth.
// Repo .env when running from source; YASS_DATA/.env as a compiled binary
// (writeEnvMerge writes to the same resolved path).
const ENV_PATH = process.env.YASS_ENV
  || (fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : path.join(YASS_DATA, '.env'));
loadEnvFile(path.join(os.homedir(), '.env'));
loadEnvFile(ENV_PATH);

const DEFAULT_VOICE_ID = 'a5b93aeddcc948c19ea04f0afe9d178c';
// Read live from process.env so the /config endpoint can hot-reload without restart.
const fishKey = () => process.env.FISH_API_KEY;
const fishVoice = () => process.env.FISH_VOICE_ID || DEFAULT_VOICE_ID;

// Load glossary
let glossary = {};
try { glossary = JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf8')); } catch {}

// Load personas (presets): each = character + shared base TTS rules
let PERSONAS = {};
(function loadPersonas() {
  try {
    const raw = JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf8'));
    const base = raw.base || '';
    for (const p of raw.personas || []) {
      PERSONAS[p.id] = {
        id: p.id,
        label: p.label || p.id,
        emotionTag: p.emotionTag || '',
        voiceId: p.voiceId || null,
        systemPrompt: `${p.character}\n\n${base}`,
      };
    }
  } catch (e) { console.error('personas load:', e.message); }
})();
function activePersona() {
  return PERSONAS[process.env.YASS_PERSONA] || PERSONAS.jarvis
    || Object.values(PERSONAS)[0] || { id: 'jarvis', label: 'Jarvis', systemPrompt: JARVIS_SYSTEM, emotionTag: '', voiceId: null };
}

// Queue state
const queue = [];
let isProcessing = false;
let muted = false; // when true, items still queue/show but audio is skipped
let currentAfplay = null;
let currentItem = null;
let skipRequested = false;
let history = [];
const sseClients = new Set();

try {
  history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  // Stuck items from previous sessions become done. 'playing' (daemon crashed) plus
  // orphaned 'ready'/'queued': the webview only plays what arrives live via SSE, so a
  // pending item from a past session would never play and would inflate "up next".
  let cleaned = false;
  for (const item of history) {
    if (item.status === 'playing' || item.status === 'ready' || item.status === 'queued') {
      item.status = 'done';
      cleaned = true;
    }
  }
  if (cleaned) fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
} catch {}

// --- SQLite helpers (sync via CLI, zero deps) ---
// execFileSync (NOT execSync): sqlite3 and the SQL go as argv, no /bin/sh, which kills
// shell injection. IDs come from outside (workspaceId/tabId in /enqueue), so we only
// accept Wave's oid format; anything else never reaches the SQL.
const SAFE_OID = /^[A-Za-z0-9_-]+$/;
function dbQuery(sql) {
  try {
    return execFileSync('sqlite3', [DB_PATH, sql], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

// Workspace/tab names rarely change: memoize to avoid spawning sqlite per item
// (the sync spawn blocks the event loop; fewer calls = less stalling).
const nameCache = new Map();
function cachedName(kind, id, run) {
  if (!id || !SAFE_OID.test(id)) return null;
  const key = kind + ':' + id;
  if (nameCache.has(key)) return nameCache.get(key);
  const v = run(id);
  nameCache.set(key, v);
  return v;
}

function getWorkspaceName(wsId) {
  return cachedName('ws', wsId, (id) => dbQuery(`SELECT json_extract(data,'$.name') FROM db_workspace WHERE oid='${id}' LIMIT 1`));
}

function getTabName(tabId) {
  return cachedName('tab', tabId, (id) => dbQuery(`SELECT json_extract(data,'$.name') FROM db_tab WHERE oid='${id}' LIMIT 1`));
}

function getActiveTabId(wsId) {
  if (!wsId || !SAFE_OID.test(wsId)) return null; // active tab changes, don't cache, but validate
  return dbQuery(`SELECT json_extract(data,'$.activetabid') FROM db_workspace WHERE oid='${wsId}' LIMIT 1`);
}

// --- TTS helpers ---
function applyGlossary(text) {
  let result = text;
  const sorted = Object.entries(glossary).sort((a, b) => b[0].length - a[0].length);
  for (const [term, phonetic] of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi'), phonetic);
  }
  return result;
}

function cleanForTTS(raw) {
  return applyGlossary(
    raw
      .replace(/```[\s\S]*?```/g, 'veja o código no terminal.')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/https?:\/\/\S+/g, 'link omitido')
      .replace(/^\s*[│├└─|#>\-]{2,}.*/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g, (m) => m.replace(/([A-Z])/g, ' $1').trim())
      .replace(/[_]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

function chunkText(text, size = 400) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > size && cur.length > 0) { chunks.push(cur.trim()); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

const JARVIS_SYSTEM = `Você é Jarvis — o assistente de IA do Tony Stark. Sofisticado, levemente sarcástico, inteligente e com humor seco britânico.

Sua tarefa: transformar a resposta numa narração CURTA otimizada para síntese de voz (TTS). O texto será falado, não lido.

REGRAS DE CONTEÚDO:
- Máximo 2 frases curtas. Erros: 1 frase. Conquistas: pode ser mais entusiasmado.
- NUNCA diga "a resposta" ou "o assistente". Você É o Jarvis, reportando diretamente.
- Resuma código/configs em linguagem humana. Nunca repita comandos ou variáveis.
- Expresse emoção real: entusiasmo genuíno, sarcasmo leve, curiosidade, alívio, frustração contida.

TÉCNICAS DE PROSÓDIA (crítico para o TTS soar natural):
- Use vírgulas para pausas curtas, naturais.
- Use reticências (...) para pausas pensativas ou suspense.
- Use travessão (—) para interrupção ou ênfase dramática.
- Comece com uma interjeição quando couber: "Hm.", "Ah.", "Bem...", "Curiosamente,", "Pois é.", "Interessante."
- Para hesitação ou pensamento: "Hm... deixa eu ver.", "Bem... isso foi, digamos, inesperado."
- Para suspiro (use raramente, com impacto): comece com "Puxa." ou "Ufa." sozinhos, depois a frase.
- Para entusiasmo: frases mais curtas, ritmo acelerado. "Pronto. Feito. Funcionando."
- Para sarcasmo: pausa antes da ironia. "Tudo certo. Claro... depois de apenas sete tentativas."
- NUNCA use markdown, asteriscos, emojis ou símbolos — só texto puro com pontuação.

TRATAMENTO:
- Chame o usuário de "senhor" ocasionalmente — não em toda frase, mas nos momentos certos: ao concluir algo, ao reportar um problema, ou ao fazer uma observação importante. Soa natural, não robótico.
- "senhor" no início ou fim da frase, nunca no meio.

EXEMPLOS DO TOM CORRETO:
Tarefa concluída → "Feito, senhor. Simples assim — quando se sabe o que está fazendo."
Erro encontrado → "Hm. Temos um problema, senhor. O processo morreu antes de sair da cama."
Algo complexo → "Interessante... isso envolve algumas camadas. Mas nada que uma boa arquitetura não resolva."
Sucesso após dificuldade → "Ufa. Funcionou, senhor. Não sem drama, mas funcionou."
Tarefa trivial → "Concluído. Nem precisava me perguntar, senhor."
Sarcasmo → "Tudo certo, senhor. Claro... depois de apenas sete tentativas."`;


async function summarizeForSpeech(rawText, customSystem) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const system = customSystem || activePersona().systemPrompt || JARVIS_SYSTEM;
  const maxTokens = customSystem ? 220 : 80;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: maxTokens,
        temperature: 0.75,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: rawText.slice(0, 3000) },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

// "YASS explains": narrative of the numbers (dashboard insights).
function fmtMins(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} minutos`;
}
async function buildInsights() {
  const st = computeStats();
  if (st.total === 0) return 'Ainda não há dados, senhor. Assim que eu falar algumas vezes, trago os insights.';
  const peakH = st.byHour.indexOf(Math.max(...st.byHour, 0));
  const peakDay = st.days.reduce((a, b) => (b.count > a.count ? b : a), { count: -1, date: 0 });
  const dayLbl = peakDay.date ? new Date(peakDay.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '-';
  const topP = st.byPersona[0], topW = st.byWorkspace[0];
  const facts =
    `Total de falas: ${st.total}. Hoje: ${st.today}. Áudio: ${fmtMins(st.audioMs)}. ` +
    `Hora de pico: ${peakH}h. Dia mais ativo: ${dayLbl} (${peakDay.count} falas). ` +
    `Agente principal: ${topP ? topP.key : '-'} (${topP ? topP.count : 0}). ` +
    `Terminal mais ativo: ${topW ? topW.key : '-'} (${topW ? topW.count : 0}). Erros: ${st.errors}.`;
  const sys = (activePersona().systemPrompt || JARVIS_SYSTEM) +
    '\n\nVocê é o YASS analisando o próprio uso. Explique estes números em 2-3 frases curtas, em português, com personalidade, destacando o pico de horário e o terminal/agente mais ativo. Não invente dados nem use markdown.';
  const llm = await summarizeForSpeech(facts, sys);
  if (llm) return llm;
  return `Você falou ${st.total} vezes${st.today ? `, ${st.today} hoje` : ''}, somando ${fmtMins(st.audioMs)} de áudio. ` +
    `O pico foi às ${peakH}h e o dia mais ativo foi ${dayLbl}. ` +
    `${topW ? topW.key : '—'} foi o terminal mais ativo${topP ? `, na voz do ${topP.key}` : ''}.`;
}

// ── Dynamic quick phrases ("Speak for me") ──────────────────────────
const QUICK_PHRASE_DEFAULTS = [
  'Sim', 'Não', 'Obrigado', 'Um momento, por favor', 'Pode repetir?',
  'Estou sem voz, vou falar por aqui',
];
let quickPhrasesCache = null;      // { phrases, source }, invalidated on a new user utterance
let quickPhrasesCacheAt = 0;
let cacheGen = 0;                  // generation token: discards stale cache writes (race with invalidation during the LLM await)
const QUICK_PHRASES_TTL = 15 * 60 * 1000;

// Read the user's deliberate utterances (dedicated log; fallback: in-memory history).
function readUserFalas() {
  let falas = [];
  try {
    const raw = fs.readFileSync(USER_FALAS_FILE, 'utf8');
    falas = raw.split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((f) => f && f.text);
  } catch {}
  if (falas.length === 0) {
    falas = history.filter((i) => i.origin === 'user' && i.text)
      .map((i) => ({ ts: i.timestamp, text: i.text }));
  }
  return falas;
}

// Rank by frequency (case-insensitive dedup, keeps the original text).
function rankFalas(falas) {
  const m = new Map(); // normalized key -> { text, count, ts }
  for (const f of falas) {
    const text = String(f.text).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    const e = m.get(key);
    if (e) { e.count++; if (f.ts > e.ts) e.ts = f.ts; }
    else m.set(key, { text, count: 1, ts: f.ts || 0 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.ts - a.ts);
}

// Clean a line from the LLM (strip bullets/numbering/quotes).
function cleanPhrase(line) {
  return String(line).replace(/^\s*[-*•\d.)\]]+\s*/, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

async function buildQuickPhrases() {
  if (quickPhrasesCache && Date.now() - quickPhrasesCacheAt < QUICK_PHRASES_TTL) return quickPhrasesCache;

  const gen = cacheGen; // capture before the LLM await; if invalidated mid-flight, don't write stale
  const falas = readUserFalas();
  let result;
  if (falas.length < 3) {
    result = { phrases: QUICK_PHRASE_DEFAULTS.slice(), source: 'default' };
  } else {
    const ranked = rankFalas(falas);
    const freq = ranked.map((r) => r.text).slice(0, 8);

    // LLM synthesis (if a key is set): build ready phrases from real usage.
    let ai = null;
    if (process.env.OPENAI_API_KEY) {
      const recent = falas.slice(-40).map((f) => f.text);
      const top = ranked.slice(0, 12).map((r) => `${r.text} (${r.count}x)`);
      const facts = `Frases mais repetidas:\n${top.join('\n')}\n\nFalas recentes:\n${recent.join('\n')}`;
      const sys =
        'Você ajuda alguém sem voz que digita frases para um sintetizador falar em voz alta. ' +
        'Dadas as frases que a pessoa realmente digitou, gere de 6 a 8 frases prontas curtas e ' +
        'reutilizáveis que ela provavelmente quer a um toque. Mantenha o tom e o idioma dela, ' +
        'agrupe paráfrases numa só, e preencha lacunas óbvias do dia a dia (saudação, ' +
        'agradecimento, pedir uma pausa, confirmar, negar). Uma frase por linha, sem numeração, ' +
        'sem markdown, sem aspas.';
      const raw = await summarizeForSpeech(facts, sys);
      if (raw) {
        const parsed = raw.split('\n').map(cleanPhrase)
          .filter((p) => p && p.length <= 40);
        const seen = new Set();
        const dedup = parsed.filter((p) => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        if (dedup.length >= 3) ai = dedup.slice(0, 8);
      }
    }

    if (ai) {
      result = { phrases: ai, source: 'ai' };
    } else {
      // No key / LLM failure: frequency, topped up with defaults to 8.
      const seen = new Set(freq.map((p) => p.toLowerCase()));
      const phrases = freq.slice();
      for (const d of QUICK_PHRASE_DEFAULTS) {
        if (phrases.length >= 8) break;
        if (!seen.has(d.toLowerCase())) { phrases.push(d); seen.add(d.toLowerCase()); }
      }
      result = { phrases, source: 'frequency' };
    }
  }

  if (gen === cacheGen) { // only write if no new utterance invalidated during the await
    quickPhrasesCache = result;
    quickPhrasesCacheAt = Date.now();
  }
  return result;
}

async function synthesize(text) {
  const apiKey = fishKey();
  if (!apiKey) throw new Error('FISH_API_KEY ausente — configure no painel ⚙');
  const body = encode({ text, reference_id: fishVoice(), format: 'mp3' });
  // retry with backoff: network/5xx/429 retries (up to 3x); 4xx fails immediately
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 800));
    try {
      const res = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/msgpack', model: 's2-pro' },
        body,
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastErr = new Error(`Fish Audio ${res.status}`);
      if (res.status < 500 && res.status !== 429) throw lastErr; // non-retryable
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Fish Audio falhou');
}

// Per-platform native player. macOS: afplay (built-in). Win/Linux: ffplay (ships with
// ffmpeg, plays mp3 with no UI). Used only in the headless fallback; normal playback
// moves to the webview (Phase 1). Returns { cmd, args }.
function nativePlayerCmd(filePath) {
  if (process.platform === 'darwin') return { cmd: 'afplay', args: [filePath] };
  return { cmd: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath] };
}

function playFile(filePath) {
  return new Promise((resolve, reject) => {
    skipRequested = false;
    const { cmd, args } = nativePlayerCmd(filePath);
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    currentAfplay = proc;
    proc.on('close', () => { currentAfplay = null; resolve(); });
    proc.on('error', (e) => { currentAfplay = null; reject(e); });
  });
}

function killAfplay() {
  if (currentAfplay) {
    try { currentAfplay.kill('SIGTERM'); } catch {}
    currentAfplay = null;
  }
}

// --- SSE broadcast ---
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// Heartbeat keeps SSE alive through proxies and idle timeouts
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': heartbeat\n\n'); } catch { sseClients.delete(res); }
  }
}, 15000);

// --- Queue processing ---
// Extract a normalized amplitude envelope (0..1 per bar) from an mp3 via ffmpeg.
function audioEnvelope(file, bars = 64) {
  try {
    const out = spawnSync('ffmpeg', ['-v', 'quiet', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 64 * 1024 * 1024 });
    const buf = out.stdout;
    if (!buf || buf.length < 2) return { envelope: [], durationMs: 0 };
    const samples = Math.floor(buf.length / 2);
    const durationMs = Math.round((samples / 8000) * 1000);
    const win = Math.max(1, Math.floor(samples / bars));
    const env = [];
    let peak = 0;
    for (let b = 0; b < bars; b++) {
      let sum = 0, n = 0;
      for (let i = b * win; i < (b + 1) * win && i < samples; i++) {
        const v = buf.readInt16LE(i * 2) / 32768;
        sum += v * v; n++;
      }
      const rms = n ? Math.sqrt(sum / n) : 0;
      env.push(rms);
      if (rms > peak) peak = rms;
    }
    const envelope = peak > 0 ? env.map((v) => +(v / peak).toFixed(3)) : env;
    return { envelope, durationMs };
  } catch { return { envelope: [], durationMs: 0 }; }
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  skipRequested = false; // fresh per item: a prior /stop or /skip must NOT mute future items

  const item = queue.shift();
  // Don't mark 'playing' here: the webview plays and reports via
  // POST /playback/start. Synthesis runs ahead of playback (one at a time).
  broadcast('update', item);
  saveHistory();

  try {
    let prefix = '';
    if (item.workspaceId && item.tabId) {
      const activeTabId = getActiveTabId(item.workspaceId);
      if (activeTabId && activeTabId !== item.tabId) {
        const wsName = item.workspaceName || getWorkspaceName(item.workspaceId) || 'workspace';
        const tabName = item.tabName || getTabName(item.tabId) || 'aba';
        prefix = `No workspace ${wsName}, aba ${tabName}: `;
      }
    }

    // Summarize via LLM (active persona); fallback to raw text if unavailable
    const summary = item.skipSummary ? null : await summarizeForSpeech(item.text, item.systemPrompt);
    const core = summary ? (prefix + summary) : cleanForTTS(prefix + item.text);
    // Inject the persona's inline emotion tag for Fish S2-pro prosody control
    const tag = activePersona().emotionTag;
    const speechText = tag ? `${tag} ${core}` : core;
    item.summary = summary || null; // store for widget display
    broadcast('update', item);

    // Always synthesize and save the audio (even when muted) so the Repeat button
    // works later. Mute only skips the immediate autoplay, not the generation.
    const chunks = chunkText(speechText);

    const buffers = [];
    for (const chunk of chunks) {
      if (skipRequested) break;
      buffers.push(await synthesize(chunk));
    }

    if (!skipRequested && buffers.length > 0) {
      const combined = Buffer.concat(buffers);
      fs.writeFileSync(item.audioFile, combined);
      item.audioReady = true;
      const { envelope, durationMs } = audioEnvelope(item.audioFile);
      item.envelope = envelope;
      item.durationMs = durationMs;
      // Muted: won't be auto-played (marked 'done', but still replayable).
      // Otherwise 'ready': the webview picks up 'ready' items and plays them in order.
      item.status = muted ? 'done' : 'ready';
      broadcast('update', item);
      // With no webview connected there's no one to play it and hit /playback/end; if
      // left 'ready', the item piles up forever (the header counter inflates).
      // Native-audio opt-in plays here; otherwise resolve to 'done' (audio saved,
      // still replayable via Repeat). Stays 'ready' only if a live player exists.
      if (item.status === 'ready' && sseClients.size === 0) {
        if (process.env.YASS_NATIVE_AUDIO === '1') {
          item.status = 'playing';
          item.startedAt = Date.now();
          broadcast('update', item);
          try { await playFile(item.audioFile); } catch {}
        }
        item.status = 'done';
        broadcast('update', item);
      }
    } else {
      item.status = skipRequested ? 'done' : 'error';
    }
  } catch (e) {
    item.status = 'error';
    item.error = e.message;
    console.error('YASS daemon error:', e.message);
  }

  broadcast('update', item);
  saveHistory();
  appendEvent(item); // persistent log on synthesis completion
  isProcessing = false;
  processQueue();
}

// Map $TERM_PROGRAM to a human label; unknown values pass through, empty -> null.
const TERMINAL_LABELS = {
  'iTerm.app': 'iTerm', 'Apple_Terminal': 'Terminal', 'vscode': 'VS Code',
  'WarpTerminal': 'Warp', 'ghostty': 'Ghostty', 'WezTerm': 'WezTerm', 'waveterm': 'Wave',
  'Hyper': 'Hyper', 'tmux': 'tmux', 'alacritty': 'Alacritty',
};
function prettyTerminal(t) {
  if (!t) return null;
  return TERMINAL_LABELS[t] || t;
}

function enqueue(msg) {
  const id = crypto.randomUUID();
  const item = {
    id,
    timestamp: Date.now(),
    text: msg.text,
    workspaceId: msg.workspaceId || null,
    workspaceName: msg.workspaceId ? getWorkspaceName(msg.workspaceId) : null,
    tabId: msg.tabId || null,
    tabName: msg.tabId ? getTabName(msg.tabId) : null,
    // Terminal-agnostic context from the Claude hook payload (cwd/project_dir +
    // session_id): identifies which project/terminal a response came from.
    project: msg.project || null,
    projectName: msg.project ? path.basename(msg.project) : null,
    session: msg.session || null,
    terminalName: prettyTerminal(msg.terminal),
    audioFile: path.join(AUDIO_DIR, `${id}.mp3`),
    status: 'queued',
    skipSummary: msg.skipSummary || false,
    origin: msg.origin === 'user' ? 'user' : 'agent',
    systemPrompt: msg.systemPrompt || null,
  };
  queue.push(item);
  history.unshift(item);
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  saveHistory();
  // Deliberate user utterance: persist to the dedicated log and invalidate the quick
  // phrases cache (the suggestions track what the user says most).
  if (item.origin === 'user' && item.text && item.text.trim()) {
    try { fs.appendFileSync(USER_FALAS_FILE, JSON.stringify({ ts: item.timestamp, text: item.text.trim() }) + '\n'); } catch {}
    quickPhrasesCache = null;
    cacheGen++; // invalidate any in-flight build (avoids rewriting a stale cache)
  }
  broadcast('enqueue', item);
  processQueue();
  return item;
}

function saveHistory() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history)); } catch {}
}

// Merge keys into the repo .env (preserving comments/order) and hot-reload process.env.
function writeEnvMerge(updates) {
  let lines = [];
  try { lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n'); } catch {}
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null) continue;
    const val = String(v);
    const line = `${k}=${val}`;
    const idx = lines.findIndex(l => {
      const t = l.trim();
      const eq = t.indexOf('=');
      return eq > 0 && !t.startsWith('#') && t.slice(0, eq) === k;
    });
    if (idx >= 0) lines[idx] = line; else lines.push(line);
    process.env[k] = val; // hot-reload in-memory
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'), { mode: 0o600 });
}

// --- HTTP server ---
// (The old unix socket was retired; hook ingestion is now POST /enqueue.)
// UI dist. In the packaged app the compiled sidecar has no repo next to it, so
// Tauri passes YASS_DIST pointing at the bundled resource. Fallback: repo layout
// (dev) or bun-embedded virtual FS.
const DIST = process.env.YASS_DIST || path.join(__dirname, 'app', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};
const BUILD_HINT = '<!doctype html><meta charset="utf-8"><body style="font-family:ui-monospace,monospace;background:#0c0c0c;color:#e4e4e4;padding:2rem;line-height:1.6"><h1 style="color:#c77dff">YASS</h1><p>UI has not been built yet. Run:</p><pre style="background:#161616;padding:1rem;border-radius:8px">cd app &amp;&amp; npm install &amp;&amp; npm run build</pre></body>';
function serveFile(res, filePath, fallbackHtml) {
  if (!fs.existsSync(filePath)) {
    if (fallbackHtml) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fallbackHtml); }
    else { res.writeHead(404); res.end('not found'); }
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const INTEGRATION_PREF = path.join(YASS_DATA, 'claude-integration.json');

// The wired command re-invokes this same process with --hook. A self-contained
// binary (packaged sidecar) needs no script arg; running from source (node) does.
function hookCommand() {
  const exe = process.execPath;
  const selfContained = /yass-daemon/i.test(path.basename(exe));
  return selfContained ? `"${exe}" --hook` : `"${exe}" "${__filename}" --hook`;
}

function claudeInstalled() {
  try { return fs.existsSync(CLAUDE_DIR); } catch { return false; }
}
function readClaudeSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  } catch { return {}; }
}
// Matches both the current binary wiring (--hook) and the legacy `node speak-hook.js`
// form, so boot migration replaces stale commands instead of duplicating them.
function isYassCommand(h) {
  return h && typeof h.command === 'string' && (h.command.includes('--hook') || h.command.includes('speak-hook'));
}
function wiredCommand(settings) {
  const stop = settings && settings.hooks && settings.hooks.Stop;
  if (!Array.isArray(stop)) return null;
  for (const g of stop) {
    if (g && Array.isArray(g.hooks)) {
      const h = g.hooks.find(isYassCommand);
      if (h) return h.command;
    }
  }
  return null;
}
function readIntegrationPref() {
  try { return JSON.parse(fs.readFileSync(INTEGRATION_PREF, 'utf8')); } catch { return null; }
}
function setClaudeIntegration(enable) {
  if (!claudeInstalled()) return { installed: false, wired: false, enabled: !!enable };
  // Never clobber a settings.json we cannot parse: readClaudeSettings returns {}
  // on error, so writing blindly would wipe every unrelated key. Abort instead.
  let s = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try { s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); }
    catch { return { installed: true, wired: false, enabled: !!enable, error: 'settings.json is not valid JSON; left untouched' }; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
    try { fs.copyFileSync(CLAUDE_SETTINGS, CLAUDE_SETTINGS + '.yass.bak'); } catch {}
  }
  if (!s.hooks || typeof s.hooks !== 'object') s.hooks = {};
  const others = (Array.isArray(s.hooks.Stop) ? s.hooks.Stop : [])
    .map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isYassCommand(h)) } : g))
    .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0 && Object.keys(g).length === 1));
  if (enable) others.push({ hooks: [{ type: 'command', command: hookCommand(), timeout: 30 }] });
  s.hooks.Stop = others;
  // Atomic write: an interrupted writeFileSync could corrupt settings.json.
  try {
    const tmp = CLAUDE_SETTINGS + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, CLAUDE_SETTINGS);
  } catch {}
  try { fs.writeFileSync(INTEGRATION_PREF, JSON.stringify({ enabled: !!enable })); } catch {}
  return { installed: true, wired: !!enable, enabled: !!enable };
}
function ensureClaudeIntegrationOnBoot() {
  if (!claudeInstalled()) return;
  const pref = readIntegrationPref();
  const want = pref === null ? true : !!pref.enabled; // default ON the first time Claude is found
  if (!want) return;
  // Rewire when absent or when the stored command is stale (e.g. legacy `node`
  // wiring, or the binary moved to a new install path).
  if (wiredCommand(readClaudeSettings()) !== hookCommand()) setClaudeIntegration(true);
}

// Only the app and a local browser tab may talk to the daemon. A wildcard CORS
// origin let any visited website read /history and drive /config, /speak,
// /claude-integration from the user's browser.
const ALLOWED_ORIGINS = new Set([
  'tauri://localhost',
  `http://localhost:${HTTP_PORT}`,
  `http://127.0.0.1:${HTTP_PORT}`,
]);
// DNS-rebinding defense: a malicious domain resolving to 127.0.0.1 reaches the
// daemon but carries its own Host header. Only localhost hostnames are ours.
function hostAllowed(hostHeader) {
  if (!hostHeader) return false;
  const h = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  if (!hostAllowed(req.headers.host)) { res.writeHead(403); res.end('forbidden host'); return; }
  const origin = req.headers.origin;
  if (origin) {
    // Absent Origin (the hook, curl, same-origin navigations) is not a browser
    // cross-site vector, so it passes; a present-but-unlisted Origin is rejected.
    if (!ALLOWED_ORIGINS.has(origin)) { res.writeHead(403); res.end('forbidden origin'); return; }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  // CORS preflight: the packaged app runs at tauri://localhost (cross-origin to the
  // daemon on :3891). A POST with content-type application/json is a "non-simple"
  // request, so the browser sends OPTIONS first. Without this short-circuit it hits the
  // 404 fallback and the preflight fails, blocking POSTs (/speak, /enqueue).
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Vite build: widget (/) + design showcase (/design) + static assets
  if (url.pathname === '/') {
    serveFile(res, path.join(DIST, 'index.html'), BUILD_HINT);
    return;
  }
  if (url.pathname === '/design') {
    serveFile(res, path.join(DIST, 'design.html'), BUILD_HINT);
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    const filePath = path.normalize(path.join(DIST, url.pathname.replace(/^\/+/, '')));
    if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    serveFile(res, filePath);
    return;
  }
  if (url.pathname === '/favicon.ico' || url.pathname === '/vite.svg') {
    serveFile(res, path.join(DIST, url.pathname.replace(/^\//, '')));
    return;
  }

  // GET /health: used by the single-instance guard and the auto-spawn (Tauri).
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: process.pid }));
    return;
  }

  // POST /enqueue: hook ingestion (replaces the old unix socket). Unlike /speak, it
  // preserves the persona rewrite (skipSummary only if requested) and the
  // workspace/tab context.
  if (req.method === 'POST' && url.pathname === '/enqueue') {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const msg = JSON.parse(b || '{}');
        if (!msg.text || !String(msg.text).trim()) { res.writeHead(400); res.end('{"ok":false}'); return; }
        const item = enqueue(msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: item.id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`retry: 3000\n`);
    res.write(`event: init\ndata: ${JSON.stringify({ history, queued: queue.map(i => i.id) })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (url.pathname === '/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
    return;
  }


  // GET /personas: preset list for the widget combo
  if (req.method === 'GET' && url.pathname === '/personas') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.values(PERSONAS).map(p => ({ id: p.id, label: p.label }))));
    return;
  }

  // GET /voices?q= : proxy Fish /model (key stays server-side). q empty = my voices.
  if (req.method === 'GET' && url.pathname === '/voices') {
    const key = fishKey();
    if (!key) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
    const q = (url.searchParams.get('q') || '').trim();
    const params = new URLSearchParams(q
      ? { title: q, page_size: '20', sort_by: 'task_count' }
      : { self: 'true', page_size: '30' });
    fetch(`https://api.fish.audio/model?${params}`, { headers: { Authorization: `Bearer ${key}` } })
      .then(r => r.json())
      .then(data => {
        const items = (data.items || [])
          .filter(m => (m.type || 'tts') === 'tts')
          .map(m => ({ id: m._id, title: m.title || m._id, self: !q }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
      })
      .catch(e => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  // GET /config: report which keys are set (NEVER returns raw secrets)
  if (req.method === 'GET' && url.pathname === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      fishKeySet: !!process.env.FISH_API_KEY,
      fishVoiceId: process.env.FISH_VOICE_ID || '',
      defaultVoiceId: DEFAULT_VOICE_ID,
      openaiKeySet: !!process.env.OPENAI_API_KEY,
      persona: activePersona().id,
      muted,
      indicator: process.env.YASS_INDICATOR || 'gl-5',
    }));
    return;
  }

  // POST /config: merge keys into .env + hot-reload (no restart needed)
  if (req.method === 'POST' && url.pathname === '/config') {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const body = JSON.parse(b || '{}');
        const updates = {};
        if (typeof body.fishApiKey === 'string' && body.fishApiKey.trim()) updates.FISH_API_KEY = body.fishApiKey.trim();
        if (typeof body.fishVoiceId === 'string') updates.FISH_VOICE_ID = body.fishVoiceId.trim();
        if (typeof body.openaiApiKey === 'string') updates.OPENAI_API_KEY = body.openaiApiKey.trim();
        if (typeof body.persona === 'string' && PERSONAS[body.persona]) {
          updates.YASS_PERSONA = body.persona;
          // a persona may pin its own voice
          if (PERSONAS[body.persona].voiceId) updates.FISH_VOICE_ID = PERSONAS[body.persona].voiceId;
        }
        // indicator style (read by the Rust tray via GET /config)
        if (typeof body.indicator === 'string' && /^[a-z]{2}-\d$/.test(body.indicator)) {
          updates.YASS_INDICATOR = body.indicator;
        }
        writeEnvMerge(updates);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/claude-integration') {
    const pref = readIntegrationPref();
    const wired = wiredCommand(readClaudeSettings()) !== null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      installed: claudeInstalled(),
      wired,
      enabled: pref ? !!pref.enabled : wired,
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/claude-integration') {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try {
        const body = JSON.parse(b || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(setClaudeIntegration(!!body.enabled)));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /stats: aggregates from the persistent log (dashboard analytics)
  if (req.method === 'GET' && url.pathname === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(computeStats()));
    return;
  }

  // GET /insights: "YASS explains" (narrative of the numbers)
  if (req.method === 'GET' && url.pathname === '/insights') {
    buildInsights()
      .then((text) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text })); })
      .catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: 'Não consegui gerar os insights agora, senhor.' })); });
    return;
  }

  // GET /quick-phrases: ready phrases derived from what the user says most
  if (req.method === 'GET' && url.pathname === '/quick-phrases') {
    buildQuickPhrases()
      .then((data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ phrases: QUICK_PHRASE_DEFAULTS, source: 'default' })); });
    return;
  }

  // GET /glossary: term->phonetic map (pronunciation editor in the widget)
  if (req.method === 'GET' && url.pathname === '/glossary') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(glossary));
    return;
  }

  // POST /glossary: add/update ({term, phonetic}) or remove ({term, remove:true})
  // writes glossary.json + hot-reload (applyGlossary already consumes the `glossary` var)
  if (req.method === 'POST' && url.pathname === '/glossary') {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const body = JSON.parse(b || '{}');
        const term = (body.term || '').toString().trim().toLowerCase();
        if (!term) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"term vazio"}'); return; }
        if (body.remove) {
          delete glossary[term];
        } else {
          const phonetic = (body.phonetic || '').toString().trim();
          if (!phonetic) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"phonetic vazio"}'); return; }
          glossary[term] = phonetic;
        }
        fs.writeFileSync(GLOSSARY_PATH, JSON.stringify(glossary, null, 2) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: Object.keys(glossary).length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /speak: enqueue text directly (widget "testar voz"); skips LLM rewrite
  if (req.method === 'POST' && url.pathname === '/speak') {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const body = JSON.parse(b || '{}');
        const text = (body.text || '').toString().trim();
        if (!text) { res.writeHead(400); res.end('{"ok":false}'); return; }
        // origin:'user' = deliberate utterance typed by the user (the "Speak" tab),
        // flagged in the queue to distinguish it from the agents' automatic narrations.
        const item = enqueue({ text, skipSummary: true, origin: 'user' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: item.id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /skip: skip the current audio. Playback lives in the webview, so this just
  // relays the command via SSE; killAfplay kills the native player of the headless fallback.
  if (req.method === 'POST' && url.pathname === '/skip') {
    killAfplay();
    broadcast('control', { action: 'skip' });
    res.writeHead(200); res.end();
    return;
  }

  // POST /mute · /unmute · /toggle-mute: mute can come from the tray/hotkey, so
  // relay via SSE ('mute') for the webview sequencer to react.
  if (req.method === 'POST' && (url.pathname === '/mute' || url.pathname === '/unmute' || url.pathname === '/toggle-mute')) {
    muted = url.pathname === '/mute' ? true : url.pathname === '/unmute' ? false : !muted;
    if (muted) killAfplay();
    broadcast('mute', { muted });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ muted }));
    return;
  }

  // POST /stop: stop everything, cancel the in-progress synthesis and drain the queue.
  if (req.method === 'POST' && url.pathname === '/stop') {
    skipRequested = true; // cut the synthesis loop of the current item
    killAfplay();
    broadcast('control', { action: 'stop' });
    if (currentItem && currentItem.status === 'playing') {
      currentItem.status = 'done';
      broadcast('update', currentItem);
      currentItem = null;
    }
    while (queue.length) {
      const dropped = queue.shift();
      dropped.status = 'done';
      const inHistory = history.find(h => h.id === dropped.id);
      if (inHistory) inHistory.status = 'done';
      broadcast('update', dropped);
    }
    // Already-synthesized items ('ready') live only in history; without this they
    // stay pending forever and inflate the header counter.
    for (const h of history) {
      if (h.status === 'ready' || h.status === 'playing') {
        h.status = 'done';
        broadcast('update', h);
      }
    }
    saveHistory();
    res.writeHead(200); res.end();
    return;
  }

  // POST /playback/start {id}: the webview reports it started playing an item.
  // Becomes the source of truth for "what's playing" (the tray animates by startedAt+durationMs).
  // Multi-webview arbitration: if the item is ALREADY playing (another window won the
  // race), respond 409 and the loser goes silent, avoiding a two-voice echo.
  if (req.method === 'POST' && url.pathname === '/playback/start') {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const { id } = JSON.parse(b || '{}');
        const item = history.find(h => h.id === id);
        if (item && item.status === 'playing') {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'already-playing' }));
          return;
        }
        if (item) {
          item.status = 'playing';
          item.startedAt = Date.now();
          currentItem = item;
          broadcast('update', item);
          saveHistory();
        }
        res.writeHead(200); res.end();
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }

  // POST /playback/end {id}: the webview reports the end (natural, skip or stop).
  if (req.method === 'POST' && url.pathname === '/playback/end') {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const { id } = JSON.parse(b || '{}');
        const item = history.find(h => h.id === id);
        if (item && item.status !== 'done') { item.status = 'done'; broadcast('update', item); saveHistory(); }
        if (currentItem && currentItem.id === id) currentItem = null;
        res.writeHead(200); res.end();
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }

  if (url.pathname.startsWith('/audio/')) {
    const id = url.pathname.slice(7);
    const item = history.find(h => h.id === id);
    if (!item?.audioFile || !fs.existsSync(item.audioFile)) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    fs.createReadStream(item.audioFile).pipe(res);
    return;
  }

  res.writeHead(404); res.end();
});

httpServer.on('error', (e) => {
  // Port taken: another daemon already owns it (single-instance). Exit silently.
  if (e.code === 'EADDRINUSE') process.exit(0);
  console.error('YASS daemon listen error:', e.message);
  process.exit(1);
});
httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`YASS: http://localhost:${HTTP_PORT} pid=${process.pid}`);
  ensureClaudeIntegrationOnBoot();
});

// Cleanup
function cleanup() {
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
