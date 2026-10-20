/**
 * tests/parser.test.js — message parsing: text extraction, command parsing,
 * mentions, quoted reconstruction, and malformed-message resilience.
 * No network, no real WhatsApp session.
 */
process.env.LOG_LEVEL = 'silent';

const { test } = await import('node:test');
const assert = await import('node:assert/strict');

const {
  extractText,
  parseCommand,
  extractMentions,
  extractQuoted,
  isProcessableMessage,
  isProtocolMessage,
} = await import('../src/message-parser.js');

// ── Command parsing ────────────────────────────────────────────────────────

test('parseCommand: basic command with prefix', () => {
  const parsed = parseCommand('.ping', '.');
  assert.deepEqual(parsed, { prefix: '.', name: 'ping', args: [], argText: '', raw: '.ping' });
});

test('parseCommand: arguments are split and argText preserved', () => {
  const parsed = parseCommand('.kick @user because spam', '.');
  assert.equal(parsed.name, 'kick');
  assert.deepEqual(parsed.args, ['@user', 'because', 'spam']);
  assert.equal(parsed.argText, '@user because spam');
});

test('parseCommand: command names are lowercased', () => {
  assert.equal(parseCommand('.PiNg', '.').name, 'ping');
});

test('parseCommand: aliases are handled by the registry, not the parser', () => {
  // The parser only normalizes; alias resolution happens in the registry.
  assert.equal(parseCommand('.del', '.').name, 'del');
});

test('parseCommand: custom prefix', () => {
  assert.equal(parseCommand('!ping', '!').name, 'ping');
  assert.equal(parseCommand('.ping', '!'), null);
});

test('parseCommand: non-commands return null', () => {
  assert.equal(parseCommand('hello everyone', '.'), null);
  assert.equal(parseCommand('', '.'), null);
  assert.equal(parseCommand('   ', '.'), null);
  assert.equal(parseCommand('.', '.'), null); // bare prefix
  assert.equal(parseCommand(null, '.'), null);
});

test('parseCommand: invalid characters in command name return null', () => {
  assert.equal(parseCommand('.pi!ng', '.'), null);
  assert.equal(parseCommand('.;rm', '.'), null);
});

test('parseCommand: leading/trailing whitespace tolerated', () => {
  assert.equal(parseCommand('   .ping   ', '.').name, 'ping');
});

// ── Text extraction ────────────────────────────────────────────────────────

test('extractText: plain conversation', () => {
  assert.equal(extractText({ conversation: 'hi there' }), 'hi there');
});

test('extractText: extended text (reply/long message)', () => {
  assert.equal(
    extractText({ extendedTextMessage: { text: 'long message' } }),
    'long message'
  );
});

test('extractText: media captions', () => {
  assert.equal(extractText({ imageMessage: { caption: 'look at this' } }), 'look at this');
  assert.equal(extractText({ videoMessage: { caption: 'a video' } }), 'a video');
  assert.equal(extractText({ documentMessage: { caption: 'a doc' } }), 'a doc');
});

test('extractText: wrapped ephemeral and viewOnce messages are unwrapped', () => {
  assert.equal(
    extractText({ ephemeralMessage: { message: { conversation: 'disappearing' } } }),
    'disappearing'
  );
  assert.equal(
    extractText({
      viewOnceMessage: { message: { imageMessage: { caption: 'peek' } } },
    }),
    'peek'
  );
  assert.equal(
    extractText({
      editedMessage: { message: { extendedTextMessage: { text: 'edited' } } },
    }),
    'edited'
  );
});

test('extractText: malformed inputs return empty string', () => {
  assert.equal(extractText(null), '');
  assert.equal(extractText(undefined), '');
  assert.equal(extractText({}), '');
  assert.equal(extractText({ conversation: 42 }), '');
  assert.equal(extractText({ protocolMessage: {} }), '');
});

// ── Mentions ───────────────────────────────────────────────────────────────

test('extractMentions: reads contextInfo mentionedJid, deduplicated and bounded', () => {
  const message = {
    extendedTextMessage: {
      text: 'hey',
      contextInfo: {
        mentionedJid: ['1@s.whatsapp.net', '1@s.whatsapp.net', '2@lid'],
      },
    },
  };
  assert.deepEqual(extractMentions(message), ['1@s.whatsapp.net', '2@lid']);
});

test('extractMentions: no contextInfo → empty array', () => {
  assert.deepEqual(extractMentions({ conversation: 'hi' }), []);
  assert.deepEqual(extractMentions(null), []);
});

// ── Quoted messages ────────────────────────────────────────────────────────

test('extractQuoted: builds the key from WhatsApp-provided contextInfo (group)', () => {
  const message = {
    extendedTextMessage: {
      text: '.delete',
      contextInfo: {
        stanzaId: 'ABCDEF123',
        participant: '15551234567:12@lid',
        quotedMessage: { conversation: 'bad message' },
      },
    },
  };
  const quoted = extractQuoted(message, '120363000000000000@g.us');
  assert.equal(quoted.key.remoteJid, '120363000000000000@g.us');
  assert.equal(quoted.key.id, 'ABCDEF123');
  assert.equal(quoted.key.participant, '15551234567:12@lid');
  assert.equal(quoted.key.fromMe, false);
  assert.deepEqual(quoted.content, { conversation: 'bad message' });
});

test('extractQuoted: private chat has no participant on the key', () => {
  const message = {
    extendedTextMessage: {
      text: '.delete',
      contextInfo: {
        stanzaId: 'XYZ',
        quotedMessage: { conversation: 'dm message' },
      },
    },
  };
  const quoted = extractQuoted(message, '15551234567@s.whatsapp.net');
  assert.equal(quoted.key.participant, null);
  assert.equal(quoted.key.id, 'XYZ');
});

test('extractQuoted: missing quote returns null', () => {
  assert.equal(extractQuoted({ extendedTextMessage: { text: 'no quote' } }, 'x@g.us'), null);
  assert.equal(extractQuoted(null, 'x@g.us'), null);
});

// ── Message sanity ─────────────────────────────────────────────────────────

test('isProcessableMessage: rejects malformed messages', () => {
  assert.equal(isProcessableMessage(null), false);
  assert.equal(isProcessableMessage({}), false);
  assert.equal(isProcessableMessage({ key: { remoteJid: 'a@s.whatsapp.net' } }), false); // no id / no message
  assert.equal(
    isProcessableMessage({ key: { remoteJid: 'a@s.whatsapp.net', id: 'X' } }),
    false // no message body
  );
  assert.equal(
    isProcessableMessage({ key: { remoteJid: 'a@s.whatsapp.net', id: 'X' }, message: { conversation: 'y' } }),
    true
  );
});

test('isProtocolMessage: detects protocol messages', () => {
  assert.equal(isProtocolMessage({ protocolMessage: { type: 0 } }), true);
  assert.equal(isProtocolMessage({ conversation: 'hi' }), false);
  assert.equal(isProtocolMessage(null), false);
});
