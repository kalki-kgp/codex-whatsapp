#!/usr/bin/env bun
/**
 * WhatsApp channel for Claude Code — SKELETON.
 *
 * This file is intentionally minimal. It boots an MCP server that declares
 * the channel capability and exposes a stub `reply` tool, so the
 * `claude --channels plugin:whatsapp@…` supervisor in whatsapp-agent-cli has
 * a real process to launch. The actual WhatsApp Web integration (baileys or
 * whatsapp-web.js), pairing flow, allowlist, and tool implementations are
 * deliberately left as TODOs for the plugin work stream.
 *
 * Reference implementation to mirror: external_plugins/telegram/server.ts in
 * anthropics/claude-plugins-official.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STATE_DIR =
  process.env.WHATSAPP_STATE_DIR ?? join(homedir(), '.claude', 'channels', 'whatsapp')
mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })

process.on('unhandledRejection', err => {
  process.stderr.write(`whatsapp channel: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`whatsapp channel: uncaught exception: ${err}\n`)
})

const mcp = new Server(
  { name: 'whatsapp', version: '0.0.1' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
      },
    },
    instructions: [
      'WhatsApp channel — SKELETON.',
      '',
      'Messages from WhatsApp will arrive as <channel source="whatsapp" chat_id="..." message_id="..." user="..." ts="...">. Reply with the reply tool, passing chat_id back.',
      '',
      'This skeleton has no WhatsApp transport yet. Inbound notifications and outbound reply delivery are TODO; the reply tool currently logs and returns success without sending anything.',
    ].join('\n'),
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description:
        'Reply on WhatsApp. Pass chat_id from the inbound <channel> block. TODO: not wired to a transport yet.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' },
          text: { type: 'string' },
          reply_to: {
            type: 'string',
            description: 'Optional message_id to quote-reply.',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
  ],
}))

const ReplyInput = z.object({
  chat_id: z.string(),
  text: z.string(),
  reply_to: z.string().optional(),
})

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const parsed = ReplyInput.safeParse(req.params.arguments ?? {})
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: `invalid reply args: ${parsed.error.message}` }],
      }
    }
    // TODO: forward to a real WhatsApp transport. For now, log + ack.
    process.stderr.write(
      `whatsapp channel: reply stub chat_id=${parsed.data.chat_id} bytes=${parsed.data.text.length}\n`,
    )
    return {
      content: [
        { type: 'text', text: `(skeleton) would send ${parsed.data.text.length} chars to ${parsed.data.chat_id}` },
      ],
    }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
  }
})

const transport = new StdioServerTransport()
mcp.connect(transport).then(() => {
  process.stderr.write(`whatsapp channel: skeleton started, state_dir=${STATE_DIR}\n`)
}).catch(err => {
  process.stderr.write(`whatsapp channel: failed to connect MCP transport: ${err}\n`)
  process.exit(1)
})
