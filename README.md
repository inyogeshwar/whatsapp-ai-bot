# WhatsApp AI Bot 🤖

A complete, **secure, modular** WhatsApp bot built on **[@whiskeysockets/baileys v7](https://github.com/WhiskeySockets/Baileys)** (`7.0.0-rc14`), for Node.js 20+.

It runs entirely on your own machine, connects to WhatsApp through the official WhatsApp Web protocol, and gives you:

- 🔧 **General commands** — ping, alive, menu, owner, group info, admin list, group rules
- 🛡 **Group administration** — kick/promote/demote, open/close, rename, description, tag-all
- 🔗 **Anti-link moderation** — per-group, with an allowed-domain whitelist and admin exemptions
- 👋 **Welcome & goodbye messages** — fully configurable templates per group
- 🤖 **Optional AI** — `.ai <question>` via a locally running [Ollama](https://ollama.com) instance or any **OpenAI-compatible gateway** like FreeLLMAPI / LM Studio (disabled by default)
- 🔐 **Security-first design** — central authorization, LID-safe identity handling, rate limits, redacted logs, no secrets in code

> **Docs:** [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## ⚠️ Important safety notes

- This project uses an **unofficial library** (Baileys). It is not affiliated with WhatsApp/Meta. Use it responsibly and in line with WhatsApp's Terms of Service: **no spam, no bulk messaging, no unsolicited marketing.**
- The `auth/` folder contains your WhatsApp session keys — treat them like a password. **Never commit them to Git, never share them.**
- **Never share your QR code or a pairing code** with anyone. Anyone who scans it controls your account.

## ✨ Feature list

| Area | Features |
|---|---|
| Connection | QR login in the terminal, session persistence, auto-reconnect (backoff + jitter), clean shutdown (Ctrl+C) |
| General | `.ping` `.alive` `.menu`/`.help` `.owner` `.groupinfo` `.admins` `.rules` |
| Admin | `.tagall` `.kick` `.promote` `.demote` `.group open/close` `.setname` `.setdesc` `.delete` |
| Moderation | `.antilink on/off/status/allow …`, `.welcome on/off/set`, `.goodbye on/off/set` |
| AI | `.ai <question>` (Ollama or OpenAI-compatible gateway, optional, per-user rate limited) · `.ai models` |

## 📋 Requirements

- **Node.js 20 or newer** (`node --version` to check)
- npm 9+ (comes with Node)
- A WhatsApp account (the bot links as a companion device)
- *(Optional)* [Ollama](https://ollama.com) or an OpenAI-compatible gateway (FreeLLMAPI, LM Studio, vLLM) for the AI command

## 🚀 Installation

```bash
# 1. Get the project files (copy this folder / clone your repo), then:
npm install

# 2. Create your configuration file
#    Windows (PowerShell):
Copy-Item .env.example .env
#    macOS / Linux:
#    cp .env.example .env

# 3. Edit .env and set at least BOT_OWNER_JID (your number with country code)

# 4. Start the bot
npm start
```

## 🔑 Environment setup (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `BOT_NAME` | `My WhatsApp Bot` | Shown in `.alive` and `.menu` |
| `BOT_OWNER_NAME` | `Bot Owner` | Shown in `.owner` |
| `BOT_OWNER_JID` | *(empty)* | **Recommended.** Your WhatsApp ID, e.g. `15551234567` (digits + country code) or a full JID like `15551234567@s.whatsapp.net`. Grants owner-only rights. Leave empty to disable owner features. |
| `BOT_PREFIX` | `.` | Command prefix (single character) |
| `LOG_LEVEL` | `info` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `AI_ENABLED` | `false` | Enable the `.ai` command |
| `AI_PROVIDER` | `ollama` | `ollama` or `openai` (any OpenAI-compatible gateway: FreeLLMAPI, LM Studio, vLLM, OpenAI) |
| `AI_BASE_URL` | `http://127.0.0.1:11434` | Provider endpoint (e.g. `http://127.0.0.1:31415` for FreeLLMAPI) |
| `AI_API_KEY` | *(empty)* | Bearer token; **required for `AI_PROVIDER=openai`**, never committed |
| `AI_MODEL` | *(empty)* | Required when AI is enabled, e.g. `llama3.2` |
| `AI_MAX_INPUT` / `AI_MAX_OUTPUT` | `2000` / `4000` | Character bounds for prompts/replies |
| `AI_TIMEOUT_MS` | `30000` | AI request timeout |
| `AI_RATE_LIMIT` / `AI_RATE_WINDOW_SEC` | `5` / `60` | AI requests per user per window |
| `CMD_RATE_LIMIT` / `CMD_RATE_WINDOW_SEC` | `8` / `10` | Commands per user per window |
| `TAGALL_COOLDOWN_SEC` | `60` | Per-group `.tagall` cooldown |

The configuration is validated at startup — a bad value produces a clear, human-readable error.

## ▶️ Running the bot & scanning the QR code

```bash
npm start
```

On first run you'll see a **QR code printed in your terminal**:

1. Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device**
2. Scan the QR code **directly from your terminal screen**
3. Wait for `connection.open — connected to WhatsApp` in the logs

🔒 **Security:** the QR code is rendered *only* in your local terminal. It is never sent to chat, logs, or any web page. **Never screenshot and share it** — it grants full access to your account. If someone else may have seen it, immediately unlink the device in WhatsApp settings.

## 💾 How session persistence works

Credentials and Signal encryption keys are stored in the local **`auth/`** folder (via Baileys' multi-file auth state, wrapped in a caching key store). On the next `npm start`, the bot reconnects **without** a new QR scan.

- **The `auth/` folder is already in `.gitignore`** — it must never be uploaded to a public repository or shared. Anyone holding these files can impersonate your account.
- If you are **logged out** (e.g. you unlinked the device from your phone), the bot will tell you and stop. Delete the `auth/` folder and restart to scan a fresh QR.
- For production deployments you should replace the file-based store with a secure database-backed auth state — the auth code is isolated in `src/connection.js` for exactly that purpose.

## 📖 Command reference

Prefix is `.` by default. Aliases in parentheses.

### General commands (anyone)

| Command | What it does |
|---|---|
| `.ping` (`p`) | Reply with the bot's response time |
| `.alive` (`status`) | Bot status: name, uptime, Node.js and bot version |
| `.menu` (`help`) | Full categorized command list (AI is hidden while disabled) |
| `.owner` (`creator`) | The configured owner's name and contact |
| `.groupinfo` (`ginfo`) | Group name, description, member count, admins — *groups only* |
| `.admins` (`adminlist`) | Mention the current group administrators — *groups only* |
| `.rules` | Show the group rules. Admins: `.rules set <text>` / `.rules clear` |

### Group administration (group admins + owner)

| Command | What it does |
|---|---|
| `.tagall [message]` (`everyone`, `all`) | Mention all members. Live member list, bot excludes itself, batched for big groups, per-group cooldown |
| `.kick @user` (`remove`) | Remove a member (reply to them instead of mentioning works too) |
| `.promote @user` | Make a member an admin |
| `.demote @user` | Demote an admin |
| `.group open` / `.group close` | Everyone can message / admins-only messaging |
| `.setname <name>` (`subject`) | Rename the group |
| `.setdesc <text>` (`desc`) | Change the group description |
| `.delete` (`del`) | **Reply to** a message to delete it for everyone (bot must be admin) |

### Moderation

| Command | What it does |
|---|---|
| `.antilink on` / `.antilink off` | Toggle link moderation for this group |
| `.antilink status` | Current configuration |
| `.antilink allow add <domain>` | Whitelist a domain (subdomains included) |
| `.antilink allow remove <domain>` | Remove a whitelisted domain |
| `.antilink allow list` | List whitelisted domains |
| `.welcome on` / `.welcome off` | Toggle the welcome message |
| `.welcome set <template>` | Set the template, e.g. `Welcome {user} to {group}!` (also enables it) |
| `.welcome status` | Show the current welcome configuration |
| `.goodbye on` / `.goodbye off` | Toggle the goodbye message |
| `.goodbye set <template>` | Set the template, e.g. `Goodbye {user} 👋` |
| `.goodbye status` | Show the current goodbye configuration |

**Template placeholders:** `{user}` = a mention of the member, `{group}` = the group name.

**Anti-link behavior:** offending messages are deleted when the bot is an admin (with a short warning); otherwise the bot only warns. Admins and the owner are exempt. Members are **never** kicked or banned automatically.

### AI (optional)

| Command | What it does |
|---|---|
| `.ai <question>` (`ask`, `gpt`) | Ask the configured AI model |
| `.ai models` | List the models the AI service offers (to pick `AI_MODEL`) |

## 🤖 Configuring the AI service

Two providers are supported, selected with `AI_PROVIDER`. Both run without any per-request fee if the backend is local; be aware there are still real costs — hardware (RAM/VRAM), electricity, or the gateway's own quota.

### Option A — FreeLLMAPI / LM Studio / any OpenAI-compatible gateway

1. Start the gateway (FreeLLMAPI listens on `http://127.0.0.1:31415` by default)
2. In `.env`:
   ```dotenv
   AI_ENABLED=true
   AI_PROVIDER=openai
   AI_BASE_URL=http://127.0.0.1:31415
   AI_API_KEY=your-gateway-key
   AI_MODEL=gemini-3.5-flash
   ```
3. Restart the bot. Send `.ai models` in WhatsApp to verify which model ids are usable, then `.ai What is Node.js?`.

### Option B — Ollama

1. Install [Ollama](https://ollama.com) for your OS
2. Pull a model: `ollama pull llama3.2` (or any chat model you like)
3. Start Ollama if it isn't running: `ollama serve`
4. In `.env`:
   ```dotenv
   AI_ENABLED=true
   AI_PROVIDER=ollama
   AI_MODEL=llama3.2
   AI_BASE_URL=http://127.0.0.1:11434
   ```
5. Restart the bot. `.ai What is Node.js?` now works.

If AI is disabled or unreachable, **the rest of the bot works normally** — the `.ai` command just replies with an honest error (and is hidden from `.menu` while disabled). Only the exact question you type is sent to the model — never chat history, never secrets. The API key stays in `.env` and is sent only to your configured `AI_BASE_URL`; it is never logged.

## 🔧 How to configure the owner

Set `BOT_OWNER_JID` in `.env`:

```dotenv
BOT_OWNER_NAME=Jay
BOT_OWNER_JID=15551234567
```

Use your number **with the country code**, digits only (no `+`, spaces, or dashes). A full JID (`15551234567@s.whatsapp.net`) or a LID also works. The bot normalizes it at startup. Owner privileges are derived **only** from this setting — never from display names or anything typed in chat.

## 🩺 Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `Session was logged out…` on startup | Your phone unlinked the device. Delete the `auth/` folder, run `npm start`, scan the new QR. |
| Bot disconnects and reconnects repeatedly | Unstable network or WhatsApp server issues. The bot retries up to 8 times with backoff, then stops with a message — just restart it. |
| `⏳ You are sending commands too quickly` | Per-user rate limit. Wait a few seconds. Tune `CMD_RATE_LIMIT` / `CMD_RATE_WINDOW_SEC`. |
| `⛔ This command is for group administrators only` | You aren't an admin (or the owner) in that group. |
| `⛔ I need to be a group administrator` | Promote the bot's account to admin in the group, then retry. |
| `.kick`/`.delete` fails with an error reply | WhatsApp only lets admins remove members or delete others' messages. Check both your role and the bot's. |
| Someone can't be mentioned/kicked | **LIDs:** WhatsApp now often identifies group members by opaque `@lid` IDs rather than phone numbers. This is normal — the bot handles both forms. If an action fails, ensure the target is currently in the group and that the bot outranks them. |
| `.ai` says the service is unreachable | Start the backend — Ollama (`ollama serve`) or FreeLLMAPI — and verify `AI_BASE_URL` in `.env`. |
| `.ai` says the model is missing | Ollama: `ollama pull <model>`. Gateway: check the model id against `.ai models`; some catalog entries are unavailable (`no_key`). |
| `.ai` returns an auth error | `AI_PROVIDER=openai` requires a valid `AI_API_KEY` for the gateway. |
| `ConfigError` on startup | A `.env` value is invalid — the error message names the variable and the allowed values. |
| Settings seem lost | `data/group-settings.json` may have been deleted or corrupted. The bot recovers with defaults and keeps running; a warning appears in the logs. |

## 🔐 Security practices

- **Secrets live only in `.env` and `auth/`** — both are git-ignored. Never hardcode keys.
- Logs are structured (pino) with **redaction**: no credentials, keys, QR payloads, or full message bodies are ever written.
- All authorization (admin/owner/bot-admin) is checked **centrally** before any command runs; targets come only from WhatsApp-provided metadata, never from user-typed JIDs.
- Per-user and per-group **rate limits** prevent spam and abuse; `.tagall` has an extra cooldown and batch limits.
- The bot **never** executes shell commands, evaluates code, or retains conversation history.
- Moderation never kicks or bans automatically — destructive actions require an explicit human invocation by an admin.
- **Backup caution:** if you back up `data/`, that's fine (it contains only group preferences). **Never** back up `auth/` to untrusted or shared locations.

## 🧪 Tests

```bash
npm test
```

Runs the full suite with Node's built-in test runner — **offline, no WhatsApp account needed**. The socket and group metadata are fully mocked. Covered: command parsing & aliases, text extraction (incl. wrapped messages), permission checks with LID/PN identities and owner-spoofing resistance, missing quoted messages, URL detection & domain whitelisting, anti-link actions and dedupe, rate limits & cooldowns, welcome/goodbye templates & suppression, settings persistence (atomic writes + corrupt-file recovery), and the full dispatch pipeline.

## ⏹ Stopping the bot

Press **Ctrl+C** in the terminal. The bot performs a graceful shutdown: it stops reconnection attempts, closes the WhatsApp connection cleanly, and exits. Session files in `auth/` are preserved, so the next start reconnects without a new QR scan. On servers, `SIGTERM` (e.g. `systemctl stop`) works the same way.

## 🧩 Project layout

```text
src/
├── index.js               entry point & shutdown wiring
├── config.js              .env loading + validation
├── logger.js              pino logging with redaction
├── connection.js          socket lifecycle, QR, reconnect (only file touching makeWASocket)
├── handler.js             message pipeline: filter → moderate → parse → gate → dispatch
├── message-parser.js      text extraction & command parsing (pure functions)
├── command-registry.js    command lookup + aliases
├── permissions.js         LID-safe admin/owner/bot-admin checks
├── group-settings.js      persistent per-group config (atomic JSON writes)
├── rate-limiter.js        rate limits, cooldowns, dedupe sets
├── utils/                 jid · text · group · message helpers
├── commands/              one file per command (general/ · admin/ · ai/)
└── services/              welcome · moderation (anti-link) · ai (Ollama / OpenAI-compatible) · metadata cache
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## 📄 License

MIT
