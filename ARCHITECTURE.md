# Architecture — WhatsApp AI Bot (Baileys v7)

**Companion to [PRD.md](./PRD.md). Describes structure, module responsibilities, data flow, data model, and key decisions.**

---

## 1. High-Level Overview

```text
                         ┌────────────────────────────────────────────┐
                         │                 src/index.js               │
                         │  bootstrap: config → logger → services →   │
                         │  connection.start() → signal handlers      │
                         └───────────────┬────────────────────────────┘
                                         │
        ┌────────────────────────────────┼─────────────────────────────────┐
        ▼                                ▼                                 ▼
┌───────────────┐              ┌──────────────────┐              ┌──────────────────┐
│ connection.js │  events      │    handler.js    │  events      │ welcome-service  │
│ makeWASocket  │─────────────▶│  messages.upsert │              │ group-partici-   │
│ auth state    │  qr / close  │  dedupe/filter   │              │ pants.update     │
│ backoff       │─────────────▶│  parse → gate →  │              └──────────────────┘
└───────────────┘  reconnect   │  dispatch        │
        ▲                      └───────┬──────────┘              ┌──────────────────┐
        │                              │  per-message            │moderation-service│
        │                              ▼                         │  anti-link       │
        │              ┌───────────────┴──────────┐              └──────────────────┘
        │              │ command-registry.js      │
        │              │ permissions.js  (gates)  │
        │              │ rate-limiter.js (limits) │
        │              │ message-parser.js        │
        │              └───────────────┬──────────┘
        │                              ▼
        │                   src/commands/**.js   (18 self-describing command modules)
        │
┌───────┴────────┐   ┌───────────────────┐   ┌───────────────────────┐
│   config.js    │   │ group-settings.js │   │    ai-service.js      │
│ .env + valid.  │   │ data/*.json store │   │ Ollama HTTP (optional)│
└────────────────┘   └───────────────────┘   └───────────────────────┘
             cross-cutting: logger.js (pino) · utils/{jid,text,group,message}.js
```

**Layering rule:** `commands/*` may depend on any layer below them; lower layers
(`config`, `logger`, `utils`) never import upper layers. `handler.js` is the only
module that orchestrates parsing, permissions, rate limiting, and dispatch.

## 2. Directory Layout

```text
whatsapp-ai-bot/
├── package.json               # ESM ("type":"module"), pinned deps, npm scripts
├── .env.example               # placeholder config template (never real secrets)
├── .gitignore                 # auth/, .env, data/*.json, logs/
├── README.md · PRD.md · ARCHITECTURE.md
├── src/
│   ├── index.js               # entry point: bootstrap + graceful shutdown wiring
│   ├── config.js              # dotenv load, validation, owner-JID normalization
│   ├── logger.js              # pino logger with redaction + named children
│   ├── connection.js          # socket lifecycle: QR, auth persistence, backoff, signals
│   ├── handler.js             # messages.upsert pipeline: filter→parse→moderate→gate→dispatch
│   ├── message-parser.js      # text extraction, command parsing, mentions/quoted targets
│   ├── command-registry.js    # register/lookup commands + aliases, categories
│   ├── permissions.js         # group/admin/owner/bot-admin resolution (LID-safe)
│   ├── group-settings.js      # per-group JSON persistence, atomic writes, defaults
│   ├── rate-limiter.js        # sliding-window limiter + cooldown tracker
│   ├── utils/
│   │   ├── jid.js             # jidDecode/jidNormalizedUser/areJidsSameUser wrappers
│   │   ├── text.js            # URL extraction, domain whitelist check, template fill
│   │   ├── group.js           # participant/admin lookups against live metadata
│   │   └── message.js         # reply(), context builder, quoted-message reconstruction
│   ├── commands/
│   │   ├── register.js        # imports every command module, returns registry
│   │   ├── general/  ping alive menu owner groupinfo admins rules
│   │   ├── admin/    tagall antilink delete welcome goodbye kick promote demote group setname setdesc
│   │   └── ai/       ai
│   └── services/
│       ├── welcome-service.js    # group-participants.update → welcome/goodbye messages
│       ├── moderation-service.js # anti-link detection & enforcement
│       └── ai-service.js         # Ollama availability + chat completion (bounded)
├── data/                      # group-settings.json lives here (git-ignored)
├── auth/                      # Baileys session files (git-ignored, SENSITIVE)
└── tests/                     # node:test suites, fully mocked, offline
```

## 3. Module Responsibilities

| Module | Responsibility | Key exports |
|---|---|---|
| `index.js` | Bootstrap order, process-level guards, SIGINT/SIGTERM → `connection.shutdown()` | (runs) |
| `config.js` | Load+validate `.env`, normalize owner JID, freeze config | `config` |
| `logger.js` | Root pino logger, redaction paths, `createLogger(name)` | `logger`, `createLogger` |
| `connection.js` | **Only** module touching `makeWASocket`; QR rendering, cred persistence, reconnect policy, singleton guard, event wiring, shutdown | `startBot()`, `shutdownBot()`, `getCurrentSocket()` |
| `handler.js` | `messages.upsert` consumer: dedupe, filter, anti-link hook, parse, rate-limit, permission gates, dispatch, error isolation | `handleUpsert(sock, evt)`, `attachHandler(sock)` |
| `message-parser.js` | `extractText(msg)`, `parseCommand(text, prefix)`, `extractMentions(msg)`, `extractQuoted(msg)` | pure functions |
| `command-registry.js` | `register(cmd)`, `getCommand(name)`, `listByCategory()` — validates module shape at load | `CommandRegistry` class |
| `permissions.js` | LID-safe identity: `isGroupJid`, `resolveSender`, `isSenderAdmin`, `isBotAdmin`, `isOwner` (incl. PN→LID mapping lookup), `resolveTargets`, `evaluateAccess` | pure/async fns |
| `group-settings.js` | JSON store with atomic replace, corrupt-file recovery, per-group defaults | `GroupSettingsStore` class |
| `rate-limiter.js` | `RateLimiter.consume(key, limit, windowMs)`, `CooldownTracker` | classes |
| `utils/*` | Stateless helpers (JID math, URL regex, template substitution, ctx building) | pure fns |
| `commands/*` | One default-exported object per command (metadata + `execute(ctx)`) | `default` export |
| `services/*` | Long-lived behaviors not tied to a single command | fns/objects |

## 4. Command Module Contract

Every command file default-exports:

```js
export default {
  name: 'kick',              // canonical name (lowercase)
  aliases: ['remove'],       // alternative names
  category: 'admin',         // general | admin | ai
  description: '…',          // shown in .menu
  usage: '.kick @user',      // shown on misuse
  groupOnly: true,           // ─ gates evaluated centrally by handler.js ─
  adminOnly: true,           //   (sender must be group admin or owner)
  botAdminOnly: true,        //   (bot must be group admin)
  ownerOnly: false,
  cooldown: 5,               // seconds per user, 0 = none
  async execute(ctx) { … }   // ctx shape below
}
```

**Context object (`ctx`)** built by `utils/message.js`:

```js
{
  sock,                 // live WASocket
  message,              // raw WAMessage
  chatId, senderId,     // JIDs (senderId = participant in groups, remoteJid in DMs)
  senderAltId,          // paired PN/LID form from key.participantAlt / remoteJidAlt
  isGroup, groupMetadata, participants,
  isSenderAdmin, isBotAdmin, isOwner, isBot,
  command: { name, prefix, args, argText, raw },
  mentionedJid,         // string[] from contextInfo
  quoted,               // { key, content } | null — reconstructed from contextInfo
  reply(content),       // sendMessage to chat, quoted to the invoking message
  react(emoji),
  settings,             // GroupSettingsStore handle (groups only-safe accessors)
  config, logger
}
```

## 5. Connection State Machine

```text
        startBot() ──▶ LOADING_AUTH ──▶ CONNECTING ──qr──▶ WAITING_FOR_SCAN
                            │                │                    │
                            │                ├──open──▶ ONLINE ◀───┘ (scan)
                            │                │
                            │                └──close──▶ CLOSED ──code──┐
                            ▼                                           │
                         FAILED ◀──── attempts exhausted ◀── backoff ◀───┘
                            │              (logOut → straight to FAILED,
                            ▼               auth/ must be deleted manually)
```

- **Reconnect policy:** `loggedOut` (401) → permanent stop. `restartRequired` (515) → immediate restart. Anything else → exponential backoff `min(30s, 1s·2^n)` + ±25 % jitter, max **8** attempts, then stop with an operator-readable message.
- **Singleton guard:** module state `runtime = { sock, starting, shuttingDown }`; `startBot()` is a no-op when already starting/online; old socket listeners are removed before a new socket is created.
- **Shutdown:** `SIGINT`/`SIGTERM` → set flag (prevents reconnect), `sock.end(undefined)`, flush, `process.exit(0)`.

## 6. Data Model

### 6.1 `data/group-settings.json` (per group, atomic writes)

```jsonc
{
  "120363000000000000@g.us": {
    "welcome":   { "enabled": true,
                   "template": "Welcome @user to {group}! Please read the rules." },
    "goodbye":   { "enabled": false, "template": "Goodbye @user 👋" },
    "antilink":  { "enabled": true,
                   "allowedDomains": ["example.com"],
                   "warnMessage": "Links are not allowed here.",
                   "exemptAdmins": true },
    "rules":     "1. Be respectful…",
    "updatedAt": 1761024000000
  }
}
```

Writes: serialize → write `group-settings.json.tmp` → `fs.rename` over the real file.
Reads: missing/corrupt file → warn + start from `{}` (never crash).

### 6.2 Identity model (PN ↔ LID)

WhatsApp v7 identifies users with **two JID forms**: PN (`…@s.whatsapp.net`) and
LID (`…@lid`), plus device suffixes (`:2`). Rules enforced everywhere:

1. Never `split('@')`, never `===` on raw JIDs → always `jidDecode` / `areJidsSameUser`.
2. Sender resolution prefers `key.participant` (group) or `key.remoteJid` (DM) and keeps the paired alt from `participantAlt`/`remoteJidAlt`.
3. Admin/owner checks compare **both** forms against metadata participants (whose `id` may be a LID in v7).
4. Owner grant comes only from validated `BOT_OWNER_JID`; when configured as PN and the sender arrives as LID, `sock.signalRepository.lidMapping.getLIDForPN()` bridges the comparison (wrapped in try/catch — mapping is best-effort).

## 7. Message Pipeline (handler.js)

```text
messages.upsert (type==='notify')
  │  for each msg
  ├─ skip: no message / no key / fromMe / dedupe-hit / status@broadcast / newsletter
  ├─ skip: protocolMessage (and other non-text stubs after extractText returns '')
  ├─ moderation: checkAntiLink(ctx-lite)          ← errors logged, never thrown
  ├─ extractText → no text? skip
  ├─ parseCommand(prefix='.') → not a command? skip
  ├─ registry lookup → unknown command? skip (silent; prefix typo ≠ error)
  ├─ rate limit (per-user window + per-command cooldown) → friendly notice
  ├─ permission gates: groupOnly / adminOnly / botAdminOnly / ownerOnly
  │      failure → quoted reply "…" + audit log
  ├─ build ctx (lazy groupMetadata fetch with TTL cache)
  └─ cmd.execute(ctx) inside try/catch → on error: reply friendly message + log stack
```

`.tagall` additionally enforces a **per-group cooldown** (default 60 s) and a batch
size cap (mentions chunked ≤ 250 per message) to prevent abuse/spam loops.

## 8. Anti-Link Algorithm

```text
group msg with text/caption ─▶ antilink.enabled? ─no─▶ pass
   │ yes
   ├─ sender is owner / (exemptAdmins && sender is admin) ─▶ pass
   ├─ findUrls(text); all urls' domains ∈ allowedDomains (suffix match) ─▶ pass
   ├─ msg.id ∈ recentlyWarned? ─▶ pass (dedupe)
   ├─ bot is admin? ─▶ sendMessage({ delete: msg.key })   (catch → log)
   ├─ warnMessage configured? ─▶ send one warning (quoted), record msg.id
   └─ never kick, never ban
```

## 9. AI Integration (Ollama, optional)

```text
.ai <question>
  ├─ AI_ENABLED? ─no─▶ "AI is disabled."  (command hidden from .menu too)
  ├─ availability probe: GET  {base}/api/tags        (AbortSignal.timeout(5000))
  │     └─ model missing / unreachable → honest error, no fabricated answer
  ├─ per-user rate limit (AI_WINDOW/AI_LIMIT, stricter than commands)
  ├─ question trimmed to MAX_INPUT (2000 chars)
  └─ POST {base}/api/chat  { model, messages:[{role:'user',content:q}],
                             stream:false, options:{ num_predict: 512 } }
        └─ reply trimmed to MAX_OUTPUT (4000 chars)
```

Only the invoked question leaves the process. No history, no config, no credentials.
`ai-service.js` isolates the provider so an OpenAI-compatible adapter can replace it.

## 10. Security Model

| Threat | Control |
|---|---|
| Unauthorized moderation actions | Central gates in `handler.js`; targets resolved only from mentions/quoted metadata — never from user-supplied JID strings or serialized keys |
| Owner impersonation | Owner derived solely from validated env config; display names/message content never grant privileges |
| Spam / flooding | Per-user sliding-window limiter, per-command cooldowns, per-group `.tagall` cooldown + batch caps |
| Log leakage | pino redaction of `creds`, `key`, `token`, `Authorization`; no message bodies, no QR payloads logged |
| Session theft | `auth/` + `.env` + `data/*.json` git-ignored; README warns QR/session must never be shared |
| Code execution via chat text | No `eval`, no `child_process`, no dynamic `import()` of user-derived paths — commands are statically imported |
| Resource exhaustion | Bounded dedupe sets, metadata TTL cache, input/output length caps, AI timeouts |
| Accidental destructiveness | Anti-link deletes only (no kicks); every destructive command requires explicit human invocation + admin role |

## 11. Logging Events (structured, redacted)

`connection.open`, `connection.close` (+code, +reconnect decision), `connection.reconnect_attempt` (n/8, delay), `auth.qr_rendered` (boolean only), `command.executed` (name, chat type, latency), `command.denied` (name, reason, chat), `moderation.antilink_action` (group, action, msg id), `moderation.error`, `ai.unavailable` (reason), `settings.corrupt_reset`, `error.unhandled` (stack, redacted context), `shutdown.signal`.

## 12. Testing Strategy

Node's built-in `node:test` runner; **zero network, zero real WhatsApp.**

| Suite | Covers |
|---|---|
| `tests/parser.test.js` | Prefix parsing, aliases, args, invalid commands, wrapped-message text extraction, malformed messages (null message, missing key), mentions, quoted reconstruction |
| `tests/permissions.test.js` | Group detection, admin resolution with LID/PN + device suffixes, owner authorization (incl. negative: display-name spoof), bot-admin detection, missing quoted message |
| `tests/commands.test.js` | Registry lookup/aliasing, group-only enforcement, rate-limit windows, cooldowns, URL detection + allowed-domain logic, welcome/goodbye config toggles + template substitution, `.delete` key construction from quoted metadata, settings persistence (temp dir, atomic write, corrupt-file recovery) |

Mock strategy: a `makeFakeSock()` factory returning `sendMessage`/`groupMetadata`
j stubs recording calls; fabricated `GroupMetadata` fixtures with mixed LID/PN
participants; fabricated `WAMessage` fixtures with `contextInfo`.

## 13. Key Decisions

| Decision | Rationale |
|---|---|
| Static command imports (`commands/register.js`) over fs-scanning | Cross-platform (Windows path quirks), startup errors surface immediately, tree-shakeable clarity for beginners |
| QR via `connection.update` + `qrcode-terminal` (not `printQRInTerminal`) | v7 deprecates the config option; the event is the supported path |
| Own micro rate-limiter/TTL cache instead of extra deps | Fewer supply-chain surfaces; the logic is ~60 lines and testable |
| `ev.on(...)` handlers instead of `ev.process` | Simpler for beginners; each concern isolated; dedupe layer covers overlap risk |
| JSON file store for settings | PRD scope: single-process local bot; atomic writes + recovery documented; DB swap seam isolated in `GroupSettingsStore` |
| AI off by default + availability probe | Bot must never depend on Ollama being installed |
