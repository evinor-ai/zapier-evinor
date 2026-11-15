# Evinor app for Zapier

This is the [Zapier](https://zapier.com/) integration for [Evinor](https://evinor.ai). Evinor
watches news, regulators and public records for events that affect the companies you care about,
such as layoffs, funding rounds, breaches and insolvencies. Use it to start a Zap the moment a
sensor matches, to collect new entries from a beat, or to file a first-hand report from any app.

- [Connecting your account](#connecting-your-account)
- [Triggers, search and action](#triggers-search-and-action)
- [New Sensor Event output](#new-sensor-event-output)
- [Security and delivery behavior](#security-and-delivery-behavior)
- [What deduplicates](#what-deduplicates)
- [Development](#development)
- [License](#license)

## Connecting your account

Connect with an Evinor API key (it starts with `evnr_live_`). Create one in the Evinor app under
**Settings → API keys**, and give it the scopes for the steps you use:

| Scope           | Needed for                 |
| --------------- | -------------------------- |
| `SENSORS_READ`  | New Sensor Event           |
| `SENSORS_WRITE` | New Sensor Event           |
| `BEATS_READ`    | New Beat Entry             |
| `REPORTS_READ`  | Find Entity, File a Report |
| `REPORTS_WRITE` | File a Report              |

**`REPORTS_WRITE` is sales-gated** and granted on request (hi@evinor.ai). Zapier tests the
connection with `GET /v1/sensors?limit=1`, so a key without it still connects; File a Report then
fails with the API's message naming the missing scope.

The connection is labelled with the key's last four characters only (for example `…AbCd`). If
Evinor rejects a request, Zapier shows Evinor's own error message.

## Triggers, search and action

| Step                           | What it does                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **New Sensor Event** (instant) | Turning the Zap on connects its hook URL to the sensor as a Zapier destination. Turning it off disconnects it; a destination already removed in Evinor counts as success. Each delivery is verified before the Zap runs. |
| **New Beat Entry** (polling)   | Reads the beat's entries from the last 24 hours, newest first. Reading entries is not charged. Entries without an event are skipped.                                                                                     |
| **Find Entity** (search)       | Finds a company, person or other entity by name and returns the first match, for example to fill a File a Report role. If nothing matches, Zapier's "if nothing is found" setting decides what happens.                  |
| **File a Report** (action)     | Pick an event type, then fill one field per role. Entity roles take an entity ID (use Find Entity), dates take `YYYY-MM-DD`, amounts take a number and a unit. `CATEGORICAL` roles cannot be filed yet.                  |

**Testing New Sensor Event in the Zap editor** shows one built-in sample event with
`is_test: true`. It makes no API call, costs nothing and needs no sensor activity.

## New Sensor Event output

Each event is flattened so every field is easy to pick in Zapier:

| Field             | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `id`              | The delivery's idempotency key. The same for every retry of one delivery.              |
| `message_id`      | The ID of this delivery attempt. A retry gets a new one.                               |
| `is_test`         | `true` for the built-in sample, otherwise `false`.                                     |
| `sensor_id`       | The sensor that matched.                                                               |
| `matched_at`      | When the event cleared the sensor's bar.                                               |
| `event_id`        | The underlying event. One event matching several sensors shares this ID.               |
| `event_date`      | When the event happened, if known.                                                     |
| `title`           | A one-line description, such as "TechCorp laid off 200 people."                        |
| `event_type`      | The event type code, such as `LAYOFF`.                                                 |
| `event_type_name` | The event type's name, such as "Layoffs".                                              |
| `role__<CODE>`    | One field per role, such as `role__COMPANY_NAME`. A repeated role is joined with `, `. |
| `raw`             | The full event payload as a JSON string, for a Code step or Formatter.                 |

The signature and the rest of the `sender` block are never part of the output.

## Security and delivery behavior

**Verification.** Every delivery is checked before a Zap run starts, in this order: the stored
signing details and the envelope fields are present; the `X-Evinor-Signature` header, if Zapier
forwarded it, equals the body's signature; the signature is strict base64; the key id is the one
issued for this Zap; the HMAC-SHA256 matches in constant time; and the timestamp is a strict
ISO-8601 time within 5 minutes of now. Any failure starts no Zap run and logs only the name of the
failed check. A failure never raises an error, so a stranger who learns the hook URL cannot fill
your Zap history.

**A missing signature header is accepted.** This differs from the
[n8n node](https://github.com/evinor-ai/n8n-nodes-evinor). The header is only a consistency check:
the HMAC covers the signature inside the body, and Zapier does not guarantee that every header is
forwarded. A header that is present but different is still rejected.

**Where the signing secret is stored.** Turning the Zap on stores the destination's ID, signing
secret and key id with the Zap (Zapier's `subscribeData`). Anyone who can edit the Zap can see that
secret. It only verifies deliveries to that one hook URL. The app never writes it, or any delivery,
to its logs.

**Replays.** A delivery replayed within the 5-minute window passes verification. Zapier then
deduplicates it on `id` (below).

## What deduplicates

- **New Sensor Event:** Zapier deduplicates on `id`, the delivery's idempotency key, which stays the
  same across Evinor's retries. One event that matches several sensors arrives once per sensor; use
  `event_id` to deduplicate across sensors.
- **New Beat Entry:** Zapier deduplicates on `id`, the entry ID, so only new entries start a run.
- **File a Report:** identical inputs file only one report, ever. The app sends an
  `Idempotency-Key` that is the SHA-256 of the event type, happened-at time, every role value, the
  description, the optional **Deduplication key**, and the Zap ID when Zapier provides one. A retry
  within 24 hours gets the original report back; a later one fails with "report already
  submitted". **Without a Zap ID, two Zaps on the same connection with identical inputs share that
  one report.** To file the same content again on purpose, map a changing value, such as a trigger
  ID or a timestamp, into **Deduplication key**. It is hashed into the key and never sent to Evinor.

## Development

Requires Node.js 22 (see `.nvmrc`).

```bash
npm ci
npm test                          # jest, with HTTP mocked by nock; no network access
npx zapier-platform validate      # schema and Zapier's integration checks
```

The signature verifier in `lib/verifier.js` is vendored from
[`evinor-ai/n8n-nodes-evinor`](https://github.com/evinor-ai/n8n-nodes-evinor) (MIT) and ported to
CommonJS, with the header change described above. The golden fixtures in `test/fixtures/` are
copied from Evinor's envelope library; regenerate them there, never by hand.

`.zapierapprc` links this repo to the Evinor integration (app 249760).

## Releasing

CI runs the tests and `zapier-platform validate` on every pull request. Neither needs a Zapier
login.

To push a version, bump `version` in `package.json` and `CHANGELOG.md` on `main`, then push a
matching tag (`v1.2.3`). The Deploy workflow checks that the tag equals the `package.json` version
and is on `main`, runs the tests, and after a reviewer approves the `zapier-deploy` environment,
runs `zapier-platform push`. Pushing does not move users to the new version: run
`zapier-platform promote <version>` by hand when it should go live.

## License

[MIT](LICENSE)

Questions: hi@evinor.ai
