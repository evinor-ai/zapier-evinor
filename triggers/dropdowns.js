'use strict';

const { apiUrl } = require('../lib/api');

const PAGE_SIZE = 100;

const hiddenDisplay = (noun) => ({
  label: `List ${noun}s`,
  description: `Lists your Evinor ${noun}s for a dropdown.`,
  hidden: true,
});

/**
 * Sensors: GET /v1/sensors is cursor-paginated (`starting_after` = the
 * previous page's `next_cursor`). Zapier keeps the cursor between pages
 * through z.cursor.
 */
const listSensors = async (z, bundle) => {
  const params = { limit: PAGE_SIZE };
  if ((bundle.meta?.page ?? 0) > 0) {
    const cursor = await z.cursor.get();
    if (!cursor) {
      return [];
    }
    params.starting_after = cursor;
  }

  const response = await z.request({ url: apiUrl('/v1/sensors'), params });
  const { data = [], has_more: hasMore, next_cursor: nextCursor } = response.data;
  await z.cursor.set(hasMore === true && typeof nextCursor === 'string' ? nextCursor : '');

  return data.map((sensor) => ({
    id: sensor.id,
    name: sensor.enabled === false ? `${sensor.name} (disabled)` : sensor.name,
  }));
};

/**
 * Beats and event types are single-page lists: their endpoints take no
 * paging parameters (and reject unknown query parameters).
 */
const singlePageList = (path) => async (z, bundle) => {
  if ((bundle.meta?.page ?? 0) > 0) {
    return [];
  }
  const response = await z.request({ url: apiUrl(path) });
  const { data = [] } = response.data;
  return data.map((item) => ({ id: item.id, name: item.name }));
};

const sensor = {
  key: 'sensor',
  noun: 'Sensor',
  display: hiddenDisplay('sensor'),
  operation: {
    type: 'polling',
    canPaginate: true,
    perform: listSensors,
    sample: { id: 'b3c0a7a4-2f4e-4d6b-9a51-0c1d2e3f4a5b', name: 'Supplier layoffs' },
  },
};

const beat = {
  key: 'beat',
  noun: 'Beat',
  display: hiddenDisplay('beat'),
  operation: {
    type: 'polling',
    perform: singlePageList('/v1/beats'),
    sample: { id: '5e8f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Supplier risk' },
  },
};

const eventType = {
  key: 'event_type',
  noun: 'Event Type',
  display: hiddenDisplay('event type'),
  operation: {
    type: 'polling',
    perform: singlePageList('/v1/event-types'),
    sample: { id: '7d1e2f3a-4b5c-4d6e-8f9a-0b1c2d3e4f5a', name: 'Layoffs' },
  },
};

module.exports = { sensor, beat, eventType };
