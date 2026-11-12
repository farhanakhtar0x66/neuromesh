#!/bin/sh
# Deploy the telemetry endpoint in one go, after `npx wrangler login`.
#
#   npx wrangler login
#   sh telemetry-endpoint/deploy.sh
#
# It creates the D1 database (or reuses it), applies the schema, sets the two
# secrets, deploys the worker, and writes its URL into src/telemetry/config.ts.
# The admin token, which reads every report, is made here and kept only in
# ~/.neuromesh/telemetry/admin-token (readable by you alone); it never goes
# into the repository. Run it again any time: it is safe to repeat.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$HERE"
W="npx --yes wrangler@4"
NAME="neuromesh-telemetry"
TOKEN_FILE="${NEUROMESH_HOME:-$HOME/.neuromesh}/telemetry/admin-token"

$W whoami >/dev/null 2>&1 || { echo "Sign in to Cloudflare first: npx wrangler login"; exit 1; }

# The database: reuse it if it is there.
ID=$($W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s||"[]");const d=l.find(x=>x.name===process.argv[1]);process.stdout.write(d?d.uuid:"")})' "$NAME")
if [ -z "$ID" ]; then
  echo "Creating the database $NAME"
  $W d1 create "$NAME" >/dev/null
  ID=$($W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name===process.argv[1]);process.stdout.write(d?d.uuid:"")})' "$NAME")
fi
[ -n "$ID" ] || { echo "Could not find or create the database."; exit 1; }
sed -i.bak "s/^database_id = .*/database_id = \"$ID\"/" wrangler.toml && rm -f wrangler.toml.bak
$W d1 execute "$NAME" --remote --file schema.sql >/dev/null
echo "Database ready: $ID"

# The secrets.
INGEST=$(sed -n 's/^export const INGEST_KEY = "\(.*\)";/\1/p' "$ROOT/src/telemetry/config.ts")
[ -n "$INGEST" ] || { echo "No INGEST_KEY in src/telemetry/config.ts"; exit 1; }
printf %s "$INGEST" | $W secret put INGEST_KEY >/dev/null
mkdir -p "$(dirname "$TOKEN_FILE")"
if [ ! -s "$TOKEN_FILE" ]; then
  (umask 077 && node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$TOKEN_FILE")
fi
chmod 600 "$TOKEN_FILE"
$W secret put ADMIN_TOKEN < "$TOKEN_FILE" >/dev/null
echo "Secrets set (admin token kept in $TOKEN_FILE)"

# Deploy, and point the code at it.
OUT=$($W deploy 2>&1 || true)
if printf %s "$OUT" | grep -q "register a workers.dev subdomain"; then
  echo "Your Cloudflare account has no workers.dev subdomain yet (a one-time, account-wide name)."
  echo "Pick one in the Cloudflare dashboard: Workers & Pages, then your workers.dev subdomain."
  echo "Then run this script again."
  exit 1
fi
URL=$(printf %s "$OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { printf %s "$OUT" | tail -5; echo "Deployed, but could not read the URL; put it in src/telemetry/config.ts by hand."; exit 1; }
sed -i.bak "s|^export const ENDPOINT = \".*\";|export const ENDPOINT = \"$URL\";|" "$ROOT/src/telemetry/config.ts" && rm -f "$ROOT/src/telemetry/config.ts.bak"
curl -fsS "$URL/v1/health" >/dev/null && echo "Live: $URL"
echo
echo "Next: commit src/telemetry/config.ts and telemetry-endpoint/wrangler.toml, and push neuromesh-testing."
echo "Read reports: neuromesh telemetry pull"
