'use strict';

const authentication = require('./authentication');
const { befores, afters } = require('./lib/middleware');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  authentication,
  beforeRequest: [...befores],
  afterResponse: [...afters],

  triggers: {},
  searches: {},
  creates: {},
};
