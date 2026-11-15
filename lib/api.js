'use strict';

/** The Evinor public API origin. */
const API_BASE = 'https://api.evinor.ai';

/** Builds an API URL. Path segments taken from user input must go through `segment`. */
const apiUrl = (path) => `${API_BASE}${path}`;

/**
 * Encodes one path segment. A `.` or `..` segment survives encodeURIComponent
 * and is collapsed by URL parsers, so it is refused outright.
 */
const segment = (z, value) => {
  const id = String(value ?? '').trim();
  if (id === '' || id === '.' || id === '..') {
    throw new z.errors.Error('The ID is missing or not valid.', 'InvalidId', 400);
  }
  return encodeURIComponent(id);
};

/** Reads a problem+json body without assuming the API answered with one. */
const readProblem = (response) => {
  let body = response.data;
  if (body === undefined) {
    try {
      body = JSON.parse(response.content);
    } catch {
      body = undefined;
    }
  }
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {};
};

/** The problem `type` slug, e.g. `missing-scope`, or null. */
const problemSlug = (problem) =>
  typeof problem.type === 'string' ? (problem.type.split('/').pop() ?? null) : null;

/**
 * Turns an Evinor error response into a Zapier error that shows the problem
 * `detail` (which, for `missing-scope`, names the scope).
 */
const toZapierError = (z, response) => {
  const problem = readProblem(response);
  const detail =
    typeof problem.detail === 'string' && problem.detail !== ''
      ? problem.detail
      : typeof problem.title === 'string' && problem.title !== ''
        ? problem.title
        : `The Evinor API answered with status ${response.status}.`;
  const code = problemSlug(problem) ?? `http-${response.status}`;
  return new z.errors.Error(detail, code, response.status);
};

module.exports = { API_BASE, apiUrl, segment, readProblem, problemSlug, toZapierError };
