'use strict';

const zapier = require('zapier-platform-core');

const App = require('../index');
const { authData, api, problem, PROBLEM_HEADERS } = require('./helpers');

const appTester = zapier.createAppTester(App);
const create = () => App.creates.file_report;

const EVENT_TYPE_ID = '7d1e2f3a-4b5c-4d6e-8f9a-0b1c2d3e4f5a';
const ENTITY_ID = '3f1c2b9a-52de-4a53-9c1e-7a1f0e6b8d21';

const eventTypes = {
  data: [
    {
      id: EVENT_TYPE_ID,
      object: 'event_type',
      code_name: 'FUND_RAISING',
      name: 'Fundraising',
      description: 'A company raised money.',
      roles: [
        { code_name: 'RECIPIENT', name: 'Recipient', expected_type: 'NAMED_ENTITY' },
        { code_name: 'AMOUNT', name: 'Amount', expected_type: 'CURRENCY' },
        { code_name: 'CLOSING_DATE', name: 'Closing date', expected_type: 'DATE' },
        { code_name: 'ROUND', name: 'Round', expected_type: 'NONE' },
        { code_name: 'LEGACY', name: 'Legacy', expected_type: null },
        {
          code_name: 'STAGE',
          name: 'Stage',
          expected_type: 'CATEGORICAL',
          allowed_values: ['SEED'],
        },
      ],
    },
  ],
  has_more: false,
  next_cursor: null,
};

const inputData = (overrides = {}) => ({
  event_type_id: EVENT_TYPE_ID,
  happened_at: '2026-09-14T00:00:00Z',
  role__RECIPIENT: ENTITY_ID,
  role__AMOUNT: '25000000',
  role__AMOUNT__unit: 'USD',
  role__CLOSING_DATE: '2026-09-14',
  role__ROUND: 'Series B',
  role__LEGACY: 'legacy text',
  description: 'Announced on the company blog.',
  ...overrides,
});

const reportResponse = {
  id: 'rep-1',
  object: 'report',
  status: 'SUBMITTED',
  event_type_id: EVENT_TYPE_ID,
  happened_at: '2026-09-14T00:00:00.000Z',
  roles: [],
  description: null,
  grant_id: null,
  published_as: { name: 'Acme', kind: 'ORGANIZATION' },
  incident_id: null,
  incident_report_id: null,
  created_at: '2026-11-15T00:00:00.000Z',
};

/** Files a report and returns the request body and Idempotency-Key sent. */
const fileAndCapture = async (data, meta = {}) => {
  const captured = {};
  api().get('/v1/event-types').reply(200, eventTypes);
  api()
    .post('/v1/reports', (body) => {
      captured.body = body;
      return true;
    })
    .reply(function reply() {
      captured.key = this.req.headers['idempotency-key'];
      return [201, reportResponse];
    });
  const result = await appTester(create().operation.perform, {
    authData: authData(),
    inputData: data,
    meta,
  });
  return { ...captured, result };
};

describe('File a Report: fields (task 4.5)', () => {
  it('starts with an event type dropdown that alters the dynamic fields', () => {
    const [field] = create().operation.inputFields;
    expect(field).toMatchObject({
      key: 'event_type_id',
      required: true,
      dynamic: 'event_type.id.name',
      altersDynamicFields: true,
    });
  });

  it('builds one input per role from GET /v1/event-types, typed by expected_type', async () => {
    api().get('/v1/event-types').reply(200, eventTypes);
    const roleFields = create().operation.inputFields.find((field) => typeof field === 'function');
    const fields = await appTester(roleFields, {
      authData: authData(),
      inputData: { event_type_id: EVENT_TYPE_ID },
    });
    const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));

    expect(byKey.role__RECIPIENT).toMatchObject({ label: 'Recipient', type: 'string' });
    expect(byKey.role__RECIPIENT.helpText).toMatch(/Find Entity/);
    expect(byKey.role__AMOUNT).toMatchObject({ label: 'Amount', type: 'number' });
    expect(byKey.role__AMOUNT__unit).toMatchObject({ type: 'string' });
    expect(byKey.role__CLOSING_DATE).toMatchObject({ label: 'Closing date', type: 'string' });
    expect(byKey.role__CLOSING_DATE.helpText).toMatch(/YYYY-MM-DD/);
    expect(byKey.role__ROUND).toMatchObject({ type: 'string' });
    expect(byKey.role__LEGACY).toMatchObject({ type: 'string' });
    // CATEGORICAL roles cannot be filed through the API yet.
    expect(byKey.role__STAGE).toBeUndefined();
  });

  it('returns no role fields before an event type is chosen', async () => {
    const roleFields = create().operation.inputFields.find((field) => typeof field === 'function');
    await expect(appTester(roleFields, { authData: authData(), inputData: {} })).resolves.toEqual(
      [],
    );
  });

  it('help text says identical inputs file once and that zaps share a scope without zap.id', () => {
    const help = [
      create().display.description,
      ...create()
        .operation.inputFields.filter((field) => typeof field !== 'function')
        .map((field) => field.helpText ?? ''),
    ].join('\n');
    expect(help).toMatch(/identical inputs file (only )?one report|file only once/i);
    expect(help).toMatch(/Deduplication key/);
    expect(help).toMatch(/REPORTS_WRITE/);
  });
});

describe('File a Report: request (task 4.5)', () => {
  it('fails clearly when the event type no longer exists', async () => {
    api().get('/v1/event-types').reply(200, { data: [], has_more: false, next_cursor: null });
    await expect(
      appTester(create().operation.perform, { authData: authData(), inputData: inputData() }),
    ).rejects.toThrow(/event type/i);
  });

  it('maps a role value of each type to its value field', async () => {
    const { body, result } = await fileAndCapture(inputData());
    expect(body).toEqual({
      event_type_id: EVENT_TYPE_ID,
      happened_at: '2026-09-14T00:00:00Z',
      roles: [
        { role: 'AMOUNT', amount: { value: 25000000, unit: 'USD' } },
        { role: 'CLOSING_DATE', date: '2026-09-14' },
        { role: 'LEGACY', text: 'legacy text' },
        { role: 'RECIPIENT', entity_id: ENTITY_ID },
        { role: 'ROUND', text: 'Series B' },
      ],
      description: 'Announced on the company blog.',
    });
    expect(result).toMatchObject({ id: 'rep-1' });
  });

  it('sends an empty unit for an amount without one, and cuts an ISO datetime to its date', async () => {
    const { body } = await fileAndCapture(
      inputData({ role__AMOUNT__unit: undefined, role__CLOSING_DATE: '2026-09-14T10:00:00Z' }),
    );
    expect(body.roles).toEqual(
      expect.arrayContaining([
        { role: 'AMOUNT', amount: { value: 25000000, unit: '' } },
        { role: 'CLOSING_DATE', date: '2026-09-14' },
      ]),
    );
  });

  it('refuses a non-numeric amount before calling the API', async () => {
    api().get('/v1/event-types').reply(200, eventTypes);
    await expect(
      appTester(create().operation.perform, {
        authData: authData(),
        inputData: inputData({ role__AMOUNT: 'lots' }),
      }),
    ).rejects.toThrow(/AMOUNT/);
  });

  it('a retry with the same inputs reuses the Idempotency-Key', async () => {
    const first = await fileAndCapture(inputData());
    const second = await fileAndCapture(inputData());
    expect(first.key).toBe(second.key);
  });

  it('the key does not depend on input order', async () => {
    const first = await fileAndCapture(inputData());
    const reversed = Object.fromEntries(Object.entries(inputData()).reverse());
    const second = await fileAndCapture(reversed);
    expect(first.key).toBe(second.key);
  });

  it('a changed role value changes the key', async () => {
    const first = await fileAndCapture(inputData());
    const second = await fileAndCapture(inputData({ role__ROUND: 'Series C' }));
    expect(first.key).not.toBe(second.key);
  });

  it('the description, happened_at, deduplication key and zap id each change the key', async () => {
    const base = (await fileAndCapture(inputData())).key;
    for (const [data, meta] of [
      [inputData({ description: 'Other' }), {}],
      [inputData({ happened_at: '2026-09-15T00:00:00Z' }), {}],
      [inputData({ dedup_key: 'trigger-123' }), {}],
      [inputData(), { zap: { id: 'zap-1' } }],
    ]) {
      expect((await fileAndCapture(data, meta)).key).not.toBe(base);
    }
  });

  it('the deduplication key is hashed, never sent', async () => {
    const { body } = await fileAndCapture(inputData({ dedup_key: 'trigger-123' }));
    expect(JSON.stringify(body)).not.toContain('trigger-123');
  });

  it('the key matches [A-Za-z0-9_-]{1,255} (hex SHA-256)', async () => {
    const { key } = await fileAndCapture(inputData({ description: 'ünïcødé / spaces' }));
    expect(key).toMatch(/^[A-Za-z0-9_-]{1,255}$/);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [403, 'missing-scope', 'This API key lacks the required scope: REPORTS_WRITE.'],
    [409, 'report-already-submitted', 'This report was already submitted.'],
  ])('surfaces a %i %s problem detail', async (status, slug, detail) => {
    api().get('/v1/event-types').reply(200, eventTypes);
    api()
      .post('/v1/reports')
      .reply(status, problem(status, slug, detail), PROBLEM_HEADERS);
    await expect(
      appTester(create().operation.perform, { authData: authData(), inputData: inputData() }),
    ).rejects.toThrow(detail);
  });
});
