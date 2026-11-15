'use strict';

const nock = require('nock');

const API = 'https://api.evinor.ai';
const API_KEY = 'evnr_live_abcdefghijklmnopqrstuvwxyz0123AbCd99';

const authData = () => ({ api_key: API_KEY });

/** An RFC 9457 problem body, shaped like the Evinor API's ProblemDetails. */
const problem = (status, slug, detail) => ({
  type: `https://docs.evinor.ai/problems/${slug}`,
  title: slug,
  status,
  retryable: false,
  detail,
  request_id: 'req_test',
});

const PROBLEM_HEADERS = { 'Content-Type': 'application/problem+json' };

const api = () => nock(API);

module.exports = { API, API_KEY, authData, problem, PROBLEM_HEADERS, api, nock };
