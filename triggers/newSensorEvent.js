'use strict';

const { apiUrl, segment } = require('../lib/api');
const { mapEnvelopeToItem } = require('../lib/output');
const { safeRejectionReason } = require('../lib/verifier');
const sampleEnvelope = require('../lib/sample-envelope.json');

const SIGNATURE_HEADER = 'http-x-evinor-signature';

const sensorPath = (z, sensorId) => `/v1/sensors/${segment(z, sensorId)}`;

const subscribe = async (z, bundle) => {
  const sensorId = bundle.inputData.sensor_id;
  const response = await z.request({
    method: 'POST',
    url: apiUrl(`${sensorPath(z, sensorId)}/destinations`),
    body: { type: 'connected_app', app: 'zapier', url: bundle.targetUrl },
  });
  const { id, signing_secret: signingSecret, key_id: keyId } = response.data ?? {};
  if (![id, signingSecret, keyId].every((value) => typeof value === 'string' && value !== '')) {
    throw new z.errors.Error(
      'The Evinor API response did not include signing details.',
      'MissingSigningDetails',
      response.status,
    );
  }
  // Zapier stores this with the Zap and returns it as bundle.subscribeData.
  return { id, signing_secret: signingSecret, key_id: keyId, sensor_id: String(sensorId) };
};

const unsubscribe = async (z, bundle) => {
  const data = bundle.subscribeData ?? {};
  const sensorId = data.sensor_id ?? bundle.inputData?.sensor_id;
  const response = await z.request({
    method: 'DELETE',
    url: apiUrl(`${sensorPath(z, sensorId)}/destinations/${segment(z, data.id)}`),
    skipThrowForStatus: true,
  });
  // A 404 means the destination is already gone (for example removed in Evinor).
  if (response.status !== 404) {
    response.throwForStatus();
  }
  return {};
};

/** The signature header, matched case-insensitively; undefined when absent. */
const findSignatureHeader = (headers) => {
  const entry = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === SIGNATURE_HEADER,
  );
  return entry?.[1];
};

/** The parsed delivery body: the raw content when Zapier provides it. */
const readBody = (bundle) => {
  const content = bundle.rawRequest?.content;
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }
  return bundle.cleanedRequest;
};

/**
 * Verifies the delivery (design Decision 4) and maps it. Any failure returns
 * [] so no Zap run starts, and logs only the failing step's name: never
 * subscribeData or the envelope. It never throws, because a throw would show
 * up in the user's Zap history and anyone could fill it.
 */
const perform = async (z, bundle) => {
  let body;
  let reason;
  try {
    body = readBody(bundle);
    const data = bundle.subscribeData ?? {};
    reason = safeRejectionReason({
      body,
      signatureHeader: findSignatureHeader(bundle.rawRequest?.headers),
      secret: data.signing_secret,
      keyId: data.key_id,
      nowMs: Date.now(),
    });
  } catch {
    reason = 'unverifiable';
  }
  if (reason !== null) {
    z.console.log(`Evinor delivery rejected: ${reason}`);
    return [];
  }
  try {
    return [mapEnvelopeToItem(body, { sensorId: bundle.subscribeData?.sensor_id })];
  } catch {
    z.console.log('Evinor delivery rejected: unmappable');
    return [];
  }
};

/** The built-in sample (design Decision 5): no API call, never charged. */
const sampleItem = (sensorId) => mapEnvelopeToItem(sampleEnvelope, { sensorId });

const performList = async (z, bundle) => [sampleItem(bundle.inputData?.sensor_id)];

module.exports = {
  key: 'new_sensor_event',
  noun: 'Sensor Event',
  display: {
    label: 'New Sensor Event',
    description: 'Triggers when one of your Evinor sensors matches an event (instant).',
  },
  operation: {
    type: 'hook',
    inputFields: [
      {
        key: 'sensor_id',
        label: 'Sensor',
        required: true,
        dynamic: 'sensor.id.name',
        helpText:
          'The sensor that starts this Zap. Turning the Zap on connects it to the sensor; turning it off disconnects it.',
      },
    ],
    performSubscribe: subscribe,
    performUnsubscribe: unsubscribe,
    perform,
    performList,
    sample: sampleItem('b3c0a7a4-2f4e-4d6b-9a51-0c1d2e3f4a5b'),
    outputFields: [
      { key: 'id', label: 'Delivery ID (stable across retries)' },
      { key: 'message_id', label: 'Message ID (changes on each retry)' },
      { key: 'is_test', label: 'Is Test', type: 'boolean' },
      { key: 'sensor_id', label: 'Sensor ID' },
      { key: 'matched_at', label: 'Matched At', type: 'datetime' },
      { key: 'event_id', label: 'Event ID' },
      { key: 'event_date', label: 'Event Date', type: 'datetime' },
      { key: 'title', label: 'Title' },
      { key: 'event_type', label: 'Event Type Code' },
      { key: 'event_type_name', label: 'Event Type' },
      { key: 'raw', label: 'Raw Payload (JSON)' },
    ],
  },
};
