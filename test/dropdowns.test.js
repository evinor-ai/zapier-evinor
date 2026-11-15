'use strict';

const zapier = require('zapier-platform-core');

const App = require('../index');
const { authData, api } = require('./helpers');

const appTester = zapier.createAppTester(App);

/** Runs a perform with an in-memory z.cursor (the local tester has no cursor RPC). */
const runWithCursor = (perform, bundle, store) =>
  appTester((z, b) => {
    z.cursor = {
      get: async () => store.cursor ?? null,
      set: async (value) => {
        store.cursor = value;
      },
    };
    return perform(z, b);
  }, bundle);

const sensor = (id, name, enabled = true) => ({ id, object: 'sensor', name, enabled });

describe('hidden dropdown triggers (task 4.1)', () => {
  it('are hidden polling triggers', () => {
    for (const key of ['sensor', 'beat', 'event_type']) {
      expect(App.triggers[key]).toBeDefined();
      expect(App.triggers[key].display.hidden).toBe(true);
      expect(App.triggers[key].operation.type ?? 'polling').toBe('polling');
    }
  });

  it('pages sensors through the API cursor', async () => {
    const store = {};
    api()
      .get('/v1/sensors')
      .query({ limit: '100' })
      .reply(200, { data: [sensor('s1', 'Layoffs')], has_more: true, next_cursor: 'cur_1' });
    api()
      .get('/v1/sensors')
      .query({ limit: '100', starting_after: 'cur_1' })
      .reply(200, { data: [sensor('s2', 'Recalls', false)], has_more: false, next_cursor: null });

    const perform = App.triggers.sensor.operation.perform;
    const page0 = await runWithCursor(perform, { authData: authData(), meta: { page: 0 } }, store);
    expect(page0).toEqual([{ id: 's1', name: 'Layoffs' }]);
    expect(store.cursor).toBe('cur_1');

    const page1 = await runWithCursor(perform, { authData: authData(), meta: { page: 1 } }, store);
    expect(page1).toEqual([{ id: 's2', name: 'Recalls (disabled)' }]);
    expect(App.triggers.sensor.operation.canPaginate).toBe(true);
  });

  it('returns no more sensors once the API has no next page', async () => {
    const store = { cursor: '' };
    const perform = App.triggers.sensor.operation.perform;
    // A later page without a stored cursor must not restart from the first page.
    await expect(
      runWithCursor(perform, { authData: authData(), meta: { page: 2 } }, store),
    ).resolves.toEqual([]);
  });

  it('lists beats (one page; GET /v1/beats takes no paging parameters)', async () => {
    api()
      .get('/v1/beats')
      .reply(200, {
        data: [{ id: 'b1', object: 'beat', name: 'Supplier risk', enabled: true }],
        has_more: false,
      });
    const result = await appTester(App.triggers.beat.operation.perform, {
      authData: authData(),
      meta: { page: 0 },
    });
    expect(result).toEqual([{ id: 'b1', name: 'Supplier risk' }]);
  });

  it('lists event types (one page; GET /v1/event-types takes no parameters)', async () => {
    api()
      .get('/v1/event-types')
      .reply(200, {
        data: [
          { id: 'et1', object: 'event_type', code_name: 'LAYOFF', name: 'Layoffs', roles: [] },
        ],
        has_more: false,
        next_cursor: null,
      });
    const result = await appTester(App.triggers.event_type.operation.perform, {
      authData: authData(),
      meta: { page: 0 },
    });
    expect(result).toEqual([{ id: 'et1', name: 'Layoffs' }]);
  });

  it('returns nothing for a later page of a single-page list', async () => {
    for (const key of ['beat', 'event_type']) {
      await expect(
        appTester(App.triggers[key].operation.perform, { authData: authData(), meta: { page: 1 } }),
      ).resolves.toEqual([]);
    }
  });
});
