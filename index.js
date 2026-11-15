'use strict';

const authentication = require('./authentication');
const { befores, afters } = require('./lib/middleware');
const dropdowns = require('./triggers/dropdowns');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  authentication,
  beforeRequest: [...befores],
  afterResponse: [...afters],

  triggers: {
    [dropdowns.sensor.key]: dropdowns.sensor,
    [dropdowns.beat.key]: dropdowns.beat,
    [dropdowns.eventType.key]: dropdowns.eventType,
  },
  searches: {},
  creates: {},
};
