// [F52 telemetry] Where testers' reports go. Set once the owner has deployed
// the endpoint (telemetry/worker, see its README): the worker's https URL, and
// the ingest key given to it with `wrangler secret put INGEST_KEY`. The ingest
// key is not a secret (every build carries it); it only keeps stray traffic
// out. Reading reports needs the separate ADMIN_TOKEN, which never ships.
//
// Until ENDPOINT is set, reports wait in ~/.neuromesh/telemetry/outbox.

export const ENDPOINT = "https://neuromesh-telemetry.farhanakhtar.workers.dev";
export const INGEST_KEY = "neuromesh-testing-v1";
