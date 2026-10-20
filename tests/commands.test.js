/**
 * tests/commands.test.js — registry, dispatch pipeline, rate limits,
 * anti-link moderation, welcome/goodbye behavior, and settings persistence.
 * Everything is mocked: no network, no real WhatsApp session.
 */
process.env.LOG_LEVEL = 'silent';

const { test, beforeEach } = await import('node:test');
const assert = await import('node:assert/strict');
const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const path = await import('node:path');

const { CommandRegistry, InvalidCommandError } = await import('../src/command-registry.js');
const { registry, handleUpsert, attachHandler, resetPipelineState } = await import('../src/handler.js');
const { RateLimiter, CooldownTracker, RecentSet } = await import('../src/rate-limiter.js');
const { GroupSettingsStore, defaultGroupSettings } = await import('../src/group-settings.js');
const { checkAntiLink, _resetModerationState, setModerationStore } = await import(
  '../src/services/moderation-service.js'
);
const { _announceForTests: announce } = await import('../src/services/welcome-service.js');
const { invalidateMetadata } = await import('../src/services/metadata-cache.js');
const { findUrls, isDomainAllowed, fillTemplate, allUrlsAllowed } = await import('../src/utils/text.js');
const { config } = await import('../src/config.js');

// ── Mock helpers ───────────────────────────────────────────────────────────

/** Minimal WASocket stand-in that records everything sent. */
function makeFakeSock({ me, metadata = null } = {}) {
  const sent = [];
  const handlers = {};
  return {
    sent,
    user: me ?? { id: '9998887776666:0@s.whatsapp.net', lid: '5554443332222@lid' },
    ev: {
      on: (evt, cb) => {
        handlers[evt] = cb;
      },
      removeAllListeners: () => {},
    },
    handlers,
    async groupMetadata() {
      if (metadata) return metadata;
      throw new Error('group not found');
    },
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { remoteJid: jid, id: `OUT${sent.length}`, fromMe: true } };
    },
    async sendPresenceUpdate() {},
  };
}

/** Group fixture with LID participants: one admin, one regular member. */
function makeMetadata({ botIsAdmin = true } = {}) {
  return {
    id: '120363000000000000@g.us',
    subject: 'Fixture Group',
    participants: [
      { id: '1111111111111@lid', phoneNumber: '15550000001@s.whatsapp.net', admin: 'superadmin' },
      { id: '3333333333333@lid', phoneNumber: '15550000003@s.whatsapp.net', admin: null },
      botIsAdmin
        ? { id: '5554443332222@lid', phoneNumber: '9998887776666@s.whatsapp.net', admin: 'admin' }
        : { id: '7777777777777@lid', phoneNumber: '15550000007@s.whatsapp.net', admin: null },
    ],
  };
}

function groupMessage({ id = 'MSG1', text, sender = '3333333333333:3@lid' } = {}) {
  return {
    key: { remoteJid: '120363000000000000@g.us', id, participant: sender, fromMe: false },
    message: { conversation: text },
  };
}

let tempDataDir;
let store;

beforeEach(async () => {
  resetPipelineState();
  _resetModerationState();
  invalidateMetadata(); // group metadata is cached module-wide — clear between tests
  tempDataDir = await mkdtemp(path.join(tmpdir(), 'wa-bot-test-'));
  store = await new GroupSettingsStore(tempDataDir).init();
  setModerationStore(store);
});

// ── Registry ───────────────────────────────────────────────────────────────

test('registry: all bot commands are registered with valid metadata', () => {
  assert.ok(registry.size >= 19, `expected >=19 commands, got ${registry.size}`);
  for (const command of registry.commands) {
    assert.match(command.name, /^[a-z0-9][a-z0-9_-]*$/);
    assert.ok(command.description.length > 0);
    assert.equal(typeof command.execute, 'function');
  }
});

test('registry: aliases resolve to their canonical command', () => {
  assert.equal(registry.get('p').name, 'ping');
  assert.equal(registry.get('del').name, 'delete');
  assert.equal(registry.get('help').name, 'menu');
  assert.equal(registry.get('PING').name, 'ping'); // case-insensitive
  assert.equal(registry.get('nonexistent'), null);
});

test('registry: rejects invalid modules and duplicates', () => {
  const reg = new CommandRegistry();
  assert.throws(() => reg.register(null), InvalidCommandError);
  assert.throws(() => reg.register({ name: 'x' }), InvalidCommandError); // missing fields
  assert.throws(
    () => reg.register({ name: 'x', category: 'general', description: 'd', execute: 'not-a-fn' }),
    InvalidCommandError
  );
  const cmd = { name: 'x', category: 'general', description: 'd', execute: () => {} };
  reg.register(cmd);
  assert.throws(() => reg.register({ ...cmd, aliases: ['x'] }), InvalidCommandError); // alias clash
  assert.throws(() => reg.register(cmd), InvalidCommandError); // duplicate name
});

// ── Pipeline dispatch (end-to-end with a fake socket) ─────────────────────

test('pipeline: .ping dispatches and replies Pong', async () => {
  const sock = makeFakeSock();
  attachHandler(sock, { settingsStore: store });
  await handleUpsert(sock, {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: '15551234567@s.whatsapp.net', id: 'P1', fromMe: false },
        message: { conversation: '.ping' },
      },
    ],
  });
  assert.ok(sock.sent.length >= 1, 'bot should have sent at least one message');
  assert.match(sock.sent.map((s) => s.content.text ?? '').join('\n'), /Pong/);
});

test('pipeline: unknown commands and normal chat stay silent', async () => {
  const sock = makeFakeSock();
  attachHandler(sock, { settingsStore: store });
  await handleUpsert(sock, {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: '15551234567@s.whatsapp.net', id: 'U1', fromMe: false },
        message: { conversation: '.this-command-does-not-exist' },
      },
      {
        key: { remoteJid: '15551234567@s.whatsapp.net', id: 'U2', fromMe: false },
        message: { conversation: 'just a normal message' },
      },
    ],
  });
  assert.equal(sock.sent.length, 0);
});

test('pipeline: own messages, history backfill, and duplicates are ignored', async () => {
  const sock = makeFakeSock();
  attachHandler(sock, { settingsStore: store });

  // fromMe
  await handleUpsert(sock, {
    type: 'notify',
    messages: [
      { key: { remoteJid: '15551234567@s.whatsapp.net', id: 'D0', fromMe: true }, message: { conversation: '.ping' } },
    ],
  });
  // history backfill (type 'append')
  await handleUpsert(sock, {
    type: 'append',
    messages: [
      { key: { remoteJid: '15551234567@s.whatsapp.net', id: 'D1', fromMe: false }, message: { conversation: '.ping' } },
    ],
  });
  assert.equal(sock.sent.length, 0);

  // real message → processed once; exact duplicate → deduplicated
  const msg = {
    key: { remoteJid: '15551234567@s.whatsapp.net', id: 'D2', fromMe: false },
    message: { conversation: '.ping' },
  };
  await handleUpsert(sock, { type: 'notify', messages: [msg] });
  const afterFirst = sock.sent.length;
  assert.ok(afterFirst >= 1);
  await handleUpsert(sock, { type: 'notify', messages: [{ ...msg }] });
  assert.equal(sock.sent.length, afterFirst, 'duplicate message must not be processed twice');
});

test('pipeline: group-only command in DM gets a permission notice', async () => {
  const sock = makeFakeSock();
  attachHandler(sock, { settingsStore: store });
  await handleUpsert(sock, {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: '15551234567@s.whatsapp.net', id: 'G1', fromMe: false },
        message: { conversation: '.kick @someone' },
      },
    ],
  });
  assert.equal(sock.sent.length, 1);
  assert.match(sock.sent[0].content.text, /group/i);
});

test('pipeline: non-admin cannot run .tagall in a group', async () => {
  const sock = makeFakeSock({ metadata: makeMetadata() });
  attachHandler(sock, { settingsStore: store });
  await handleUpsert(sock, { type: 'notify', messages: [groupMessage({ id: 'T1', text: '.tagall hello' })] });
  assert.equal(sock.sent.length, 1);
  assert.match(sock.sent[0].content.text, /administrators/i);
});

test('pipeline: malformed messages never crash the handler', async () => {
  const sock = makeFakeSock();
  attachHandler(sock, { settingsStore: store });
  await handleUpsert(sock, {
    type: 'notify',
    messages: [null, {}, { key: {} }, { key: { remoteJid: 'x@s.whatsapp.net' } }, 'garbage'],
  });
  assert.equal(sock.sent.length, 0);
});

// ── .menu hides AI when disabled ───────────────────────────────────────────

test('menu: hides the AI command when AI is disabled', async () => {
  const menu = registry.get('menu');
  const replies = [];
  const sock = makeFakeSock();
  await menu.execute({
    sock,
    chatId: 'x@s.whatsapp.net',
    message: { key: { remoteJid: 'x@s.whatsapp.net' } },
    config,
    registry,
    reply: async (t) => replies.push(t),
  });
  const text = replies.join('\n');
  assert.match(text, /\.ping/);
  if (!config.ai.enabled) {
    assert.doesNotMatch(text, /\.ai\b/, 'AI command must be hidden while disabled');
  }
});

// ── Rate limits & cooldowns ────────────────────────────────────────────────

test('rate limiter: blocks beyond the limit and recovers after the window', () => {
  const limiter = new RateLimiter(3, 60);
  assert.equal(limiter.consume('user1').allowed, true);
  assert.equal(limiter.consume('user1').allowed, true);
  const third = limiter.consume('user1');
  assert.equal(third.allowed, true);
  const fourth = limiter.consume('user1');
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.retryAfterMs > 0);
  // Independent key is unaffected.
  assert.equal(limiter.consume('user2').allowed, true);
  // Simulate window expiry → allowed again.
  limiter.hits.set('user1', [Date.now() - 120_000]);
  assert.equal(limiter.consume('user1').allowed, true);
});

test('rate limiter: pipeline blocks flooders with a notice', async () => {
  const sock = makeFakeSock();
  attachHandler(sock, { settingsStore: store });
  // config default: 8 commands / 10 s per user
  for (let i = 0; i < 12; i += 1) {
    await handleUpsert(sock, {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '15551234567@s.whatsapp.net', id: `F${i}`, fromMe: false },
          message: { conversation: '.ping' },
        },
      ],
    });
  }
  const floodNotices = sock.sent.filter((s) => /too quickly/i.test(s.content.text ?? ''));
  assert.ok(floodNotices.length >= 1, 'flooder should receive a rate-limit notice');
});

test('cooldown tracker: enforces and releases cooldowns', () => {
  const tracker = new CooldownTracker();
  assert.equal(tracker.checkAndStart('k', 30).onCooldown, false);
  const second = tracker.checkAndStart('k', 30);
  assert.equal(second.onCooldown, true);
  assert.ok(second.remainingSec > 0);
  tracker.reset('k');
  assert.equal(tracker.checkAndStart('k', 30).onCooldown, false);
});

test('recent set: deduplicates with eviction support', () => {
  const set = new RecentSet(60_000, 3);
  assert.equal(set.has('a'), false);
  assert.equal(set.has('a'), true);
  assert.equal(set.has('b'), false);
  // Fill beyond capacity — must not throw and must stay bounded.
  set.add('c');
  set.add('d');
  set.add('e');
  assert.ok(set.size <= 3);
});

// ── URL detection & allowed domains ────────────────────────────────────────

test('findUrls: detects http(s), ftp, www and bare domains; skips emails', () => {
  const text = 'see https://example.com/a?b=1 and www.test.org, also plain example.net; mail me at user@example.com';
  const urls = findUrls(text);
  assert.ok(urls.some((u) => u.startsWith('https://example.com')));
  assert.ok(urls.some((u) => u.startsWith('www.test.org')));
  assert.ok(urls.some((u) => u.startsWith('example.net')));
  assert.ok(!urls.some((u) => u.includes('user@example.com')), 'emails must not count as links');
  assert.deepEqual(findUrls('no links here'), []);
  assert.deepEqual(findUrls(''), []);
  assert.deepEqual(findUrls(null), []);
});

test('isDomainAllowed: suffix matching is label-safe', () => {
  assert.equal(isDomainAllowed('https://example.com/x', ['example.com']), true);
  assert.equal(isDomainAllowed('https://sub.example.com/x', ['example.com']), true);
  assert.equal(isDomainAllowed('http://www.example.com', ['example.com']), true);
  assert.equal(isDomainAllowed('https://notexample.com', ['example.com']), false);
  assert.equal(isDomainAllowed('https://example.com.evil.net', ['example.com']), false);
  assert.equal(isDomainAllowed('https://example.com', []), false);
});

test('allUrlsAllowed: true only when every URL is whitelisted', () => {
  assert.equal(allUrlsAllowed('no links', ['example.com']), true);
  assert.equal(allUrlsAllowed('https://docs.example.com/guide', ['example.com']), true);
  assert.equal(
    allUrlsAllowed('https://docs.example.com and https://spam.io', ['example.com']),
    false
  );
});

// ── Anti-link moderation ───────────────────────────────────────────────────

test('antilink: does nothing when disabled', async () => {
  const sock = makeFakeSock({ metadata: makeMetadata() });
  const result = await checkAntiLink(sock, groupMessage({ text: 'https://spam.io' }), 'https://spam.io', store);
  assert.equal(result.action, 'skipped');
  assert.equal(sock.sent.length, 0);
});

test('antilink: deletes violating message when the bot is an admin', async () => {
  await store.update('120363000000000000@g.us', { antilink: { enabled: true } });
  const sock = makeFakeSock({ metadata: makeMetadata({ botIsAdmin: true }) });
  const msg = groupMessage({ id: 'L1', text: 'visit https://spam.io now' });
  const result = await checkAntiLink(sock, msg, 'visit https://spam.io now', store);
  assert.equal(result.action, 'deleted');
  // First action must be the delete using the ORIGINAL WhatsApp key.
  assert.ok(sock.sent[0].content.delete, 'delete payload expected');
  assert.deepEqual(sock.sent[0].content.delete, msg.key);
  // A warning is sent too.
  assert.ok(sock.sent.some((s) => /not allowed/i.test(s.content.text ?? '')));
});

test('antilink: never repeats actions for the same message', async () => {
  await store.update('120363000000000000@g.us', { antilink: { enabled: true } });
  const sock = makeFakeSock({ metadata: makeMetadata() });
  const msg = groupMessage({ id: 'L2', text: 'https://spam.io' });
  await checkAntiLink(sock, msg, 'https://spam.io', store);
  const sentAfterFirst = sock.sent.length;
  const second = await checkAntiLink(sock, msg, 'https://spam.io', store);
  assert.equal(second.action, 'duplicate');
  assert.equal(sock.sent.length, sentAfterFirst);
});

test('antilink: allowed domains pass untouched', async () => {
  await store.update('120363000000000000@g.us', {
    antilink: { enabled: true, allowedDomains: ['good.com'] },
  });
  const sock = makeFakeSock({ metadata: makeMetadata() });
  const result = await checkAntiLink(
    sock,
    groupMessage({ text: 'https://sub.good.com/page' }),
    'https://sub.good.com/page',
    store
  );
  assert.equal(result.action, 'allowed');
  assert.equal(sock.sent.length, 0);
});

test('antilink: admins are exempt by default', async () => {
  await store.update('120363000000000000@g.us', { antilink: { enabled: true } });
  const sock = makeFakeSock({ metadata: makeMetadata() });
  const result = await checkAntiLink(
    sock,
    groupMessage({ sender: '1111111111111:1@lid', text: 'https://spam.io' }),
    'https://spam.io',
    store
  );
  assert.equal(result.action, 'exempt');
  assert.equal(result.reason, 'admin');
});

test('antilink: warns (without delete) when the bot is NOT an admin', async () => {
  await store.update('120363000000000000@g.us', { antilink: { enabled: true } });
  const sock = makeFakeSock({ metadata: makeMetadata({ botIsAdmin: false }) });
  const result = await checkAntiLink(sock, groupMessage({ id: 'L3', text: 'https://spam.io' }), 'https://spam.io', store);
  assert.equal(result.action, 'warned');
  assert.ok(sock.sent.every((s) => !s.content.delete), 'must not attempt a delete without admin rights');
  assert.match(sock.sent[0].content.text, /not an admin/i);
});

// ── Welcome / goodbye ──────────────────────────────────────────────────────

test('welcome/goodbye: config toggles and template rendering', async () => {
  const groupId = '120363000000000000@g.us';
  assert.equal(defaultGroupSettings().welcome.enabled, false);

  await store.update(groupId, {
    welcome: { enabled: true, template: 'Welcome {user} to {group}!' },
    goodbye: { enabled: true, template: 'Bye {user} from {group}' },
  });
  const settings = store.get(groupId);
  assert.equal(settings.welcome.enabled, true);
  assert.equal(settings.goodbye.enabled, true);

  const sock = makeFakeSock({ metadata: makeMetadata() });
  const sent1 = await announce(sock, store, groupId, '3333333333333:3@lid', 'welcome');
  assert.equal(sent1, 'sent');
  const text = sock.sent[0].content.text;
  assert.match(text, /@3333333333333/);
  assert.match(text, /Fixture Group/);
  assert.deepEqual(sock.sent[0].content.mentions, ['3333333333333@lid']);

  // Duplicate event → suppressed.
  assert.equal(await announce(sock, store, groupId, '3333333333333:3@lid', 'welcome'), 'duplicate');

  // Goodbye for another participant works independently.
  assert.equal(await announce(sock, store, groupId, '8888888888888@lid', 'goodbye'), 'sent');
  assert.match(sock.sent[1].content.text, /Bye @8888888888888/);
});

test('welcome/goodbye: disabled features announce nothing', async () => {
  const sock = makeFakeSock({ metadata: makeMetadata() });
  assert.equal(await announce(sock, store, 'g@g.us', 'x@lid', 'welcome'), 'disabled');
  assert.equal(sock.sent.length, 0);
});

test('welcome: missing group metadata degrades to a fallback name', async () => {
  await store.update('120363000000000000@g.us', { welcome: { enabled: true, template: 'Hi {user} in {group}' } });
  const sock = makeFakeSock({ metadata: null }); // groupMetadata() throws
  const result = await announce(sock, store, '120363000000000000@g.us', '9999999999999@lid', 'welcome');
  assert.equal(result, 'sent');
  assert.match(sock.sent[0].content.text, /this group/);
  assert.match(sock.sent[0].content.text, /@9999999999999/);
});

test('templates: unknown placeholders survive, values are bounded', () => {
  assert.equal(fillTemplate('Hi {user} in {group}', { user: '@x', group: 'G' }), 'Hi @x in G');
  assert.equal(fillTemplate('Hi {unknown}', {}), 'Hi {unknown}');
  assert.equal(fillTemplate('{user}', { user: 'a'.repeat(500) }, 10), 'a'.repeat(10));
  assert.equal(fillTemplate('Hi {user}', { user: 'a'.repeat(500) }, 10), `Hi ${'a'.repeat(10)}`);
  assert.equal(fillTemplate(null, {}), '');
});

// ── .delete command behavior ───────────────────────────────────────────────

test('delete command: requires a quoted message and uses only its real key', async () => {
  const del = registry.get('delete');
  const sock = makeFakeSock();
  const replies = [];
  const baseCtx = {
    sock,
    chatId: '120363000000000000@g.us',
    config,
    logger: { warn: () => {} },
    react: async () => {},
    reply: async (t) => replies.push(t),
  };

  // No quote → helpful error, no delete attempted.
  await del.execute({ ...baseCtx, quoted: null });
  assert.match(replies[0], /reply/i);
  assert.equal(sock.sent.length, 0);

  // With quote → delete uses EXACTLY the WhatsApp-provided key.
  const quoted = {
    key: { remoteJid: '120363000000000000@g.us', id: 'REALID123', participant: '3333333333333@lid', fromMe: false },
    content: { conversation: 'spam' },
  };
  await del.execute({ ...baseCtx, quoted });
  assert.deepEqual(sock.sent[0].content, { delete: quoted.key });
});

// ── Settings persistence ───────────────────────────────────────────────────

test('settings: updates persist atomically and reload in a new instance', async () => {
  await store.update('g@g.us', { rules: 'No spam', antilink: { enabled: true } });

  // File is valid JSON on disk (atomic write completed).
  const raw = await readFile(path.join(tempDataDir, 'group-settings.json'), 'utf8');
  assert.equal(JSON.parse(raw)['g@g.us'].rules, 'No spam');

  // A fresh instance reads the same data back.
  const reloaded = await new GroupSettingsStore(tempDataDir).init();
  const settings = reloaded.get('g@g.us');
  assert.equal(settings.rules, 'No spam');
  assert.equal(settings.antilink.enabled, true);
});

test('settings: unknown groups get full defaults', () => {
  const settings = store.get('never-seen-before@g.us');
  assert.deepEqual(settings, defaultGroupSettings());
});

test('settings: corrupt file recovers to defaults without crashing', async () => {
  await writeFile(path.join(tempDataDir, 'group-settings.json'), '{ not valid json !!!', 'utf8');
  const recovered = await new GroupSettingsStore(tempDataDir).init();
  assert.deepEqual(recovered.get('g@g.us'), defaultGroupSettings());
  // And it can keep working afterwards.
  await recovered.update('g@g.us', { rules: 'fresh start' });
  assert.equal(recovered.get('g@g.us').rules, 'fresh start');
});

test('settings: missing file starts empty (first run)', async () => {
  const emptyDir = await mkdtemp(path.join(tmpdir(), 'wa-bot-empty-'));
  const fresh = await new GroupSettingsStore(emptyDir).init();
  assert.deepEqual(fresh.get('g@g.us'), defaultGroupSettings());
});
