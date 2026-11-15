'use strict';

// Ported from evinor-ai/n8n-nodes-evinor test/verifier.test.mjs (MIT) to jest.
// Step 2 differs on purpose (design Decision 4): an absent header is skipped.
const { createHmac } = require('node:crypto');

const {
  canonicalizeJcs,
  findRejectionReason,
  isAuthenticDelivery,
  signedBytes,
} = require('../lib/verifier');

const golden = require('./fixtures/golden-envelope.json');
const goldenTest = require('./fixtures/golden-test-envelope.json');

const NOW = Date.parse(golden.clock);

const goldenDelivery = (overrides = {}) => ({
  body: structuredClone(golden.envelope),
  signatureHeader: golden.envelope.sender.signature,
  secret: golden.secret,
  keyId: golden.keyId,
  nowMs: NOW,
  ...overrides,
});

// Signs like Evinor, so a failing case reaches the step it targets.
function signedDelivery(mutate, overrides = {}) {
  const body = structuredClone(golden.envelope);
  mutate(body);
  const signature = createHmac('sha256', golden.secret).update(signedBytes(body)).digest('base64');
  body.sender.signature = signature;
  return goldenDelivery({ body, signatureHeader: signature, ...overrides });
}

function expectRejected(delivery, reason) {
  expect(findRejectionReason(delivery)).toBe(reason);
  expect(isAuthenticDelivery(delivery)).toBe(false);
}

describe('golden fixtures', () => {
  it('verifies the golden envelope signed by Evinor', () => {
    expect(findRejectionReason(goldenDelivery())).toBeNull();
    expect(isAuthenticDelivery(goldenDelivery())).toBe(true);
  });

  it('verifies the golden test-delivery envelope (incident-rule-test)', () => {
    const delivery = {
      body: structuredClone(goldenTest.envelope),
      signatureHeader: goldenTest.envelope.sender.signature,
      secret: goldenTest.secret,
      keyId: goldenTest.keyId,
      nowMs: Date.parse(goldenTest.clock),
    };
    expect(goldenTest.envelope.recipients.kind).toBe('incident-rule-test');
    expect(findRejectionReason(delivery)).toBeNull();
  });

  it('does not mutate the parsed body it verifies', () => {
    const delivery = goldenDelivery();
    isAuthenticDelivery(delivery);
    expect(delivery.body).toEqual(golden.envelope);
  });
});

describe('step 1: absent secret or fields', () => {
  const signedOmit = (mutate) => {
    const body = structuredClone(golden.envelope);
    mutate(body);
    return goldenDelivery({ body });
  };
  const cases = [
    ['absent secret', goldenDelivery({ secret: undefined })],
    ['empty secret', goldenDelivery({ secret: '' })],
    ['whitespace-only secret', goldenDelivery({ secret: ' \t\n ' })],
    ['null body', goldenDelivery({ body: null })],
    ['array body', goldenDelivery({ body: [golden.envelope] })],
    ['string body', goldenDelivery({ body: 'envelope' })],
    ['absent sender', signedOmit((body) => delete body.sender)],
    ['array sender', signedOmit((body) => (body.sender = []))],
    ['null sender', signedOmit((body) => (body.sender = null))],
    ['absent sender.keyId', signedOmit((body) => delete body.sender.keyId)],
    ['non-string sender.keyId', signedOmit((body) => (body.sender.keyId = 7))],
    ['absent sender.signature', signedOmit((body) => delete body.sender.signature)],
    ['non-string sender.signature', signedOmit((body) => (body.sender.signature = 7))],
    ['absent timestamp', signedOmit((body) => delete body.timestamp)],
    ['non-string timestamp', signedOmit((body) => (body.timestamp = 1775044800000))],
  ];

  it.each(cases)('rejects %s without throwing', (name, delivery) => {
    expectRejected(delivery, 'missing-field');
  });
});

describe('step 2: a present header must equal the body signature', () => {
  const other = 'A'.repeat(43) + '=';
  const { signature } = golden.envelope.sender;

  it('rejects a different header value', () => {
    expectRejected(goldenDelivery({ signatureHeader: other }), 'header-mismatch');
  });

  it('rejects an empty header value', () => {
    expectRejected(goldenDelivery({ signatureHeader: '' }), 'header-mismatch');
  });

  it('rejects a repeated header delivered as an array', () => {
    expectRejected(goldenDelivery({ signatureHeader: [signature] }), 'header-mismatch');
  });

  it('rejects a header carrying a v1= style prefix', () => {
    expectRejected(goldenDelivery({ signatureHeader: `v1=${signature}` }), 'header-mismatch');
  });

  it('ACCEPTS an absent header (deliberate departure from the n8n verifier)', () => {
    expect(findRejectionReason(goldenDelivery({ signatureHeader: undefined }))).toBeNull();
    expect(isAuthenticDelivery(goldenDelivery({ signatureHeader: undefined }))).toBe(true);
  });

  it('still runs the MAC when the header is absent', () => {
    const body = structuredClone(golden.envelope);
    body.payload.details.generatedSentence = 'Forged.';
    expectRejected(goldenDelivery({ body, signatureHeader: undefined }), 'bad-mac');
  });
});

describe('step 3: malformed or over-long base64', () => {
  const real = golden.envelope.sender.signature;
  const cases = [
    ['invalid characters a lenient decoder drops', `${real.slice(0, 20)}!!!!${real.slice(20)}`],
    ['embedded whitespace', `${real.slice(0, 20)} ${real.slice(20)}`],
    ['trailing newline', `${real}\n`],
    ['trailing garbage after the padding', `${real}AAAA`],
    ['missing padding', real.slice(0, -1)],
    ['url-safe alphabet', real.replace(/\+/g, '-').replace(/\//g, '_')],
    ['too short', 'QUJD'],
    ['too long', `${'A'.repeat(47)}=`],
    ['hex digest', 'a'.repeat(64)],
    ['empty', ''],
  ].filter(([, value]) => value !== real);

  it.each(cases)('rejects %s', (name, value) => {
    const body = structuredClone(golden.envelope);
    body.sender.signature = value;
    expectRejected(goldenDelivery({ body, signatureHeader: value }), 'malformed-signature');
  });

  it('rejects a non-canonical final character that decodes to the same bytes', () => {
    expect(real.at(-2)).toBe('A');
    const variant = `${real.slice(0, -2)}B=`;
    expect(Buffer.from(variant, 'base64')).toEqual(Buffer.from(real, 'base64'));
    const body = structuredClone(golden.envelope);
    body.sender.signature = variant;
    expectRejected(goldenDelivery({ body, signatureHeader: variant }), 'malformed-signature');
  });
});

describe('step 4: keyId swap (fails before the MAC)', () => {
  it('rejects a validly signed envelope under another keyId', () => {
    expectRejected(
      signedDelivery((body) => (body.sender.keyId = 'rule-other:1')),
      'key-id-mismatch',
    );
  });

  it('reports key-id-mismatch even when the MAC would also fail', () => {
    // Wrong secret AND wrong keyId: step 4 must fire first.
    expectRejected(goldenDelivery({ keyId: 'rule-other:1', secret: 'x' }), 'key-id-mismatch');
  });

  it('rejects when the stored keyId is absent', () => {
    expectRejected(goldenDelivery({ keyId: undefined }), 'key-id-mismatch');
  });
});

describe('step 5: tampered body', () => {
  const tamperings = [
    ['payload field', (body) => (body.payload.details.generatedSentence = 'Forged.')],
    ['recipients', (body) => (body.recipients.kind = 'incident-rule-test')],
    ['messageId', (body) => (body.messageId = 'forged')],
    ['added top-level key', (body) => (body.extra = true)],
    ['sender.agentId, which is signed', (body) => (body.sender.agentId = 'forged')],
    ['sender.signatureAlg, which is signed', (body) => (body.sender.signatureAlg = 'none')],
    ['timestamp, which is signed', (body) => (body.timestamp = '2026-04-01T12:00:01.000Z')],
  ];

  it.each(tamperings)('rejects a change to %s', (name, tamper) => {
    const body = structuredClone(golden.envelope);
    tamper(body);
    expectRejected(goldenDelivery({ body }), 'bad-mac');
  });

  it('reports bad-mac, not bad-timestamp, for a stale and tampered body', () => {
    const body = structuredClone(golden.envelope);
    body.payload.details.generatedSentence = 'Forged.';
    expectRejected(goldenDelivery({ body, nowMs: NOW + 60 * 60 * 1000 }), 'bad-mac');
  });

  it('rejects the right signature under the wrong secret', () => {
    expectRejected(goldenDelivery({ secret: 'another-secret' }), 'bad-mac');
  });
});

describe('step 6: stale, future and unparseable timestamps', () => {
  const at = (timestamp, overrides) =>
    signedDelivery((body) => (body.timestamp = timestamp), overrides);
  const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
  const FIVE_MINUTES = 5 * 60 * 1000;

  it('accepts exactly 5 minutes old and 5 minutes ahead', () => {
    expect(findRejectionReason(at(iso(-FIVE_MINUTES)))).toBeNull();
    expect(findRejectionReason(at(iso(FIVE_MINUTES)))).toBeNull();
  });

  it('accepts a numeric UTC offset', () => {
    expect(findRejectionReason(at('2026-04-01T14:00:00.000+02:00'))).toBeNull();
  });

  it('rejects a stale timestamp', () => {
    expectRejected(at(iso(-FIVE_MINUTES - 1)), 'bad-timestamp');
  });

  it('rejects a future timestamp', () => {
    expectRejected(at(iso(FIVE_MINUTES + 1)), 'bad-timestamp');
  });

  it.each([
    'not-a-date',
    '',
    '2026-04-01',
    '2026-04-01 12:00:00Z',
    '2026-04-01T12:00:00',
    'April 1, 2026 12:00:00 UTC',
    '2026-13-01T12:00:00.000Z',
    '2026-02-31T12:00:00.000Z',
    '2026-04-01T25:00:00.000Z',
  ])('rejects the unparseable (non-ISO) timestamp %j', (value) => {
    expectRejected(at(value, { nowMs: Date.parse(value) || NOW }), 'bad-timestamp');
  });
});

describe('never throws', () => {
  it('returns false for very deep nesting instead of a stack overflow', () => {
    let nested = 1;
    for (let i = 0; i < 200000; i++) {
      nested = [nested];
    }
    const body = structuredClone(golden.envelope);
    const delivery = goldenDelivery({ body });
    body.payload = nested;
    expect(isAuthenticDelivery(delivery)).toBe(false);
  });
});

describe('JCS', () => {
  it.each([
    ['number 1e21', 1e21, '1e+21'],
    ['number 1e-7', 1e-7, '1e-7'],
    ['number -0', -0, '0'],
    ['2^53', 9007199254740992, '9007199254740992'],
    ['a fractional number', 333333333.33333329, '333333333.3333333'],
    ['4.50', 4.5, '4.5'],
    ['escaped control characters', '\u000f\n"\\', '"\\u000f\\n\\"\\\\"'],
    ['non-ASCII stays literal', '€$', '"€$"'],
    ['forward slash is not escaped', '/', '"/"'],
    ['literals', [null, true, false], '[null,true,false]'],
    ['nested empties', { a: [], b: {} }, '{"a":[],"b":{}}'],
  ])('serializes %s', (name, input, expected) => {
    expect(canonicalizeJcs(input)).toBe(expected);
  });

  it('orders keys by UTF-16 code unit, not code point, around surrogates', () => {
    expect(canonicalizeJcs({ '\ufb33': 1, '\u{1f600}': 2 })).toBe('{"\u{1f600}":2,"\ufb33":1}');
  });

  it('sorts nested objects and keeps array order', () => {
    expect(canonicalizeJcs({ b: [{ d: 1, c: 2 }, 3], a: 0 })).toBe('{"a":0,"b":[{"c":2,"d":1},3]}');
  });

  it('keeps an own __proto__ key from JSON.parse', () => {
    const input = JSON.parse('{"z":1,"__proto__":{"polluted":true},"a":2}');
    expect(canonicalizeJcs(input)).toBe('{"__proto__":{"polluted":true},"a":2,"z":1}');
    expect({}.polluted).toBeUndefined();
  });

  it('signs the envelope minus sender.signature only', () => {
    const bytes = signedBytes(golden.envelope).toString('utf8');
    expect(bytes).toContain('"signatureAlg":"hmac-sha256"');
    expect(bytes).toContain(`"keyId":"${golden.keyId}"`);
    expect(bytes).not.toContain('"signature":');
  });

  it('refuses non-finite numbers and non-JSON values', () => {
    expect(() => canonicalizeJcs(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalizeJcs(undefined)).toThrow(TypeError);
  });
});
