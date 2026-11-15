'use strict';

const { apiUrl } = require('./lib/api');

const HELP_TEXT = [
  'An Evinor API key (it starts with `evnr_live_`). Create one in the Evinor app under ' +
    '**Settings → API keys**. See [Authentication](https://docs.evinor.ai/authentication).',
  'Give the key the scopes for the steps you use: `SENSORS_READ` and `SENSORS_WRITE` for ' +
    'New Sensor Event, `BEATS_READ` for New Beat Entry, and `REPORTS_READ` for Find Entity ' +
    'and File a Report.',
  'File a Report also needs the `REPORTS_WRITE` scope, which is sales-gated: it is granted ' +
    'on request (hi@evinor.ai). Without it, every other step still works.',
].join('\n\n');

// GET /v1/sensors needs only SENSORS_READ, so a key without REPORTS_WRITE passes.
const test = async (z) => {
  const response = await z.request({ url: apiUrl('/v1/sensors'), params: { limit: 1 } });
  return response.data;
};

// Only the last 4 characters, so the label never exposes the key.
const connectionLabel = (z, bundle) => {
  const apiKey = String(bundle.authData?.api_key ?? '');
  return apiKey.length >= 4 ? `…${apiKey.slice(-4)}` : 'Evinor';
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: HELP_TEXT,
    },
  ],
  test,
  connectionLabel,
};
