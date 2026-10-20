/**
 * tests/permissions.test.js — identity and authorization with LID/PN duality,
 * device suffixes, owner spoofing resistance, and quoted-target rules.
 * No network, no real WhatsApp session.
 */
process.env.LOG_LEVEL = 'silent';

const { test } = await import('node:test');
const assert = await import('node:assert/strict');

const {
  isGroup,
  resolveSender,
  isGroupAdmin,
  isBotGroupAdmin,
  isOwner,
  resolveTargets,
  hasQuoted,
  evaluateAccess,
} = await import('../src/permissions.js');

// ── Fixtures ───────────────────────────────────────────────────────────────

/** v7-style group metadata: participants carry LIDs with paired PN info. */
const metadata = {
  id: '120363000000000000@g.us',
  subject: 'Test Group',
  participants: [
    { id: '1111111111111@lid', lid: '1111111111111@lid', phoneNumber: '15550000001@s.whatsapp.net', admin: 'superadmin' },
    { id: '2222222222222@lid', lid: '2222222222222@lid', phoneNumber: '15550000002@s.whatsapp.net', admin: 'admin' },
    { id: '3333333333333@lid', lid: '3333333333333@lid', phoneNumber: '15550000003@s.whatsapp.net', admin: null },
  ],
};

const fakeConfig = (ownerJid) => Object.freeze({ ownerJid });

// ── Group detection ────────────────────────────────────────────────────────

test('isGroup: recognizes group JIDs only', () => {
  assert.equal(isGroup('120363000000000000@g.us'), true);
  assert.equal(isGroup('15551234567@s.whatsapp.net'), false);
  assert.equal(isGroup('123456789012345@lid'), false);
  assert.equal(isGroup(null), false);
});

// ── Sender resolution ──────────────────────────────────────────────────────

test('resolveSender: group messages use participant (with alt form)', () => {
  const sender = resolveSender({
    key: {
      remoteJid: '120363000000000000@g.us',
      participant: '1111111111111@lid',
      participantAlt: '15550000001@s.whatsapp.net',
    },
  });
  assert.equal(sender.id, '1111111111111@lid');
  assert.equal(sender.altId, '15550000001@s.whatsapp.net');
});

test('resolveSender: DMs use remoteJid', () => {
  const sender = resolveSender({ key: { remoteJid: '15551234567@s.whatsapp.net' } });
  assert.equal(sender.id, '15551234567@s.whatsapp.net');
  assert.equal(sender.altId, null);
});

test('resolveSender: malformed key yields null id', () => {
  assert.equal(resolveSender(null).id, null);
  assert.equal(resolveSender({ key: {} }).id, null);
});

// ── Admin checks (LID-safe) ────────────────────────────────────────────────

test('isGroupAdmin: LID participant matched by LID sender', () => {
  assert.equal(isGroupAdmin(metadata, '1111111111111@lid'), true);
  assert.equal(isGroupAdmin(metadata, '2222222222222@lid'), true);
});

test('isGroupAdmin: PN form also resolves (paired phoneNumber field)', () => {
  assert.equal(isGroupAdmin(metadata, '15550000001@s.whatsapp.net'), true);
});

test('isGroupAdmin: device suffix is tolerated', () => {
  assert.equal(isGroupAdmin(metadata, '1111111111111:12@lid'), true);
});

test('isGroupAdmin: regular member is not an admin', () => {
  assert.equal(isGroupAdmin(metadata, '3333333333333@lid'), false);
});

test('isGroupAdmin: alt-form sender resolves via altId parameter', () => {
  // Sender arrives by PN, group stores LIDs — altId bridges nothing needed
  // because phoneNumber pairing handles it, but ensure both params accepted:
  assert.equal(isGroupAdmin(metadata, '15550000002@s.whatsapp.net', null), true);
});

test('isGroupAdmin: unknown user and empty metadata are false', () => {
  assert.equal(isGroupAdmin(metadata, '9999999999999@lid'), false);
  assert.equal(isGroupAdmin(null, '1111111111111@lid'), false);
  assert.equal(isGroupAdmin(metadata, null), false);
});

test('isBotGroupAdmin: checks all bot forms', () => {
  assert.equal(isBotGroupAdmin(metadata, ['1111111111111@lid']), true);
  assert.equal(isBotGroupAdmin(metadata, ['3333333333333@lid']), false);
  assert.equal(isBotGroupAdmin(metadata, []), false);
  assert.equal(isBotGroupAdmin(null, ['1111111111111@lid']), false);
});

// ── Owner authorization (spoof-proof) ──────────────────────────────────────

test('isOwner: configured owner JID matches sender directly', async () => {
  const sock = {}; // no signal repository — direct comparison path
  assert.equal(
    await isOwner(sock, ['15551234567@s.whatsapp.net'], fakeConfig('15551234567@s.whatsapp.net')),
    true
  );
});

test('isOwner: PN↔LID bridging via the signal mapping store', async () => {
  const sock = {
    signalRepository: {
      lidMapping: {
        getLIDForPN: async (pn) =>
          pn === '15551234567@s.whatsapp.net' ? '98765432109876@lid' : null,
        getPNForLID: async () => null,
      },
    },
  };
  // Owner configured by PN, message arrives addressed by LID → still owner.
  assert.equal(
    await isOwner(sock, ['98765432109876@lid'], fakeConfig('15551234567@s.whatsapp.net')),
    true
  );
});

test('isOwner: broken mapping store falls back gracefully (no throw)', async () => {
  const sock = {
    signalRepository: {
      lidMapping: {
        getLIDForPN: async () => {
          throw new Error('mapping unavailable');
        },
      },
    },
  };
  assert.equal(
    await isOwner(sock, ['98765432109876@lid'], fakeConfig('15551234567@s.whatsapp.net')),
    false
  );
});

test('isOwner: random user is never the owner', async () => {
  assert.equal(
    await isOwner({}, ['15559999999@s.whatsapp.net'], fakeConfig('15551234567@s.whatsapp.net')),
    false
  );
});

test('isOwner: no configured owner → nobody is owner', async () => {
  assert.equal(await isOwner({}, ['15551234567@s.whatsapp.net'], fakeConfig(null)), false);
});

test('isOwner: display names and message content can never grant ownership', async () => {
  // The API only accepts JID forms — there is no "name" path to abuse.
  assert.equal(await isOwner({}, [], fakeConfig('15551234567@s.whatsapp.net')), false);
  assert.equal(
    await isOwner({}, ['Bot Owner'], fakeConfig('15551234567@s.whatsapp.net')),
    false
  );
});

// ── Targets & quoted ───────────────────────────────────────────────────────

test('resolveTargets: mentions win, reply used as fallback', () => {
  const fromMentions = resolveTargets({ mentionedJid: ['123@lid'] });
  assert.deepEqual(fromMentions, [{ jid: '123@lid', source: 'mention' }]);

  const fromReply = resolveTargets({ mentionedJid: [], quoted: { participant: '456@lid' } });
  assert.deepEqual(fromReply, [{ jid: '456@lid', source: 'reply' }]);

  assert.deepEqual(resolveTargets({ mentionedJid: [], quoted: null }), []);
});

test('hasQuoted: detects missing quoted message', () => {
  assert.equal(hasQuoted(null), false);
  assert.equal(hasQuoted(undefined), false);
  assert.equal(hasQuoted({ key: { id: null } }), false);
  assert.equal(hasQuoted({ key: { id: 'ABC' } }), true);
});

// ── Central access gate ────────────────────────────────────────────────────

const baseCtx = (overrides = {}) => ({
  isGroup: true,
  isSenderAdmin: false,
  isBotAdmin: true,
  isOwner: false,
  config: { ownerJid: null },
  ...overrides,
});

test('evaluateAccess: group-only command denied in DMs', async () => {
  const command = { name: 'kick', groupOnly: true };
  const result = await evaluateAccess(baseCtx({ isGroup: false }), command, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'group_only');
});

test('evaluateAccess: admin-only denied for regular members', async () => {
  const command = { name: 'kick', adminOnly: true };
  const result = await evaluateAccess(baseCtx(), command, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'admin_only');
});

test('evaluateAccess: admin-only allowed for admins and for the owner', async () => {
  const command = { name: 'kick', adminOnly: true };
  assert.equal((await evaluateAccess(baseCtx({ isSenderAdmin: true }), command, {})).ok, true);
  assert.equal((await evaluateAccess(baseCtx({ isOwner: true }), command, {})).ok, true);
});

test('evaluateAccess: bot-admin-only denied when the bot is not an admin', async () => {
  const command = { name: 'delete', adminOnly: true, botAdminOnly: true };
  const result = await evaluateAccess(baseCtx({ isSenderAdmin: true, isBotAdmin: false }), command, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bot_admin_only');
});

test('evaluateAccess: owner-only denied for everyone but the owner', async () => {
  const command = { name: 'broadcast', ownerOnly: true };
  assert.equal((await evaluateAccess(baseCtx(), command, {})).ok, false);
  assert.equal((await evaluateAccess(baseCtx({ isOwner: true }), command, {})).ok, true);
});

test('evaluateAccess: plain public commands pass for anyone', async () => {
  const command = { name: 'ping' };
  assert.equal((await evaluateAccess(baseCtx(), command, {})).ok, true);
});
