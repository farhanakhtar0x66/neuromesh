"""[F139 laya-gate] Serve laya.Agent (Laya 0.5, Apache-2.0) on laya-serve's routes, so its conformal fields
(route, abstain, prediction_set, unbound) reach Neuromesh over HTTP. Stock laya-serve serves the classic Router,
whose answers carry none of them; Neuromesh then counts every answer as review.

Run inside the Laya venv by scripts/laya-sidecar.sh start --agent. Python standard library plus laya only; it
never imports vegaml-learn (noncommercial). Listens on LAYA_HOST (default 127.0.0.1) and LAYA_PORT (default 8787).

  GET  /health        {"status": "ok"}
  POST /v1/systemone  {"state": str, "questions": {id: {"type": "noul", "instructions": str}}}
                      -> {"model": "laya.Agent", "answers": {id: <the agent's answer, as it gives it>}}

Optional: LAYA_AGENT_REPO (passed to laya.Agent), NEUROMESH_LAYA_CALIBRATION (a folder saved by
agent.save_calibration, loaded at start), LAYA_API_KEY (then a Bearer key is required on /v1/systemone).

Not yet run against a real laya install: agent.predict's return shape is passed through as it comes, and
Neuromesh's parser (src/routing/laya-client.ts) reads it strictly; anything it cannot read counts as unavailable.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import laya  # Apache-2.0; installed in the sidecar's own venv, never in Neuromesh

MAX_BODY = 256 * 1024
API_KEY = os.environ.get("LAYA_API_KEY") or None
repo = os.environ.get("LAYA_AGENT_REPO")
agent = laya.Agent(repo) if repo else laya.Agent()
calibration = os.environ.get("NEUROMESH_LAYA_CALIBRATION")
if calibration:
    agent.load_calibration(calibration)


def plain(value):
    """JSON for whatever the agent returns: mappings, sequences, numpy values, small objects."""
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [plain(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "tolist"):
        return plain(value.tolist())
    if hasattr(value, "item"):
        return plain(value.item())
    if hasattr(value, "__dict__"):
        return plain({k: v for k, v in vars(value).items() if not k.startswith("_")})
    return str(value)


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.send(200, {"status": "ok", "model": "laya.Agent", "calibrated": bool(calibration)})
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/systemone":
            return self.send(404, {"error": "not found"})
        if API_KEY and self.headers.get("authorization") != f"Bearer {API_KEY}":
            return self.send(401, {"error": "unauthorized"})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send(413, {"error": "body missing or too large"})
        try:
            request = json.loads(self.rfile.read(length))
            state, questions = request["state"], request["questions"]
            if not isinstance(state, str) or not isinstance(questions, dict):
                raise ValueError("state must be text and questions an object keyed by id")
        except (ValueError, KeyError) as error:
            return self.send(422, {"error": str(error)})
        try:
            result = plain(agent.predict(state, questions))
        except Exception as error:  # the client counts any failure as unavailable
            return self.send(500, {"error": f"{type(error).__name__}: {error}"})
        answers = result.get("answers", result) if isinstance(result, dict) else result
        self.send(200, {"model": "laya.Agent", "answers": answers})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    host = os.environ.get("LAYA_HOST", "127.0.0.1")
    port = int(os.environ.get("LAYA_PORT", "8787"))
    print(f"laya.Agent on http://{host}:{port}", file=sys.stderr)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
