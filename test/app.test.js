'use strict';

const App = require('../index');

describe('app definition', () => {
  it('has no creates: the app watches Evinor and never files or publishes reports', () => {
    expect(App.creates ?? {}).toEqual({});
  });

  it('registers exactly the watching steps', () => {
    expect(Object.keys(App.triggers).sort()).toEqual([
      'beat',
      'new_beat_entry',
      'new_sensor_event',
      'sensor',
    ]);
    expect(Object.keys(App.searches)).toEqual(['find_entity']);
  });
});
