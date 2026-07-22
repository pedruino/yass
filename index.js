#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { encode } = require('@msgpack/msgpack');
const { writeFileSync, unlinkSync } = require('fs');
const { spawn } = require('child_process');
const { join } = require('path');
const { tmpdir } = require('os');

const FISH_API_KEY = process.env.FISH_API_KEY;
const FISH_VOICE_ID = process.env.FISH_VOICE_ID || 'a5b93aeddcc948c19ea04f0afe9d178c';
const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';

async function synthesize(text) {
  const body = encode({ text, reference_id: FISH_VOICE_ID, format: 'mp3' });

  const res = await fetch(FISH_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FISH_API_KEY}`,
      'Content-Type': 'application/msgpack',
      model: 's2-pro',
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Fish Audio ${res.status}: ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

function playAudio(buffer) {
  return new Promise((resolve, reject) => {
    const file = join(tmpdir(), `mcp-speak-${Date.now()}.mp3`);
    writeFileSync(file, buffer);
    const proc = process.platform === 'darwin'
      ? spawn('afplay', [file], { stdio: 'ignore' })
      : spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file], { stdio: 'ignore' });
    proc.on('close', () => { try { unlinkSync(file); } catch {} resolve(); });
    proc.on('error', reject);
  });
}

const server = new Server(
  { name: 'speak', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'speak',
    description: 'Synthesizes and plays text as speech using Fish Audio TTS (pt-BR, YASS voice)',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
      },
      required: ['text'],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'speak') {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }

  const { text } = req.params.arguments;
  if (!text) throw new Error('text is required');
  if (!FISH_API_KEY) throw new Error('FISH_API_KEY not configured');

  const audio = await synthesize(text);
  await playAudio(audio);

  return {
    content: [{ type: 'text', text: `Falado: "${text}"` }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
