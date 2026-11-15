'use strict';

const zapier = require('zapier-platform-core');

const App = require('../index');
const { authData, api, problem, PROBLEM_HEADERS } = require('./helpers');

const appTester = zapier.createAppTester(App);
const search = () => App.searches.find_entity;
const bundle = (query = 'TechCorp') => ({ authData: authData(), inputData: { query } });

describe('Find Entity (task 4.4)', () => {
  it('has a required query input', () => {
    expect(search().operation.inputFields[0]).toMatchObject({ key: 'query', required: true });
  });

  it('calls GET /v1/entities/search and returns only the first match', async () => {
    const scope = api()
      .get('/v1/entities/search')
      .query({ query: 'TechCorp', limit: '1' })
      .reply(200, {
        data: [{ id: 'ne-1', object: 'entity', name: 'TechCorp', type: 'ORGANIZATION' }],
        has_more: true,
        next_cursor: 'cur',
      });

    const result = await appTester(search().operation.perform, bundle());
    expect(scope.isDone()).toBe(true);
    expect(result).toEqual([{ id: 'ne-1', name: 'TechCorp', type: 'ORGANIZATION' }]);
  });

  it('returns an empty list when nothing matches, for search-or-continue', async () => {
    api().get('/v1/entities/search').query(true).reply(200, { data: [], has_more: false, next_cursor: null });
    await expect(appTester(search().operation.perform, bundle('Nope'))).resolves.toEqual([]);
  });

  it('surfaces the problem detail', async () => {
    api()
      .get('/v1/entities/search')
      .query(true)
      .reply(403, problem(403, 'missing-scope', 'This API key lacks REPORTS_READ.'), PROBLEM_HEADERS);
    await expect(appTester(search().operation.perform, bundle())).rejects.toThrow(
      'This API key lacks REPORTS_READ.',
    );
  });
});
