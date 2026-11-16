'use strict';

const zapier = require('zapier-platform-core');

const App = require('../index');
const { API_KEY, authData, problem, PROBLEM_HEADERS, api } = require('./helpers');

const appTester = zapier.createAppTester(App);

describe('authentication (design Decision 7)', () => {
  it('is custom auth with one required password-type api_key field', () => {
    expect(App.authentication.type).toBe('custom');
    expect(App.authentication.fields).toHaveLength(1);
    expect(App.authentication.fields[0]).toMatchObject({
      key: 'api_key',
      type: 'password',
      required: true,
    });
  });

  it('adds the API key as a bearer token, and the test calls GET /v1/sensors?limit=1', async () => {
    const scope = api()
      .get('/v1/sensors')
      .query({ limit: '1' })
      .matchHeader('authorization', `Bearer ${API_KEY}`)
      .reply(200, { data: [], has_more: false, next_cursor: null });

    await appTester(App.authentication.test, { authData: authData() });
    expect(scope.isDone()).toBe(true);
  });

  it('surfaces the 401 problem detail', async () => {
    api()
      .get('/v1/sensors')
      .query(true)
      .reply(401, problem(401, 'invalid-api-key', 'The API key is invalid.'), PROBLEM_HEADERS);

    await expect(appTester(App.authentication.test, { authData: authData() })).rejects.toThrow(
      'The API key is invalid.',
    );
  });

  it('surfaces the 403 problem detail, which names the missing scope', async () => {
    api()
      .get('/v1/sensors')
      .query(true)
      .reply(
        403,
        problem(403, 'missing-scope', 'This API key lacks the required scope: SENSORS_READ.'),
        PROBLEM_HEADERS,
      );

    await expect(appTester(App.authentication.test, { authData: authData() })).rejects.toThrow(
      'This API key lacks the required scope: SENSORS_READ.',
    );
  });

  it('labels the connection with only the last 4 characters of the key', async () => {
    const label = await appTester(App.authentication.connectionLabel, {
      authData: authData(),
      inputData: {},
    });
    expect(label).toBe(`…${API_KEY.slice(-4)}`);
    expect(label).not.toContain(API_KEY.slice(0, -4));
  });

  it('help text names the scopes the steps need and never REPORTS_WRITE', () => {
    const { helpText } = App.authentication.fields[0];
    for (const scope of ['SENSORS_READ', 'SENSORS_WRITE', 'BEATS_READ', 'REPORTS_READ']) {
      expect(helpText).toContain(scope);
    }
    expect(helpText).not.toMatch(/REPORTS_WRITE/);
    expect(helpText).not.toMatch(/File a Report/);
  });
});
