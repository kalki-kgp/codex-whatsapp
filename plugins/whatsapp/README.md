# WhatsApp channel plugin (skeleton)

Companion plugin to `whatsapp-agent-cli`. Bridges a WhatsApp number into a
running Claude Code session via the official [channels](https://code.claude.com/docs/en/channels)
mechanism, so messages route through the interactive subscription pool
instead of the Agent SDK pool that `claude -p` now uses.

This directory is the **skeleton** — enough scaffolding for the agent-cli
supervisor to launch a real MCP server. The WhatsApp transport itself
(baileys / whatsapp-web.js), pairing, allowlist, and tool implementations
are TODO.

Mirror the reference plugin while building this out:
[external_plugins/telegram](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram).

## Structure

```
plugins/whatsapp/
├── .claude-plugin/plugin.json   # plugin manifest
├── .mcp.json                    # registers server.ts as an MCP server
├── .npmrc
├── package.json                 # Bun deps (@modelcontextprotocol/sdk, zod)
├── server.ts                    # MCP server — currently a stub
└── skills/                      # /whatsapp:configure, /whatsapp:access (TODO)
```

## Run it

The supervisor in `server/channel_supervisor.py` does all of this for you on
startup when `AGENT_BACKEND=claude`. For reference, the underlying calls are:

```
# one-time, idempotent, run by the supervisor
claude plugin marketplace add <abs path to plugins/>
claude plugin install whatsapp@whatsapp-agent-cli

# then, on every launch:
claude \
  --dangerously-load-development-channels plugin:whatsapp@whatsapp-agent-cli \
  --add-dir <workspace root> \
  --permission-mode bypassPermissions
```

`--dangerously-load-development-channels` is required while the plugin
isn't on Anthropic's allowlist or in an org's `allowedChannelPlugins`.
The supervisor invokes claude under a PTY so it stays in interactive mode
(otherwise claude detects a non-TTY stdout and refuses to start without
a `--print` prompt).

## What's missing (the real work)

1. WhatsApp transport — pick baileys (preferred for Bun) or whatsapp-web.js
   and own the connection inside `server.ts`.
2. Pairing / QR flow and `~/.claude/channels/whatsapp/access.json` state.
3. Inbound: `mcp.notification({ method: 'notifications/claude/channel', ... })`
   for each WhatsApp message (see Telegram's `handleInbound`).
4. Tools: real `reply` (text + attachments), `react`, `edit_message`.
5. Slash-command skills under `skills/` for setup and access control.
6. Permission relay opt-in (`claude/channel/permission`) if you want
   approve/deny from the phone.
