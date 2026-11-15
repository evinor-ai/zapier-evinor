'use strict';

const { toZapierError } = require('./api');

/** Sends the API key as `Authorization: Bearer` on every request. */
const addBearerToken = (request, z, bundle) => {
  const apiKey = bundle.authData?.api_key;
  if (apiKey) {
    request.headers = request.headers ?? {};
    request.headers.Authorization = `Bearer ${apiKey}`;
  }
  return request;
};

/**
 * Surfaces the problem+json `detail` of any error response. A request that
 * sets `skipThrowForStatus` handles its own status (for example a 404 on
 * unsubscribe). 429s are raised by zapier-platform-core before this runs.
 */
const throwProblemDetail = (response, z) => {
  if (response.status >= 400 && !response.skipThrowForStatus) {
    throw toZapierError(z, response);
  }
  return response;
};

module.exports = { befores: [addBearerToken], afters: [throwProblemDetail] };
