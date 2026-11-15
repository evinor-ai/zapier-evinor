'use strict';

const asObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};

const stringOrNull = (value) => (typeof value === 'string' ? value : null);

/**
 * Roles flattened to `role__<CODE>`. A role code can repeat (a list, not a
 * map), so repeated values are joined with ", " instead of overwriting.
 * Object.fromEntries defines own properties, so no code can alter the
 * result's prototype.
 */
const flattenRoles = (roles) => {
  const grouped = new Map();
  for (const role of Array.isArray(roles) ? roles.map(asObject) : []) {
    if (typeof role.code !== 'string' || role.code === '') {
      continue;
    }
    const values = grouped.get(role.code) ?? [];
    if (role.textValue !== undefined && role.textValue !== null) {
      values.push(String(role.textValue));
    }
    grouped.set(role.code, values);
  }
  return Object.fromEntries([...grouped].map(([code, values]) => [`role__${code}`, values.join(', ')]));
};

/**
 * Maps a verified envelope to one Zapier item (design Decision 6): shallow
 * keys for the field picker, plus `raw`, the full payload as a JSON string.
 * `id` is the envelope's idempotencyKey, stable across delivery retries, so
 * Zapier deduplicates on it. The `sender` block, with the signature, is
 * never part of the output.
 */
const mapEnvelopeToItem = (envelope, { sensorId } = {}) => {
  const payload = asObject(envelope.payload);
  const details = asObject(payload.details);
  const recipients = asObject(envelope.recipients);
  const eventType = stringOrNull(payload.eventCodeName) ?? stringOrNull(details.templateCodeName);

  return {
    id: stringOrNull(envelope.idempotencyKey) ?? stringOrNull(envelope.messageId),
    message_id: stringOrNull(envelope.messageId),
    is_test: recipients.kind === 'incident-rule-test',
    sensor_id: sensorId ?? stringOrNull(recipients.ruleId),
    matched_at: stringOrNull(details.matchedAt) ?? stringOrNull(payload.occurredAt),
    event_id: stringOrNull(payload.externalEventId) ?? stringOrNull(details.incidentId),
    event_date: stringOrNull(asObject(payload.eventDate).value),
    title: stringOrNull(details.generatedSentence),
    event_type: eventType,
    event_type_name: stringOrNull(details.templateDisplayName) ?? eventType,
    ...flattenRoles(details.roles),
    raw: JSON.stringify(payload),
  };
};

module.exports = { mapEnvelopeToItem };
