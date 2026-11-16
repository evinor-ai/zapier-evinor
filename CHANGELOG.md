# Changelog

## 1.1.0

- Removed File a Report. This app watches Evinor; it does not file or publish reports. Evinor fires
  on what happens in the world. A Zap runs on arbitrary triggers in other tools, so a report filed
  from one would be filed without a person deciding, and publishing reports is invite-only.
- Removed the hidden Event Type dropdown, which only File a Report used.
- The connection help text no longer mentions `REPORTS_WRITE`. Scopes needed: `SENSORS_READ` and
  `SENSORS_WRITE` (New Sensor Event), `BEATS_READ` (New Beat Entry), `REPORTS_READ` (Find Entity).

## 1.0.1

First release. (Zapier already held an empty `1.0.0` created in its web UI, which the CLI cannot overwrite, so the first CLI release is `1.0.1`.)

- New Sensor Event (instant), with signature, key id and timestamp verification and a free
  built-in sample.
- New Beat Entry (polling).
- Find Entity (search).
- File a Report (action), idempotent on its inputs.
- API key authentication.
