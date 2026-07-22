#!/usr/bin/env node
'use strict';

const { encode } = require('@msgpack/msgpack');
const { writeFileSync, unlinkSync, readFileSync } = require('fs');
const { spawn } = require('child_process');
const { join } = require('path');
const { tmpdir } = require('os');

const rawText = process.argv[2];
if (!rawText) process.exit(0);

const FISH_API_KEY = process.env.FISH_API_KEY;
const FISH_VOICE_ID = process.env.FISH_VOICE_ID || 'a5b93aeddcc948c19ea04f0afe9d178c';
const CHUNK_SIZE = 400; // chars; Fish Audio cuts off around 500+

if (!FISH_API_KEY) { console.error('FISH_API_KEY not set'); process.exit(1); }

// Load phonetics glossary
const GLOSSARY_PATH = join(__dirname, 'glossary.json');
let glossary = {};
try { glossary = JSON.parse(readFileSync(GLOSSARY_PATH, 'utf8')); } catch {}

function applyGlossary(text) {
  let result = text;
  // Sort by descending length: longer terms take priority
  const sorted = Object.entries(glossary).sort((a, b) => b[0].length - a[0].length);
  for (const [term, phonetic] of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi');
    result = result.replace(re, phonetic);
  }
  return result;
}

function cleanForTTS(raw) {
  let text = raw
    .replace(/```[\s\S]*?```/g, 'veja o código no terminal.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link omitido')
    .replace(/^\s*[│├└─|#>\-]{2,}.*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g, (m) => m.replace(/([A-Z])/g, ' $1').trim())
    .replace(/[_]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return applyGlossary(text);
}

// Split into chunks by sentence, respecting CHUNK_SIZE
function chunkText(text) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

async function synthesize(text) {
  const body = encode({ text, reference_id: FISH_VOICE_ID, format: 'mp3' });
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FISH_API_KEY}`,
      'Content-Type': 'application/msgpack',
      model: 's2-pro',
    },
    body,
  });
  if (!res.ok) throw new Error(`Fish Audio ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function play(buffer) {
  return new Promise((resolve, reject) => {
    const file = join(tmpdir(), `speak-${Date.now()}.mp3`);
    writeFileSync(file, buffer);
    const proc = process.platform === 'darwin'
      ? spawn('afplay', [file], { stdio: 'ignore' })
      : spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file], { stdio: 'ignore' });
    proc.on('close', () => { try { unlinkSync(file); } catch {} resolve(); });
    proc.on('error', reject);
  });
}

async function main() {
  const cleaned = cleanForTTS(rawText);
  const chunks = chunkText(cleaned);

  for (const chunk of chunks) {
    const audio = await synthesize(chunk);
    await play(audio);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
