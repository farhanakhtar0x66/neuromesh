"""Import the answer's app.py under the FastAPI stand-in (or real FastAPI, when
installed), send it signed and unsigned webhooks, print what came back as JSON.
    python3 run_app.py <workspace copy>
"""
import hashlib, hmac, importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
work = sys.argv[1]
sys.path.insert(0, work)
sys.path.insert(1, HERE)
SECRET = "whsec_bench_secret_0123456789"
OTHER = "whsec_somebody_elses_secret"


class Env(dict):
    """Any secret-looking variable the app asks for holds the test secret."""
    def _hit(self, k):
        return any(w in k.upper() for w in ("SECRET", "KEY", "TOKEN", "WEBHOOK", "RAZORPAY", "SIGN", "HMAC"))

    def get(self, k, d=None):
        if dict.__contains__(self, k):
            return dict.__getitem__(self, k)
        return SECRET if self._hit(k) else d

    def __getitem__(self, k):
        if dict.__contains__(self, k):
            return dict.__getitem__(self, k)
        if self._hit(k):
            return SECRET
        raise KeyError(k)

    def __contains__(self, k):
        return dict.__contains__(self, k) or self._hit(k)


real = dict(os.environ)
os.environ = Env(real)  # noqa
out = {"import_error": None, "route": False, "results": {}, "framework": "stand-in"}
try:
    try:
        import fastapi  # noqa: F401
        from fastapi.testclient import TestClient  # noqa: F401
        out["framework"] = "real"
    except Exception:
        for k in [k for k in sys.modules if k.split(".")[0] in ("fastapi", "starlette", "pydantic")]:
            del sys.modules[k]
        import fastapi_shim
        fastapi_shim.install()
        from fastapi.testclient import TestClient
    spec = importlib.util.spec_from_file_location("answer_app", os.path.join(work, "app.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["answer_app"] = mod
    spec.loader.exec_module(mod)
    app = getattr(mod, "app", None) or next((v for v in vars(mod).values() if type(v).__name__ == "FastAPI"), None)
    client = TestClient(app)
    out["route"] = any(getattr(r, "path", None) == "/webhooks/payment" and "POST" in (getattr(r, "methods", None) or {getattr(r, "method", "POST")}) for r in app.routes)

    def sign(body, secret=SECRET):
        return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    payload = {"entity": "event", "account_id": "acc_Hd9", "event": "payment.captured",
               "contains": ["payment"], "payload": {"payment": {"entity": {"id": "pay_29QQoUBi66xm2f", "entity": "payment",
               "amount": 50000, "currency": "INR", "status": "captured", "order_id": "order_9A33XWu170gUtm"}}}, "created_at": 1700000000}
    body = json.dumps(payload, separators=(",", ":")).encode()
    odd = b'{"event":   "payment.captured",\n  "payload": {"payment": {"entity": {"id": "pay_1",   "amount": 100}}},  "entity": "event", "account_id": "acc_1", "contains": ["payment"], "created_at": 1}\n'

    def post(b, headers):
        r = client.post("/webhooks/payment", content=b, headers={"content-type": "application/json", **headers})
        return r.status_code

    out["results"] = {
        "valid": post(body, {"X-Signature": sign(body)}),
        "valid_lowercase_header": post(body, {"x-signature": sign(body)}),
        "valid_odd_whitespace": post(odd, {"X-Signature": sign(odd)}),
        "wrong_signature": post(body, {"X-Signature": "0" * 64}),
        "other_secret": post(body, {"X-Signature": sign(body, OTHER)}),
        "missing_header": post(body, {}),
        "tampered_body": post(body.replace(b"50000", b"90000"), {"X-Signature": sign(body)}),
        "empty_signature": post(body, {"X-Signature": ""}),
    }
except BaseException as e:
    import traceback
    out["import_error"] = "".join(traceback.format_exception_only(type(e), e)).strip()[:300]
print(json.dumps(out))
