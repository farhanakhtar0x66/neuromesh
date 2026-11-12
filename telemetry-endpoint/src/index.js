// [F52 telemetry] The endpoint testers' reports go to: a Cloudflare Worker
// with a D1 database. Deploy it with the steps in ../README.md.
//
//   POST /v1/report    one report (JSON, at most 256 KB), with the header
//                      x-neuromesh-key: <INGEST_KEY>. Returns 201.
//   GET  /v1/reports   reports received after ?since=<ISO time>, oldest first,
//                      at most 1000, with Authorization: Bearer <ADMIN_TOKEN>.
//   GET  /v1/health    "ok".
//
// Reports are stored as sent; the client already leaves out code, diffs, file
// locations and anything that says who the tester is.

const MAX_BYTES = 256 * 1024;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/v1/health") return new Response("ok");

    if (url.pathname === "/v1/report" && request.method === "POST") {
      if (request.headers.get("x-neuromesh-key") !== env.INGEST_KEY) return json({ error: "unknown client" }, 401);
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: "too large" }, 413);
      let report;
      try {
        report = JSON.parse(text);
      } catch {
        return json({ error: "not JSON" }, 400);
      }
      if (typeof report !== "object" || report === null || typeof report.install !== "string" || !["run", "rating"].includes(report.type)) {
        return json({ error: "not a Neuromesh report" }, 400);
      }
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      await env.DB.prepare("INSERT INTO reports (id, received, install, type, version, body) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, at, String(report.install).slice(0, 64), report.type, String(report.version ?? "").slice(0, 32), text)
        .run();
      return json({ id }, 201);
    }

    if (url.pathname === "/v1/reports" && request.method === "GET") {
      const auth = request.headers.get("authorization") ?? "";
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "not allowed" }, 401);
      const since = url.searchParams.get("since") ?? "";
      const { results } = await env.DB.prepare("SELECT id, received, install, type, version, body FROM reports WHERE received > ? ORDER BY received LIMIT 1000").bind(since).all();
      return json(results);
    }

    return json({ error: "not found" }, 404);
  },
};
