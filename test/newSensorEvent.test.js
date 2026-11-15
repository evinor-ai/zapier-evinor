'use strict';

const { createHmac } = require('node:crypto');
const zapier = require('zapier-platform-core');

const App = require('../index');
const { signedBytes } = require('../lib/verifier');
const { authData, api, problem, PROBLEM_HEADERS } = require('./helpers');
const golden = require('./fixtures/golden-envelope.json');
const goldenTest = require('./fixtures/golden-test-envelope.json');

const appTester = zapier.createAppTester(App);
const trigger = () => App.triggers.new_sensor_event;
const NOW = Date.parse(golden.clock);
const SENSOR_ID = 'rule-golden';
const TARGET_URL = 'https://hooks.zapier.com/hooks/standard/1/abc/';

const subscribeData = (overrides = {}) => ({
  id: 'action-golden-1',
  signing_secret: golden.secret,
  key_id: golden.keyId,
  sensor_id: SENSOR_ID,
  ...overrides,
});

/** A delivery as Zapier hands it to perform: Http-prefixed headers, raw body. */
const deliveryBundle = ({ envelope = golden.envelope, headers, data } = {}) => ({
  authData: authData(),
  inputData: { sensor_id: SENSOR_ID },
  subscribeData: data ?? subscribeData(),
  targetUrl: TARGET_URL,
  rawRequest: {
    method: 'POST',
    headers: headers ?? {
      'Content-Type': 'application/json',
      'Http-X-Evinor-Signature': envelope.sender.signature,
    },
    content: JSON.stringify(envelope),
  },
  cleanedRequest: structuredClone(envelope),
});

/**
 * Runs perform and records every z.console call. Any z.console method counts.
 */
const runPerform = async (bundle) => {
  const calls = [];
  const result = await appTester((z, b) => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) {
      z.console[method] = (...args) => calls.push(args);
    }
    return trigger().operation.perform(z, b);
  }, bundle);
  return { result, calls };
};

const resign = (envelope) => {
  const signature = createHmac('sha256', golden.secret)
    .update(signedBytes(envelope))
    .digest('base64');
  envelope.sender.signature = signature;
  return envelope;
};

/** No z.console call may carry subscribeData, the secret or any part of the envelope. */
const expectNothingSecretLogged = (calls, envelope = golden.envelope) => {
  const logged = calls.map((args) => args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')).join('\n');
  for (const needle of [
    golden.secret,
    golden.keyId,
    envelope.sender.signature,
    envelope.messageId,
    envelope.idempotencyKey,
    'TechCorp',
  ]) {
    expect(logged).not.toContain(needle);
  }
  for (const args of calls) {
    for (const arg of args) {
      expect(typeof arg === 'object' && arg !== null).toBe(false);
    }
  }
};

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => jest.restoreAllMocks());

describe('New Sensor Event: definition', () => {
  it('is a REST hook with a required sensor dropdown', () => {
    expect(trigger().operation.type).toBe('hook');
    expect(trigger().display.hidden).toBeFalsy();
    const [sensorField] = trigger().operation.inputFields;
    expect(sensorField).toMatchObject({ key: 'sensor_id', required: true, dynamic: 'sensor.id.name' });
  });
});

describe('performSubscribe', () => {
  it('connects targetUrl as a zapier destination and stores id, secret, key id and sensor id', async () => {
    const scope = api()
      .post(`/v1/sensors/${SENSOR_ID}/destinations`, {
        type: 'connected_app',
        app: 'zapier',
        url: TARGET_URL,
      })
      .reply(201, {
        id: 'dest-1',
        type: 'connected_app',
        app: 'zapier',
        url: TARGET_URL,
        status: 'connected',
        signing_secret: 'whsec_test',
        key_id: `${SENSOR_ID}:dest-1`,
      });

    const result = await appTester(trigger().operation.performSubscribe, {
      authData: authData(),
      inputData: { sensor_id: SENSOR_ID },
      targetUrl: TARGET_URL,
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      id: 'dest-1',
      signing_secret: 'whsec_test',
      key_id: `${SENSOR_ID}:dest-1`,
      sensor_id: SENSOR_ID,
    });
  });

  it.each([
    [409, 'state-conflict', 'This sensor already has 10 destinations.'],
    [404, 'not-found', 'No sensor with this id exists.'],
  ])('surfaces a %i problem detail', async (status, slug, detail) => {
    api()
      .post(`/v1/sensors/${SENSOR_ID}/destinations`)
      .reply(status, problem(status, slug, detail), PROBLEM_HEADERS);

    await expect(
      appTester(trigger().operation.performSubscribe, {
        authData: authData(),
        inputData: { sensor_id: SENSOR_ID },
        targetUrl: TARGET_URL,
      }),
    ).rejects.toThrow(detail);
  });

  it('fails when the response carries no signing details', async () => {
    api()
      .post(`/v1/sensors/${SENSOR_ID}/destinations`)
      .reply(201, { id: 'dest-1', type: 'connected_app', app: 'zapier', url: TARGET_URL, status: 'connected' });

    await expect(
      appTester(trigger().operation.performSubscribe, {
        authData: authData(),
        inputData: { sensor_id: SENSOR_ID },
        targetUrl: TARGET_URL,
      }),
    ).rejects.toThrow(/signing details/);
  });
});

describe('performUnsubscribe', () => {
  const bundle = () => ({
    authData: authData(),
    inputData: { sensor_id: SENSOR_ID },
    subscribeData: subscribeData({ id: 'dest-1' }),
  });

  it('disconnects the stored destination', async () => {
    const scope = api().delete(`/v1/sensors/${SENSOR_ID}/destinations/dest-1`).reply(204);
    await expect(appTester(trigger().operation.performUnsubscribe, bundle())).resolves.toBeDefined();
    expect(scope.isDone()).toBe(true);
  });

  it('treats a 404 (destination already removed in Evinor) as success', async () => {
    const scope = api()
      .delete(`/v1/sensors/${SENSOR_ID}/destinations/dest-1`)
      .reply(404, problem(404, 'not-found', 'Not found.'), PROBLEM_HEADERS);
    await expect(appTester(trigger().operation.performUnsubscribe, bundle())).resolves.toBeDefined();
    expect(scope.isDone()).toBe(true);
  });

  it('surfaces any other failure', async () => {
    api()
      .delete(`/v1/sensors/${SENSOR_ID}/destinations/dest-1`)
      .reply(403, problem(403, 'missing-scope', 'This API key lacks SENSORS_WRITE.'), PROBLEM_HEADERS);
    await expect(appTester(trigger().operation.performUnsubscribe, bundle())).rejects.toThrow(
      'This API key lacks SENSORS_WRITE.',
    );
  });
});

describe('perform: verification (design Decision 4)', () => {
  it('accepts the golden envelope and maps it', async () => {
    const { result, calls } = await runPerform(deliveryBundle());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: golden.envelope.idempotencyKey, is_test: false });
    expectNothingSecretLogged(calls);
  });

  it('accepts the golden test envelope', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(goldenTest.clock));
    const { result } = await runPerform(
      deliveryBundle({
        envelope: goldenTest.envelope,
        data: subscribeData({ signing_secret: goldenTest.secret, key_id: goldenTest.keyId }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].is_test).toBe(true);
  });

  it('ACCEPTS a valid body with no signature header (departure from n8n)', async () => {
    const { result } = await runPerform(deliveryBundle({ headers: { 'Content-Type': 'application/json' } }));
    expect(result).toHaveLength(1);
  });

  it('matches the header key case-insensitively', async () => {
    const { result } = await runPerform(
      deliveryBundle({ headers: { 'http-x-evinor-signature': golden.envelope.sender.signature } }),
    );
    expect(result).toHaveLength(1);
  });

  const failing = [
    ['missing-field', () => deliveryBundle({ data: subscribeData({ signing_secret: undefined }) })],
    [
      'missing-field',
      () => {
        const b = deliveryBundle();
        delete b.subscribeData;
        return b;
      },
    ],
    [
      'missing-field',
      () => {
        const b = deliveryBundle();
        b.rawRequest.content = 'not json';
        b.cleanedRequest = undefined;
        return b;
      },
    ],
    [
      'header-mismatch',
      () => deliveryBundle({ headers: { 'Http-X-Evinor-Signature': `${'A'.repeat(43)}=` } }),
    ],
    [
      'malformed-signature',
      () => {
        const envelope = structuredClone(golden.envelope);
        envelope.sender.signature = 'not base64!';
        return deliveryBundle({ envelope });
      },
    ],
    [
      'key-id-mismatch',
      () => deliveryBundle({ envelope: resign(Object.assign(structuredClone(golden.envelope), { sender: { ...golden.envelope.sender, keyId: 'rule-other:1' } })) }),
    ],
    [
      'bad-mac',
      () => {
        const envelope = structuredClone(golden.envelope);
        envelope.payload.details.generatedSentence = 'Forged.';
        return deliveryBundle({ envelope });
      },
    ],
    [
      'bad-timestamp',
      () => deliveryBundle({ envelope: resign(Object.assign(structuredClone(golden.envelope), { timestamp: '2026-04-01T11:54:59.999Z' })) }),
    ],
    [
      'bad-timestamp',
      () => deliveryBundle({ envelope: resign(Object.assign(structuredClone(golden.envelope), { timestamp: '2026-04-01T12:05:00.001Z' })) }),
    ],
    [
      'bad-timestamp',
      () => deliveryBundle({ envelope: resign(Object.assign(structuredClone(golden.envelope), { timestamp: 'April 1, 2026 12:00:00 UTC' })) }),
    ],
  ];

  it.each(failing)('returns [] without throwing and logs only the step name (%s)', async (reason, build) => {
    const bundle = build();
    const { result, calls } = await runPerform(bundle);
    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].join(' ')).toContain(reason);
    expectNothingSecretLogged(calls, bundle.cleanedRequest ?? golden.envelope);
  });

  it('never throws, even on hostile input', async () => {
    const depth = 200000;
    const bundle = deliveryBundle();
    const envelope = JSON.stringify({ ...golden.envelope, payload: '__NESTED__' });
    bundle.rawRequest.content = envelope.replace('"__NESTED__"', `${'['.repeat(depth)}1${']'.repeat(depth)}`);
    bundle.cleanedRequest = undefined;
    const { result, calls } = await runPerform(bundle);
    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('perform: output (design Decision 6)', () => {
  it('flattens the event for the field picker and never outputs the sender block', async () => {
    const { result } = await runPerform(deliveryBundle());
    const [item] = result;
    expect(item).toMatchObject({
      id: 'delivery-golden-1',
      message_id: golden.envelope.messageId,
      is_test: false,
      sensor_id: SENSOR_ID,
      matched_at: '2026-04-01T12:00:00.000Z',
      event_id: 'incident-golden-1',
      title: 'TechCorp laid off 200 people.',
      event_type: 'LAYOFF',
      event_type_name: 'Layoffs',
      role__COMPANY_NAME: 'TechCorp',
      role__AFFECTED_EMPLOYEES_COUNT: '200 people',
    });
    expect(JSON.parse(item.raw)).toEqual(golden.envelope.payload);
    expect(JSON.stringify(item)).not.toContain(golden.envelope.sender.signature);
  });

  it('joins a repeated role with ", "', async () => {
    const envelope = structuredClone(golden.envelope);
    envelope.payload.details.roles.push({ code: 'COMPANY_NAME', textValue: 'Globex' });
    const { result } = await runPerform(deliveryBundle({ envelope: resign(envelope) }));
    expect(result[0].role__COMPANY_NAME).toBe('TechCorp, Globex');
  });
});

describe('performList: built-in sample (design Decision 5)', () => {
  it('returns one is_test sample without any API call', async () => {
    // Real network is blocked and no nock scope is set, so any request would fail.
    const result = await appTester(trigger().operation.performList, {
      authData: authData(),
      inputData: { sensor_id: 'sensor-123' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: goldenTest.envelope.idempotencyKey,
      is_test: true,
      sensor_id: 'sensor-123',
      event_type: 'LAYOFF',
    });
    expect(JSON.stringify(result[0])).not.toContain(goldenTest.envelope.sender.signature);
  });
});
