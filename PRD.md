# PRD — WhatsApp AI Bot (Baileys v7)

**Version:** 1.0
**Status:** Approved for implementation
**Date:** 2026-10-21
**Stack:** Node.js ≥ 20 (ES Modules), `@whiskeysockets/baileys@7.0.0-rc14`

---

## 1. Problem Statement

Beginners who want a self-hosted WhatsApp bot today face two problems: most public
templates target Baileys v6 (whose APIs — `printQRInTerminal`, `isJidUser`, PN-only
JIDs — are removed or unsafe in v7), and most are monolithic single-file scripts that
mix connection handling, parsing, permissions, and business logic, making them
impossible to maintain or extend safely.

This project delivers a **complete, secure, modular, locally-runnable WhatsApp bot**
built exclusively against the verified Baileys v7 API, with group administration,
moderation, and an optional local AI command.

## 2. Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | Run locally with two commands | `npm install && npm start` works on a clean machine with Node ≥ 20 |
| G2 | Correct on Baileys v7 | No v6-only APIs; LID-safe identity handling everywhere; verified against installed package exports |
| G3 | Secure by default | Central authorization, rate limits, no secrets in logs/code, no destructive automation by default |
| G4 | Modular & beginner-readable | One responsibility per module; commands are self-contained files with metadata |
| G5 | Honest | Every documented feature is implemented and tested; nothing referenced by an import is missing |

## 3. Personas

- **P1 — Learner:** knows basic JavaScript, wants to study a correct modern bot codebase.
- **P2 — Group admin:** wants link moderation, welcome/goodbye, and member management without coding.
- **P3 — Operator:** runs the bot long-term on a home server or VPS; cares about stability, logs, and session safety.

## 4. Functional Requirements

### FR-1 Connection & Authentication
- FR-1.1 Authenticate via QR code rendered **only** in the local terminal (from the `connection.update` `qr` field; the deprecated `printQRInTerminal` option is NOT used).
- FR-1.2 Persist credentials + Signal keys via `useMultiFileAuthState` into `auth/` (git-ignored), wrapped with `makeCacheableSignalKeyStore`.
- FR-1.3 Reconnect after transient failures with exponential backoff + jitter; never reconnect after `DisconnectReason.loggedOut`; cap attempts and stop with a clear operator message.
- FR-1.4 Idempotent startup: at most one socket instance and one set of event handlers at any time; controlled shutdown on `SIGINT`/`SIGTERM`.
- FR-1.5 Log connection lifecycle; never log credentials, keys, or QR payloads.

### FR-2 Message Pipeline
- FR-2.1 Subscribe to `messages.upsert`, process `type: 'notify'` only; ignore history backfill, protocol messages, status/broadcast/newsletter chats, and the bot's own messages.
- FR-2.2 Deduplicate by message ID (bounded memory).
- FR-2.3 Extract text from `conversation`, `extendedTextMessage.text`, media captions, and wrapped messages (`ephemeralMessage`, `viewOnceMessage`, etc.) via `extractMessageContent`.
- FR-2.4 Parse `.prefix`, command name, arguments, and aliases via a single reusable parser (`message-parser.js`).
- FR-2.5 Build a reusable command **context** (socket, message, chat JID, sender JID(s), parsed command, group metadata, permission booleans, `reply()` helper).
- FR-2.6 Per-message error isolation: one failing command replies with a friendly error and never crashes the bot.
- FR-2.7 Central enforcement of group-only / admin-only / bot-admin-only / owner-only and per-user/per-group rate limits before execution.

### FR-3 General Commands
`.ping`, `.alive`, `.menu`/`.help`, `.owner`, `.groupinfo`, `.admins`, `.rules` (+ `.rules set|clear` for admins) — behavior exactly as specified in the build spec; `.alive` and `.menu` must never expose secrets, paths, or session data; `.menu` hides the AI command unless AI is enabled and reachable.

### FR-4 Group Administration Commands (admin-gated)
`.tagall` (batched, cooldown-limited, uses live metadata participants), `.antilink on|off|status|allow add|allow remove|allow list`, `.delete`/`.del` (quoted-message only, bot-permission verified, key built from real quoted metadata — never from user-serialized keys), `.welcome on|off|set <template>`, `.goodbye on|off|set <template>`, `.kick`, `.promote`, `.demote`, `.group open|close`, `.setname`, `.setdesc`.

### FR-5 Welcome / Goodbye
- FR-5.1 Listen to `group-participants.update`; handle multiple participants per event; `add` → welcome, `remove` (non-kick-by-bot contexts) → goodbye.
- FR-5.2 Per-group enable flag and template; placeholders `{user}` and `{group}` substituted safely; mentions rendered with real participant JIDs.
- FR-5.3 Duplicate-event suppression; graceful degradation when group metadata cannot be fetched.

### FR-6 Anti-Link Moderation
- FR-6.1 Per-group on/off, independent configuration; allowed-domain whitelist per group.
- FR-6.2 Detect URLs in text and media captions; admins and the configured owner are exempt (configurable skip).
- FR-6.3 Delete the offending message **only** when the bot is group admin; post one short warning; never kick/ban automatically; never warn twice for the same message; failures are caught and logged, not thrown.

### FR-7 Configuration & Persistence
- FR-7.1 `.env`-driven config validated at startup with actionable error messages; `.env.example` ships placeholder values only.
- FR-7.2 Per-group settings persisted to `data/group-settings.json` with atomic write (temp file + rename); missing/corrupt file recovers to defaults with a warning.
- FR-7.3 Owner identity normalized at startup (digits-only → PN JID; full JIDs preserved); owner grants are derived **only** from this config, never from display names or message content.

### FR-8 Optional AI (Ollama)
- FR-8.1 Disabled by default (`AI_ENABLED=false`); the bot is fully functional without it.
- FR-8.2 When enabled: probe `GET {AI_BASE_URL}/api/tags` for availability + model presence; `POST /api/chat` with timeouts and bounded input/output; per-user rate limit.
- FR-8.3 Only the explicitly invoked question is sent — never chat history, never secrets, never session data. Failures return honest error messages; no fabricated responses.
- FR-8.4 Provider-agnostic service module so another OpenAI-compatible local endpoint can be added later.

## 5. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | Central authorization; input length caps; mention limits; no shell/eval on message text; no auth endpoints; sensitive-data redaction in logs; `.gitignore` covers `auth/`, `.env`, `data/*.json`, `logs/` |
| Reliability | Per-message and per-event try/catch; reconnect backoff with jitter; graceful SIGINT/SIGTERM; settings corruption recovery |
| Performance | Group-metadata caching with short TTL; O(1) command dispatch; bounded dedupe caches; batched `.tagall` |
| Observability | Structured `pino` logs: connection open/close, reconnects, command execution (name + chat type, no content), permission denials, moderation actions, AI availability, exceptions |
| Compliance | No bulk DM, no spam loops, no auto-destructive moderation; usage aligned with WhatsApp ToS; README carries the risk disclaimer |
| Portability | Windows/Linux/macOS; no absolute paths; no native build dependencies |

## 6. Explicit Non-Goals

- Multi-process/multi-instance deployments (JSON store is single-process by design; documented).
- Database-backed auth state (isolation seam documented for future swap).
- Message history retention, media downloads, payments, newsletter/broadcast features.
- Pairing-code login over the network (QR only, local terminal only, for this version).

## 7. Acceptance Criteria

1. `npm install && npm start` on Node ≥ 20 prints a QR code in the terminal and connects after scanning.
2. Restarting the bot reuses `auth/` and connects without a new QR scan.
3. `npm test` passes with zero network access and no real WhatsApp session (all suites: parser, permissions, commands, URL logic, rate limits, settings persistence).
4. `node --check` passes on every source file; every dynamic/static import resolves.
5. Every command in the README exists in code, and every code command is in the README.
6. Denying any permission path produces a user-facing message and an audit log line — never a silent failure or a thrown crash.
7. Deleting `data/group-settings.json` mid-run (or corrupting it) does not crash the bot.

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Baileys RC instability | Version pinned exactly; API verified against the installed package's exports/types before delivery |
| WhatsApp bans from automation | No spam loops, no ACK abuse (v7 default), rate limits, human-triggered actions only |
| Session theft | `auth/` git-ignored + README warning; QR never leaves the terminal |
| LID migration breaking identity checks | All identity logic uses `jidDecode`/`areJidsSameUser`/alt-JID fields, plus PN↔LID mapping lookup; no `@s.whatsapp.net` string assumptions |
| Ollama absent | AI off by default; availability probe; graceful user-facing error |

## 9. Deliverables

Complete project tree per Architecture §3, automated tests, `README.md`,
`.env.example`, `.gitignore`, this PRD, and `ARCHITECTURE.md`.
