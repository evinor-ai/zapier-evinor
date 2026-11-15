# Evinor app for Zapier

This is the [Zapier](https://zapier.com/) integration for [Evinor](https://evinor.ai). Evinor
watches news, regulators and public records for events that affect the companies you care about,
such as layoffs, funding rounds, breaches and insolvencies.

- [Connecting your account](#connecting-your-account)
- [Development](#development)
- [License](#license)

## Connecting your account

Connect with an Evinor API key. Create one in the Evinor app under **Settings → API keys**, and give
it the scopes for the steps you use:

| Scope           | Needed for                       |
| --------------- | -------------------------------- |
| `SENSORS_READ`  | New Sensor Event (and the test)  |
| `SENSORS_WRITE` | New Sensor Event                 |
| `BEATS_READ`    | New Beat Entry                   |
| `REPORTS_READ`  | Find Entity, File a Report       |
| `REPORTS_WRITE` | File a Report                    |

`REPORTS_WRITE` is sales-gated and granted on request (hi@evinor.ai). Zapier tests the connection
with `GET /v1/sensors?limit=1`, so a key without it still connects. The connection is labelled with
the key's last four characters only.

## Development

Requires Node.js 22 (see `.nvmrc`).

```bash
npm ci
npm test
npx zapier-platform validate
```

## License

[MIT](LICENSE)
