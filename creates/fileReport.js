'use strict';

const { createHash } = require('node:crypto');

const { apiUrl } = require('../lib/api');
const { canonicalizeJcs } = require('../lib/verifier');

const ROLE_PREFIX = 'role__';
const UNIT_SUFFIX = '__unit';

// Expected types whose value is sent as `amount` (mirrors the API).
const AMOUNT_TYPES = new Set([
  'CURRENCY',
  'NUMBER',
  'DISTANCE',
  'WEIGHT',
  'LENGTH',
  'AREA',
  'VOLUME',
  'TEMPERATURE',
  'SPEED',
]);

/** The single value field a role of this expected type sends. */
const valueField = (expectedType) => {
  if (expectedType === 'NAMED_ENTITY') return 'entity_id';
  if (expectedType === 'DATE') return 'date';
  if (AMOUNT_TYPES.has(expectedType)) return 'amount';
  return 'text'; // DURATION, NONE and a legacy null type.
};

// CATEGORICAL roles cannot be filed through the API yet (any value is rejected).
const isFileable = (role) => role.expected_type !== 'CATEGORICAL';

const fetchEventType = async (z, eventTypeId) => {
  const response = await z.request({ url: apiUrl('/v1/event-types') });
  const { data = [] } = response.data;
  return data.find((eventType) => eventType.id === eventTypeId);
};

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

/** One input per role, typed by its expected type (design Decision 7, task 4.5). */
const roleInputFields = async (z, bundle) => {
  const eventTypeId = bundle.inputData?.event_type_id;
  if (isBlank(eventTypeId)) {
    return [];
  }
  const eventType = await fetchEventType(z, String(eventTypeId));
  if (eventType === undefined) {
    return [];
  }
  return (eventType.roles ?? []).filter(isFileable).flatMap((role) => {
    const key = `${ROLE_PREFIX}${role.code_name}`;
    const label = role.name ?? role.code_name;
    switch (valueField(role.expected_type)) {
      case 'entity_id':
        return [
          {
            key,
            label,
            type: 'string',
            helpText: `The Evinor entity ID for ${label}. Use a **Find Entity** step to look it up by name.`,
          },
        ];
      case 'date':
        return [{ key, label, type: 'string', helpText: `${label} as a date: YYYY-MM-DD.` }];
      case 'amount':
        return [
          { key, label, type: 'number', helpText: `${label} as a number (${role.expected_type}).` },
          {
            key: `${key}${UNIT_SUFFIX}`,
            label: `${label}: unit`,
            type: 'string',
            helpText: `The unit of ${label}, for example \`USD\` for a currency. Leave empty if it has none.`,
          },
        ];
      default:
        return [{ key, label, type: 'string' }];
    }
  });
};

/** Builds the API role value for one input, or throws a clear error. */
const roleValue = (z, role, inputData) => {
  const raw = inputData[`${ROLE_PREFIX}${role.code_name}`];
  if (isBlank(raw)) {
    return undefined;
  }
  const text = String(raw).trim();
  switch (valueField(role.expected_type)) {
    case 'entity_id':
      return { role: role.code_name, entity_id: text };
    case 'date': {
      const date = /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0];
      if (date === undefined) {
        throw new z.errors.Error(`${role.code_name} must be a date in YYYY-MM-DD form.`, 'InvalidInput', 400);
      }
      return { role: role.code_name, date };
    }
    case 'amount': {
      const value = typeof raw === 'number' ? raw : Number(text);
      if (!Number.isFinite(value)) {
        throw new z.errors.Error(`${role.code_name} must be a number.`, 'InvalidInput', 400);
      }
      const unit = inputData[`${ROLE_PREFIX}${role.code_name}${UNIT_SUFFIX}`];
      return { role: role.code_name, amount: { value, unit: isBlank(unit) ? '' : String(unit).trim() } };
    }
    default:
      return { role: role.code_name, text };
  }
};

/**
 * Hex SHA-256 of a key-sorted (JCS) JSON of the report's inputs, the optional
 * deduplication key and, only when Zapier provides it, the Zap id. Identical
 * inputs therefore file one report, ever (design Decision 7).
 */
const idempotencyKey = (material) => {
  const defined = Object.fromEntries(Object.entries(material).filter(([, value]) => value !== undefined));
  return createHash('sha256').update(canonicalizeJcs(defined), 'utf8').digest('hex');
};

const perform = async (z, bundle) => {
  const { inputData } = bundle;
  const eventTypeId = String(inputData.event_type_id ?? '').trim();
  const eventType = await fetchEventType(z, eventTypeId);
  if (eventType === undefined) {
    throw new z.errors.Error(
      'This event type does not exist or is no longer active. Choose another event type.',
      'UnknownEventType',
      400,
    );
  }

  const roles = (eventType.roles ?? [])
    .filter(isFileable)
    .map((role) => roleValue(z, role, inputData))
    .filter((role) => role !== undefined)
    .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));

  const body = {
    event_type_id: eventTypeId,
    happened_at: String(inputData.happened_at ?? '').trim(),
    roles,
  };
  if (!isBlank(inputData.description)) {
    body.description = String(inputData.description).trim();
  }

  const zapId = bundle.meta?.zap?.id;
  const key = idempotencyKey({
    ...body,
    dedup_key: isBlank(inputData.dedup_key) ? undefined : String(inputData.dedup_key).trim(),
    zap_id: isBlank(zapId) ? undefined : String(zapId),
  });

  const response = await z.request({
    method: 'POST',
    url: apiUrl('/v1/reports'),
    headers: { 'Idempotency-Key': key },
    body,
  });
  return response.data;
};

const DESCRIPTION =
  'Files a first-hand report of an event to Evinor, published under your name. Needs the REPORTS_WRITE scope.';

const IDEMPOTENCY_HELP =
  'Identical inputs file only one report, ever: a repeat gets the original report back, or an error that it was ' +
  'already submitted. When Zapier does not provide a Zap ID, two Zaps on the same connection with identical inputs ' +
  'share that one report. To file the same content again on purpose, map a changing value (such as a trigger ID ' +
  'or timestamp) into **Deduplication key**.';

module.exports = {
  key: 'file_report',
  noun: 'Report',
  display: {
    label: 'File a Report',
    description: DESCRIPTION,
  },
  operation: {
    inputFields: [
      {
        key: 'event_type_id',
        label: 'Event Type',
        required: true,
        dynamic: 'event_type.id.name',
        altersDynamicFields: true,
      },
      {
        key: 'about',
        label: 'About this action',
        type: 'copy',
        helpText:
          'Needs the `REPORTS_WRITE` scope, which is sales-gated and granted on request (hi@evinor.ai). ' +
          IDEMPOTENCY_HELP,
      },
      {
        key: 'happened_at',
        label: 'Happened At',
        type: 'datetime',
        required: true,
        helpText: 'When the event happened, as an ISO-8601 timestamp. It must not be in the future.',
      },
      roleInputFields,
      {
        key: 'description',
        label: 'Description',
        type: 'text',
        required: false,
        helpText: 'Optional context, up to 5,000 characters.',
      },
      {
        key: 'dedup_key',
        label: 'Deduplication key',
        type: 'string',
        required: false,
        helpText:
          'Optional. Never sent to Evinor; it only changes which inputs count as identical. ' + IDEMPOTENCY_HELP,
      },
    ],
    perform,
    sample: {
      id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      object: 'report',
      status: 'SUBMITTED',
      event_type_id: '7d1e2f3a-4b5c-4d6e-8f9a-0b1c2d3e4f5a',
      happened_at: '2026-09-14T00:00:00.000Z',
      roles: [{ role: 'RECIPIENT', entity_id: '3f1c2b9a-52de-4a53-9c1e-7a1f0e6b8d21' }],
      description: null,
      grant_id: null,
      published_as: { name: 'Acme', kind: 'ORGANIZATION' },
      incident_id: null,
      incident_report_id: null,
      created_at: '2026-09-14T09:00:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Report ID' },
      { key: 'status', label: 'Status' },
      { key: 'event_type_id', label: 'Event Type ID' },
      { key: 'happened_at', label: 'Happened At', type: 'datetime' },
      { key: 'incident_id', label: 'Event ID' },
      { key: 'created_at', label: 'Created At', type: 'datetime' },
    ],
  },
};
