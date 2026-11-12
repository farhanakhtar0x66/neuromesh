# Telemetry endpoint

Where testers' reports go (feature F52 `telemetry`): a Cloudflare Worker with a
D1 database, on Cloudflare's free tier. The client side is
`src/telemetry/telemetry.ts`; what a report holds is described there and shown
to every tester before they agree.

## Deploy (once, about five minutes)

You need a Cloudflare account. From this folder:

```sh
npx wrangler login
npx wrangler d1 create neuromesh-telemetry
```

1. Put the `database_id` it prints into `wrangler.toml`. Then:

   ```sh
   npx wrangler d1 execute neuromesh-telemetry --remote --file schema.sql
   npx wrangler secret put INGEST_KEY     # type: neuromesh-testing-v1
   npx wrangler secret put ADMIN_TOKEN    # a long random string; keep it private
   npx wrangler deploy
   ```

2. `deploy` prints the worker's URL (`https://neuromesh-telemetry.<you>.workers.dev`).
   Put it in `src/telemetry/config.ts` as `ENDPOINT`, then commit and push to
   `neuromesh-testing`. From then on, testers' reports arrive, and so do any
   waiting in their outboxes.

## Reading the reports

```sh
NEUROMESH_TELEMETRY_ADMIN=<your ADMIN_TOKEN> neuromesh telemetry pull
```

This saves every report into `~/.neuromesh/telemetry/inbox/`, one JSON file
each, ready to be read and compared.

## Notes

- The ingest key ships in every build, so it is not a secret. It only keeps
  stray traffic out. Reading needs `ADMIN_TOKEN`, which never ships.
- To start again, run `npx wrangler d1 execute neuromesh-telemetry --remote
  --command "DELETE FROM reports"`.
