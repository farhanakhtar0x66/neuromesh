"""A small stand-in for FastAPI and pydantic (stdlib only), used when the real
packages are not installed. It covers what a webhook endpoint uses: routes on
FastAPI/APIRouter, Request, Header/Body/Query/Depends, HTTPException,
Response/JSONResponse, simple pydantic models, and a TestClient that calls the
handler the way the framework would (422 for a missing required header, 400
for what the handler raises, and so on). `install()` puts the modules in
sys.modules."""
import asyncio, inspect, json, sys, types, typing
from urllib.parse import parse_qsl, urlsplit


class HTTPException(Exception):
    def __init__(self, status_code, detail=None, headers=None):
        self.status_code, self.detail, self.headers = status_code, detail, headers


class Response:
    def __init__(self, content=None, status_code=200, headers=None, media_type=None, **kw):
        self.body, self.status_code, self.headers, self.media_type = content, status_code, headers or {}, media_type


class JSONResponse(Response):
    pass


class PlainTextResponse(Response):
    pass


class _Headers(dict):
    def __init__(self, items):
        super().__init__({k.lower(): v for k, v in items.items()})

    def get(self, k, d=None):
        return super().get(k.lower(), d)

    def __getitem__(self, k):
        return super().__getitem__(k.lower())

    def __contains__(self, k):
        return super().__contains__(k.lower())


class Request:
    def __init__(self, method="POST", path="/", body=b"", headers=None, query=""):
        self.method, self._body, self.headers = method, body, _Headers(headers or {})
        self.url = types.SimpleNamespace(path=path, query=query)
        self.query_params = dict(parse_qsl(query))
        self.state = types.SimpleNamespace()
        self.client = types.SimpleNamespace(host="127.0.0.1", port=1)
        self.app = None

    async def body(self):
        return self._body

    async def json(self):
        return json.loads(self._body)

    async def stream(self):
        yield self._body


class BackgroundTasks:
    def __init__(self):
        self.tasks = []

    def add_task(self, fn, *a, **k):
        self.tasks.append((fn, a, k))


class _Marker:
    def __init__(self, kind, default=..., alias=None, **kw):
        self.kind, self.default, self.alias = kind, default, alias


def Header(default=..., alias=None, **kw):
    return _Marker("header", default, alias)


def Body(default=..., **kw):
    return _Marker("body", default)


def Query(default=..., **kw):
    return _Marker("query", default)


class _Depends:
    def __init__(self, dependency=None, **kw):
        self.dependency = dependency


def Depends(dependency=None, **kw):
    return _Depends(dependency)


class ValidationError(Exception):
    pass


class BaseModel:
    def __init_subclass__(cls, **kw):
        cls._fields = {}
        for base in reversed(cls.__mro__[1:]):
            cls._fields.update(getattr(base, "_fields", {}))
        for name in getattr(cls, "__annotations__", {}):
            cls._fields[name] = getattr(cls, name, ...)

    def __init__(self, **data):
        for name, default in type(self)._fields.items():
            if name in data:
                setattr(self, name, data[name])
            elif default is not ... and not isinstance(default, _Field):
                setattr(self, name, default)
            elif isinstance(default, _Field) and default.default is not ...:
                setattr(self, name, default.default)
            else:
                raise ValidationError(f"field {name} required")
        for k, v in data.items():
            if not hasattr(self, k):
                setattr(self, k, v)

    @classmethod
    def model_validate(cls, data):
        return cls(**data)

    parse_obj = model_validate

    @classmethod
    def model_validate_json(cls, raw):
        return cls(**json.loads(raw))

    parse_raw = model_validate_json

    def model_dump(self, **kw):
        return {k: getattr(self, k) for k in type(self)._fields}

    dict = model_dump


class _Field:
    def __init__(self, default=..., **kw):
        self.default = default


def Field(default=..., **kw):
    return _Field(default)


class _Route:
    def __init__(self, method, path, fn, status_code):
        self.method, self.path, self.fn, self.status_code = method, path, fn, status_code


class APIRouter:
    def __init__(self, prefix="", **kw):
        self.prefix, self.routes = prefix, []
        self.exception_handlers = {}

    def _reg(self, method):
        def decorator(path, status_code=None, **kw):
            def deco(fn):
                self.routes.append(_Route(method, self.prefix + path, fn, status_code))
                return fn
            return deco
        return decorator

    def __getattr__(self, name):
        if name in ("get", "post", "put", "delete", "patch", "head", "options"):
            return self._reg(name.upper())
        raise AttributeError(name)

    def api_route(self, path, methods=("GET",), **kw):
        def deco(fn):
            for m in methods:
                self.routes.append(_Route(m.upper(), self.prefix + path, fn, kw.get("status_code")))
            return fn
        return deco

    def add_api_route(self, path, endpoint, methods=("GET",), **kw):
        self.api_route(path, methods, **kw)(endpoint)

    def include_router(self, router, prefix="", **kw):
        for r in router.routes:
            self.routes.append(_Route(r.method, prefix + r.path, r.fn, r.status_code))


class FastAPI(APIRouter):
    def __init__(self, *a, **kw):
        super().__init__()
        self.state = types.SimpleNamespace()
        self.dependency_overrides = {}

    def middleware(self, kind):
        return lambda fn: fn

    def on_event(self, kind):
        return lambda fn: fn

    def exception_handler(self, exc):
        def deco(fn):
            self.exception_handlers[exc] = fn
            return fn
        return deco


class _Resp:
    def __init__(self, status_code, body):
        self.status_code, self.content = status_code, body
        self.text = body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body)

    def json(self):
        return json.loads(self.text)


def _run(x):
    return asyncio.run(x) if inspect.iscoroutine(x) else x


class TestClient:
    def __init__(self, app, **kw):
        self.app = app

    def post(self, url, content=None, data=None, json=None, headers=None, **kw):
        import json as _json
        body = content if content is not None else data
        if json is not None:
            body = _json.dumps(json).encode()
            headers = {"content-type": "application/json", **(headers or {})}
        if isinstance(body, str):
            body = body.encode()
        return self.request("POST", url, body or b"", headers or {})

    def get(self, url, headers=None, **kw):
        return self.request("GET", url, b"", headers or {})

    def request(self, method, url, body, headers):
        parts = urlsplit(url)
        request = Request(method, parts.path, body, headers, parts.query)
        routes = [r for r in self.app.routes if r.path == parts.path]
        if not routes:
            return _Resp(404, b'{"detail":"Not Found"}')
        route = next((r for r in routes if r.method == method), None)
        if route is None:
            return _Resp(405, b'{"detail":"Method Not Allowed"}')
        try:
            value = _run(self._call(route.fn, request, body, parts.query))
            status = route.status_code or 200
        except HTTPException as e:
            return _Resp(e.status_code, _dump({"detail": e.detail}))
        except _Invalid as e:
            return _Resp(422, _dump({"detail": str(e)}))
        except Exception as e:
            for exc, handler in self.app.exception_handlers.items():
                if isinstance(e, exc):
                    return self._to_resp(_run(handler(request, e)), 200)
            return _Resp(500, _dump({"detail": f"{type(e).__name__}: {e}"}))
        return self._to_resp(value, status)

    def _to_resp(self, value, status):
        if isinstance(value, Response):
            b = value.body
            return _Resp(value.status_code, b if isinstance(b, (bytes, str)) else _dump(b))
        if isinstance(value, BaseModel):
            value = value.model_dump()
        return _Resp(status, _dump(value))

    async def _call(self, fn, request, body, query):
        kwargs = await self._resolve(fn, request, body, query)
        r = fn(**kwargs)
        if inspect.isawaitable(r):
            r = await r
        return r

    async def _resolve(self, fn, request, body, query):
        try:
            hints = typing.get_type_hints(fn, include_extras=True)
        except Exception:
            hints = {}
        kwargs = {}
        for name, p in inspect.signature(fn).parameters.items():
            ann = hints.get(name, p.annotation)
            default = p.default
            if typing.get_origin(ann) is typing.Annotated:
                args = typing.get_args(ann)
                ann = args[0]
                for meta in args[1:]:
                    if isinstance(meta, (_Marker, _Depends)):
                        default = meta
            if ann is Request or name == "request":
                kwargs[name] = request
            elif ann is BackgroundTasks:
                kwargs[name] = BackgroundTasks()
            elif isinstance(default, _Depends):
                dep = self.app.dependency_overrides.get(default.dependency, default.dependency)
                r = dep(**(await self._resolve(dep, request, body, query)))
                kwargs[name] = await r if inspect.isawaitable(r) else r
            elif isinstance(default, _Marker) and default.kind == "header":
                v = request.headers.get(default.alias or name.replace("_", "-"))
                if v is None:
                    if default.default is ...:
                        raise _Invalid(f"header {name} required")
                    v = default.default
                kwargs[name] = v
            elif isinstance(default, _Marker) and default.kind == "body" or ann is bytes or ann is dict or (isinstance(ann, type) and issubclass(ann, BaseModel)):
                if ann is bytes:
                    kwargs[name] = body
                    continue
                try:
                    data = json.loads(body)
                    kwargs[name] = ann(**data) if isinstance(ann, type) and issubclass(ann, BaseModel) else data
                except Exception as e:
                    raise _Invalid(f"body invalid: {e}")
            else:
                q = dict(parse_qsl(query)).get(name)
                if q is None:
                    if default is inspect.Parameter.empty or (isinstance(default, _Marker) and default.default is ...):
                        raise _Invalid(f"query {name} required")
                    q = default.default if isinstance(default, _Marker) else default
                kwargs[name] = q
        return kwargs


class _Invalid(Exception):
    pass


def _dump(v):
    try:
        return json.dumps(v).encode()
    except TypeError:
        return json.dumps(str(v)).encode()


def install():
    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        sys.modules[name] = m
        return m
    status = mod("fastapi.status", **{f"HTTP_{c}_{n}": c for c, n in
                 [(200, "OK"), (201, "CREATED"), (204, "NO_CONTENT"), (400, "BAD_REQUEST"), (401, "UNAUTHORIZED"),
                  (403, "FORBIDDEN"), (404, "NOT_FOUND"), (422, "UNPROCESSABLE_ENTITY"), (500, "INTERNAL_SERVER_ERROR")]})
    fa = mod("fastapi", FastAPI=FastAPI, APIRouter=APIRouter, Request=Request, Response=Response, HTTPException=HTTPException,
             Header=Header, Body=Body, Query=Query, Depends=Depends, BackgroundTasks=BackgroundTasks, status=status)
    fa.__path__ = []
    mod("fastapi.responses", JSONResponse=JSONResponse, Response=Response, PlainTextResponse=PlainTextResponse)
    mod("fastapi.testclient", TestClient=TestClient)
    mod("fastapi.exceptions", HTTPException=HTTPException)
    mod("starlette.requests", Request=Request)
    mod("starlette.responses", JSONResponse=JSONResponse, Response=Response, PlainTextResponse=PlainTextResponse)
    mod("starlette.status", **status.__dict__)
    mod("starlette.exceptions", HTTPException=HTTPException)
    mod("pydantic", BaseModel=BaseModel, Field=Field, ValidationError=ValidationError,
        validator=lambda *a, **k: (lambda f: f), field_validator=lambda *a, **k: (lambda f: f))
