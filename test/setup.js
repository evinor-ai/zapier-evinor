'use strict';

// Each test file gets its own module registry, and so its own nock instance.
// Activate it per file, block real network calls, and restore http afterwards
// so the next file's nock instance is the one that intercepts.
const nock = require('nock');

beforeAll(() => {
  if (!nock.isActive()) {
    nock.activate();
  }
  nock.disableNetConnect();
});

afterEach(() => nock.cleanAll());

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
});
