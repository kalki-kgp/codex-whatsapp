/**
 * Serve whatsapp-agent-docs/index.html (static) and POST /api/chat → Nebius OpenAI-compatible API.
 *
 * From this directory:
 *   npm install
 *   cp .env.example .env   # optional template only — fill NEBIUS_API_KEY
 *   npm start
 *
 * Put NEBIUS_API_KEY in .env in this folder (same dir as server.js).
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const express = require('express');
const OpenAI = require('openai');

const MAX_MESSAGE_CHARS = 8000;
const MAX_MESSAGES = 48;

const DEFAULT_BASE = 'https://api.tokenfactory.us-central1.nebius.com/v1/';
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

const SYSTEM_PROMPT = `You are the on-site assistant for the open-source project **whatsapp-agent-cli** only.

## Answer scope
- Reply **only** using documented facts about whatsapp-agent-cli: architecture, install, configuration, commands, behavior, troubleshooting.
- If the visitor asks about unrelated topics (other products, generic coding tutorials, politics, medical advice, etc.), politely refuse in one short sentence and invite them to ask something about whatsapp-agent-cli instead.
- Do **not** invent flags, commands, paths, or behaviors that are not typical for this project. If you are unsure, say you are unsure and point them to the GitHub repo or README.

## What whatsapp-agent-cli is
- Self-hosted software that connects a **WhatsApp** chat to a **local CLI coding agent** (Anthropic **Claude Code** CLI or **Codex** CLI) running on the operator's machine or VPS.
- **Two processes**: (1) **Bridge** — Node (\`bridge/bridge.js\`), uses Baileys for WhatsApp, exposes a small HTTP API on \`127.0.0.1:<WHATSAPP_PORT>\` (often 3010). Handles pairing, media, deduplication, LID↔phone mapping for allowlists. (2) **Gateway** — Python asyncio (\`server/gateway.py\`), usually spawned by the operator via CLI; polls the bridge, forwards chat text to the configured CLI backend, sends replies back through the bridge.
- **Session state** is owned by the gateway, persisted under \`~/.agent-whatsapp/state.json\` (path may vary): per WhatsApp chat — \`thread_id\` / session id, \`root\` working directory, \`model\`, \`summary\`, \`saved_sessions\` (archived snapshots, capped).
- **Environment** is loaded from \`~/.agent-whatsapp/.env\` in normal setups: \`AGENT_BACKEND\` (\`codex\` or \`claude\`), \`AGENT_COMMAND\`, \`AGENT_ROOT\`, \`AGENT_MODEL\`, \`WHATSAPP_MODE\` (\`bot\` vs \`self-chat\`), \`WHATSAPP_ALLOWED_USERS\`, \`WHATSAPP_PORT\`, logging/debug vars, etc.

## Chat commands (gateway intercepts before the CLI)
Examples visitors may ask about: \`/new\`, \`/root\`, \`/compact\`, \`/model\`, \`/resume\`, \`/search-session\`, \`/memory\`, \`/status\`, \`/help\`, and related flows for saved sessions.

## Install / ops (high level)
- Bootstrap / installer scripts exist in the repo; PyPI package **whatsapp-agent-cli**; CLI entrypoints such as \`whatsapp-agent\` for install, pair, service control.
- WhatsApp linking uses QR (linked devices). Often run under **systemd user** unit \`agent-whatsapp.service\`.

Keep answers concise unless the visitor asks for detail. Use bullet lists when comparing modes or steps.`;

function normMessagesTail(messages, limit, maxChars) {
  const slice = messages.slice(-limit);
  const out = [];
  for (const item of slice) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role;
    let content = item.content;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string') continue;
    let text = content.trim();
    if (!text) continue;
    if (text.length > maxChars) text = text.slice(0, maxChars);
    out.push({ role, content: text });
  }
  return out;
}

/** Nebius / OpenAI-compatible APIs sometimes return message.content as string or as content-parts array. */
function extractAssistantText(message) {
  if (!message) return '';
  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    return message.refusal.trim();
  }
  const c = message.content;
  if (c == null) return '';
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    const chunks = [];
    for (const part of c) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof part.text === 'string') chunks.push(part.text);
      else if (typeof part.text === 'string') chunks.push(part.text);
    }
    return chunks.join('').trim();
  }
  if (typeof c === 'object' && typeof c.text === 'string') return c.text.trim();
  return '';
}

const app = express();
app.use(express.json({ limit: '512kb' }));

const apiKey = (process.env.NEBIUS_API_KEY || '').trim();
const client = apiKey
  ? new OpenAI({
      baseURL: (process.env.NEBIUS_BASE_URL || DEFAULT_BASE).replace(/\/?$/, '/'),
      apiKey,
    })
  : null;

app.post('/api/chat', async (req, res) => {
  if (!client) {
    res.status(503).json({ error: 'Chat API not configured (missing NEBIUS_API_KEY in .env).' });
    return;
  }

  const raw = req.body && req.body.messages;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: 'Missing messages array' });
    return;
  }

  const cleaned = normMessagesTail(raw, MAX_MESSAGES, MAX_MESSAGE_CHARS);
  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') {
    res.status(400).json({ error: 'Last message must be a non-empty user message' });
    return;
  }

  const model = (process.env.DOCS_CHAT_MODEL || DEFAULT_MODEL).trim();

  // Plain strings for every role — some providers return empty assistant content when user turns use multipart arrays.
  const messagesForApi = [{ role: 'system', content: SYSTEM_PROMPT }, ...cleaned];

  try {
    const response = await client.chat.completions.create({
      model,
      messages: messagesForApi,
    });

    const choice = response.choices && response.choices[0];
    const replyText = extractAssistantText(choice && choice.message);

    if (!replyText) {
      const fr = choice && choice.finish_reason;
      const dbg =
        process.env.DOCS_CHAT_DEBUG === '1'
          ? ` choices=${JSON.stringify(response.choices || []).slice(0, 800)}`
          : '';
      console.error('[whatsapp-agent-docs] Empty assistant content', fr ? `finish_reason=${fr}` : '', dbg);
      res.status(502).json({
        error:
          'Empty model reply (upstream returned no assistant text).' +
          (fr ? ` finish_reason=${fr}.` : '') +
          ' Set DOCS_CHAT_DEBUG=1 on the server for a short log snippet.',
      });
      return;
    }
    res.json({ reply: replyText });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    res.status(502).json({ error: `Upstream error: ${msg}` });
  }
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

const port = parseInt(process.env.PORT || '4321', 10);
const host = process.env.HOST || '127.0.0.1';

const httpServer = app.listen(port, host, () => {
  console.log(`whatsapp-agent-docs listening on http://${host}:${port}`);
});

httpServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[whatsapp-agent-docs] Port ${port} is already in use on ${host}. Stop the other service on that port (often an old static server), or run:\n` +
        `  PORT=4322 npm start\n` +
        `Then point cloudflared/nginx at the new PORT.`,
    );
    process.exit(1);
  }
  console.error('[whatsapp-agent-docs] Failed to listen:', err);
  process.exit(1);
});
