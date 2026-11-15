'use strict';

const { apiUrl, segment } = require('../lib/api');

// The API's maximum page size for beat entries.
const PAGE_SIZE = 50;

const mapEntry = (entry, beatId) => ({
  id: entry.id,
  beat_id: beatId,
  matched_clause_id: entry.matched_clause_id ?? null,
  occurred_at: entry.occurred_at ?? null,
  added_at: entry.added_at ?? null,
  backfilled: entry.backfilled === true,
  event_id: entry.event.id ?? null,
  event_type: entry.event.event_type?.code_name ?? null,
  sentence: entry.event.sentence ?? null,
  happened_at: entry.event.happened_at ?? null,
  event_date: entry.event.event_date?.value ?? null,
});

/**
 * A window read of the last 24 hours, newest first. Reading entries is not
 * charged. Zapier deduplicates on `id` (the entry id), so only new entries
 * start a Zap run. An entry whose event is null has nothing to act on.
 */
const perform = async (z, bundle) => {
  const beatId = String(bundle.inputData.beat_id);
  const response = await z.request({
    method: 'POST',
    url: apiUrl(`/v1/beats/${segment(z, beatId)}/entries`),
    body: { last: '24h', limit: PAGE_SIZE },
  });
  const { data = [] } = response.data;
  return data
    .filter((entry) => entry.event !== null && entry.event !== undefined)
    .map((entry) => mapEntry(entry, beatId));
};

module.exports = {
  key: 'new_beat_entry',
  noun: 'Beat Entry',
  display: {
    label: 'New Beat Entry',
    description: 'Triggers when a new entry is added to one of your Evinor beats.',
  },
  operation: {
    type: 'polling',
    inputFields: [
      {
        key: 'beat_id',
        label: 'Beat',
        required: true,
        dynamic: 'beat.id.name',
        helpText: 'The beat to watch. Reading entries is not charged.',
      },
    ],
    perform,
    sample: {
      id: '0c9d8e7f-6a5b-4c3d-9e2f-1a0b9c8d7e6f',
      beat_id: '5e8f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
      matched_clause_id: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
      occurred_at: '2026-04-01T12:00:00.000Z',
      added_at: '2026-04-01T12:05:00.000Z',
      backfilled: false,
      event_id: 'incident-golden-1',
      event_type: 'LAYOFF',
      sentence: 'TechCorp laid off 200 people.',
      happened_at: '2026-04-01',
      event_date: '2026-04-01T00:00:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Entry ID' },
      { key: 'beat_id', label: 'Beat ID' },
      { key: 'matched_clause_id', label: 'Matched Clause ID' },
      { key: 'occurred_at', label: 'Occurred At', type: 'datetime' },
      { key: 'added_at', label: 'Added At', type: 'datetime' },
      { key: 'backfilled', label: 'Backfilled', type: 'boolean' },
      { key: 'event_id', label: 'Event ID' },
      { key: 'event_type', label: 'Event Type Code' },
      { key: 'sentence', label: 'Sentence' },
      { key: 'happened_at', label: 'Happened At' },
      { key: 'event_date', label: 'Event Date', type: 'datetime' },
    ],
  },
};
