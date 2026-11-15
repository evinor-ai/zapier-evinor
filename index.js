'use strict';

const authentication = require('./authentication');
const { befores, afters } = require('./lib/middleware');
const dropdowns = require('./triggers/dropdowns');
const newSensorEvent = require('./triggers/newSensorEvent');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  // Input arrives exactly as mapped; each step coerces what it needs itself.
  flags: { cleanInputData: false },

  authentication,
  beforeRequest: [...befores],
  afterResponse: [...afters],

  triggers: {
    [newSensorEvent.key]: newSensorEvent,
    [dropdowns.sensor.key]: dropdowns.sensor,
    [dropdowns.beat.key]: dropdowns.beat,
    [dropdowns.eventType.key]: dropdowns.eventType,
  },
  searches: {},
  creates: {},
};
