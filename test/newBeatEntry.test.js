'use strict';

const zapier = require('zapier-platform-core');

const App = require('../index');
const { authData, api, problem, PROBLEM_HEADERS } = require('./helpers');

const appTester = zapier.createAppTester(App);
const trigger = () => App.triggers.new_beat_entry;
const BEAT_ID = '5e8f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';

const entry = (id, event) => ({
  id,
  object: 'beat_entry',
  matched_clause_id: 'clause-1',
  occurred_at: '2026-11-14T10:00:00.000Z',
  added_at: '2026-11-14T10:05:00.000Z',
  backfilled: false,
  carried_from_event_id: null,
  superseded_by_event_id: null,
  event,
});

const event = (id, sentence) => ({
  id,
  event_type: { code_name: 'LAYOFF' },
  sentence,
  happened_at: '2026-11-13',
  event_date: { value: '2026-11-13T00:00:00.000Z', source: 'STATED', precision: 'DAY' },
});

const page = (data) => ({
  object: 'beat_entries',
  beat: { id: BEAT_ID, status: 'ACTIVE', gaps: [] },
  data,
  has_more: false,
  next_cursor: null,
  poll_since: null,
  total_count: data.length,
});

const bundle = () => ({ authData: authData(), inputData: { beat_id: BEAT_ID }, meta: { page: 0 } });

describe('New Beat Entry (task 4.3)', () => {
  it('is a polling trigger with a required beat dropdown', () => {
    expect(trigger().operation.type ?? 'polling').toBe('polling');
    expect(trigger().operation.inputFields[0]).toMatchObject({
      key: 'beat_id',
      required: true,
      dynamic: 'beat.id.name',
    });
  });

  it('reads the last 24h of entries, newest first, with the entry id as the item id', async () => {
    const scope = api()
      .post(`/v1/beats/${BEAT_ID}/entries`, { last: '24h', limit: 50 })
      .reply(
        200,
        page([
          entry('e2', event('ev2', 'Globex cut 50 jobs.')),
          entry('e1', event('ev1', 'TechCorp laid off 200 people.')),
        ]),
      );

    const result = await appTester(trigger().operation.perform, bundle());
    expect(scope.isDone()).toBe(true);
    expect(result.map((item) => item.id)).toEqual(['e2', 'e1']);
    expect(result[0]).toMatchObject({
      id: 'e2',
      beat_id: BEAT_ID,
      added_at: '2026-11-14T10:05:00.000Z',
      event_id: 'ev2',
      event_type: 'LAYOFF',
      sentence: 'Globex cut 50 jobs.',
      event_date: '2026-11-13T00:00:00.000Z',
    });
  });

  it('skips entries whose event is null', async () => {
    api()
      .post(`/v1/beats/${BEAT_ID}/entries`)
      .reply(200, page([entry('e3', null), entry('e2', event('ev2', 'Globex cut 50 jobs.'))]));

    const result = await appTester(trigger().operation.perform, bundle());
    expect(result.map((item) => item.id)).toEqual(['e2']);
  });

  it('surfaces the problem detail', async () => {
    api()
      .post(`/v1/beats/${BEAT_ID}/entries`)
      .reply(403, problem(403, 'missing-scope', 'This API key lacks BEATS_READ.'), PROBLEM_HEADERS);

    await expect(appTester(trigger().operation.perform, bundle())).rejects.toThrow(
      'This API key lacks BEATS_READ.',
    );
  });
});
