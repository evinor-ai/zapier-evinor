'use strict';

const { apiUrl } = require('../lib/api');

/**
 * Returns the first matching entity, or [] so Zapier's "if nothing is found"
 * setting (stop, continue, or create) decides what happens next.
 */
const perform = async (z, bundle) => {
  const response = await z.request({
    url: apiUrl('/v1/entities/search'),
    params: { query: String(bundle.inputData.query ?? '').trim(), limit: 1 },
  });
  const { data = [] } = response.data;
  return data.slice(0, 1).map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: entity.type ?? null,
  }));
};

module.exports = {
  key: 'find_entity',
  noun: 'Entity',
  display: {
    label: 'Find Entity',
    description: 'Finds a company, person or other named entity by name.',
  },
  operation: {
    inputFields: [
      {
        key: 'query',
        label: 'Name',
        required: true,
        helpText: 'The name to search for. The first match is returned.',
      },
    ],
    perform,
    sample: { id: '3f1c2b9a-52de-4a53-9c1e-7a1f0e6b8d21', name: 'TechCorp', type: 'ORGANIZATION' },
    outputFields: [
      { key: 'id', label: 'Entity ID' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
    ],
  },
};
