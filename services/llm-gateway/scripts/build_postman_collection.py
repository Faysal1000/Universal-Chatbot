"""Build services/llm-gateway/postman_collection.json by running every request live.

Usage (from services/llm-gateway, with the compose stack started with `--profile demo` so the
fake provider is reachable from the gateway at http://fake-provider:9100):

    .venv/bin/python scripts/build_postman_collection.py \
        http://localhost:4000 "$LLM_GATEWAY_API_KEY" "$LLM_GATEWAY_REGISTRATION_API_KEY" \
        "$ADMIN_PASSWORD" postman_collection.json

Every request is sent once against the live gateway; its response becomes the saved example.
Secrets are only used for those live calls: the collection stores placeholders.
"""

import json
import re
import sys
import time
import uuid
from collections.abc import Callable
from typing import Any

import httpx

BASE_URL, API_KEY, REGISTRATION_KEY, ADMIN_PASSWORD, OUTPUT_PATH = sys.argv[1:6]
variables: dict[str, str] = {
    "baseUrl": BASE_URL,
    "apiKey": API_KEY,
    "registrationKey": REGISTRATION_KEY,
    "adminUsername": "admin",
    "adminPassword": ADMIN_PASSWORD,
    "fakeProviderUrl": "http://fake-provider:9100",
}
COLLECTION_VARIABLE_DEFAULTS = {
    "baseUrl": "http://localhost:4000",
    "apiKey": "paste-LLM_GATEWAY_API_KEY-from-your-.env-here",
    "registrationKey": "paste-LLM_GATEWAY_REGISTRATION_API_KEY-from-your-.env-here",
    "adminUsername": "admin",
    "adminPassword": "paste-your-admin-password-here",
    "fakeProviderUrl": "http://fake-provider:9100",
}
http_client = httpx.Client(timeout=60)
CSRF_HEADER = {"key": "X-Requested-With", "value": "llm-gateway-dashboard"}
JSON_HEADER = {"key": "Content-Type", "value": "application/json"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def substitute(text: str) -> str:
    return re.sub(
        r"\{\{(\w+)\}\}",
        lambda match: variables.get(match.group(1), match.group(0)),
        text,
    )


def status_test(*codes: int) -> list[str]:
    if len(codes) == 1:
        return [f'pm.test("Status is {codes[0]}", () => pm.response.to.have.status({codes[0]}));']
    return [
        f'pm.test("Status is one of {list(codes)}", () => pm.expect({list(codes)}).to.include(pm.response.code));'
    ]


def openai_error_test(code: str) -> list[str]:
    return [
        'pm.test("OpenAI-shaped error body", () => {',
        "    const error = pm.response.json().error;",
        '    pm.expect(error).to.include.keys("message", "type", "param", "code");',
        f'    pm.expect(error.code).to.eql("{code}");',
        "});",
    ]


def served_by_test(provider_id: str, is_fallback: bool) -> list[str]:
    return [
        'pm.test("Served by the expected provider", () => {',
        f'    pm.expect(pm.response.headers.get("X-LLM-Gateway-Provider")).to.eql("{provider_id}");',
        f'    pm.expect(pm.response.headers.get("X-LLM-Gateway-Fallback")).to.eql("{str(is_fallback).lower()}");',
        "});",
    ]


CHAT_COMPLETION_TESTS = [
    'pm.test("Returns a chat.completion with text", () => {',
    "    const body = pm.response.json();",
    '    pm.expect(body.object).to.eql("chat.completion");',
    '    pm.expect(body.choices[0].message.content).to.be.a("string").and.not.be.empty;',
    "});",
    'pm.test("Reports token usage", () => {',
    "    const usage = pm.response.json().usage;",
    "    pm.expect(usage.prompt_tokens).to.be.above(0);",
    "    pm.expect(usage.completion_tokens).to.be.above(0);",
    "});",
    'pm.test("Has a request ID", () => pm.expect(pm.response.headers.get("X-Request-ID")).to.match(/^[A-Za-z0-9._:-]+$/));',
]
STREAM_TESTS = [
    'pm.test("Is a server-sent event stream", () => pm.expect(pm.response.headers.get("Content-Type")).to.include("text/event-stream"));',
    'const dataLines = pm.response.text().split("\\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6));',
    'pm.test("Ends with [DONE]", () => pm.expect(dataLines[dataLines.length - 1]).to.eql("[DONE]"));',
    "const chunks = dataLines.slice(0, -1).map(line => JSON.parse(line));",
    'pm.test("Streams chat.completion.chunk text deltas", () => {',
    '    const text = chunks.filter(c => c.choices && c.choices.length).map(c => c.choices[0].delta.content || "").join("");',
    "    pm.expect(text).to.not.be.empty;",
    "});",
    'pm.test("Final chunk carries usage (stream_options.include_usage)", () => pm.expect(chunks[chunks.length - 1].usage.completion_tokens).to.be.above(0));',
]
STATUS_TEXT = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    413: "Content Too Large",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    502: "Bad Gateway",
    503: "Service Unavailable",
}


def make_request(
    name: str,
    method: str,
    path: str,
    *,
    description: str,
    body: Any = None,
    raw_body: str | None = None,
    auth: str = "gateway",
    extra_headers: list[dict[str, str]] | None = None,
    tests: list[str],
    captures: list[tuple[str, str, Callable[[Any], Any]]] | None = None,
    prerequest: list[str] | None = None,
    python_body_override: bytes | None = None,
    example_body_note: str | None = None,
) -> dict[str, Any]:
    headers: list[dict[str, str]] = list(extra_headers or [])
    if body is not None or raw_body is not None:
        headers.append(JSON_HEADER)
    if auth == "admin" and method in MUTATING_METHODS:
        headers.append(CSRF_HEADER)
    path_parts = path.split("?")[0].strip("/").split("/")
    url: dict[str, Any] = {
        "raw": "{{baseUrl}}" + path,
        "host": ["{{baseUrl}}"],
        "path": path_parts,
    }
    if "?" in path:
        url["query"] = [
            {"key": key, "value": value}
            for key, value in (pair.split("=", 1) for pair in path.split("?", 1)[1].split("&"))
        ]
    postman_request: dict[str, Any] = {
        "method": method,
        "header": headers,
        "url": url,
        "description": description,
    }
    if auth == "registration":
        postman_request["auth"] = {
            "type": "bearer",
            "bearer": [{"key": "token", "value": "{{registrationKey}}", "type": "string"}],
        }
    elif auth != "gateway":
        postman_request["auth"] = {"type": "noauth"}
    raw_text = (
        raw_body if raw_body is not None else (json.dumps(body, indent=2) if body is not None else None)
    )
    if raw_text is not None:
        postman_request["body"] = {
            "mode": "raw",
            "raw": raw_text,
            "options": {"raw": {"language": "json"}},
        }

    # ----- Execute live to validate and capture a real example response -----
    send_headers = {header["key"]: substitute(header["value"]) for header in headers}
    if auth == "gateway":
        send_headers["Authorization"] = f"Bearer {variables['apiKey']}"
    elif auth == "registration":
        send_headers["Authorization"] = f"Bearer {variables['registrationKey']}"
    content = (
        python_body_override
        if python_body_override is not None
        else (substitute(raw_text).encode() if raw_text is not None else None)
    )
    response = http_client.request(
        method,
        substitute(BASE_URL + path.replace("{{baseUrl}}", "")),
        headers=send_headers,
        content=content,
    )
    test_script = [*tests]
    for variable_name, javascript_expression, python_extractor in captures or []:
        variables[variable_name] = str(python_extractor(response.json()))
        test_script.append(f'pm.collectionVariables.set("{variable_name}", {javascript_expression});')
    print(f"{response.status_code} {method} {path} — {name}")

    response_headers = [
        {"key": key, "value": value}
        for key, value in response.headers.items()
        if key.lower() in {"content-type", "x-request-id", "retry-after"}
        or key.lower().startswith("x-llm-gateway")
        or key.lower() == "set-cookie"
    ]
    for header in response_headers:
        if header["key"].lower() == "set-cookie":
            header["value"] = re.sub(r"=([^;]+);", "=<signed-session-token>;", header["value"], count=1)
    response_text = response.text
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type and response_text:
        response_text = json.dumps(response.json(), indent=2)
    if example_body_note:
        response_text = example_body_note
    example = {
        "name": f"{response.status_code} {STATUS_TEXT.get(response.status_code, '')}".strip(),
        "originalRequest": {key: value for key, value in postman_request.items() if key != "description"},
        "status": STATUS_TEXT.get(response.status_code, ""),
        "code": response.status_code,
        "_postman_previewlanguage": "json" if "json" in content_type else "text",
        "header": response_headers,
        "body": response_text,
    }
    events = [{"listen": "test", "script": {"type": "text/javascript", "exec": test_script}}]
    if prerequest:
        events.insert(
            0,
            {
                "listen": "prerequest",
                "script": {"type": "text/javascript", "exec": prerequest},
            },
        )
    return {
        "name": name,
        "event": events,
        "request": postman_request,
        "response": [example],
    }


def folder(name: str, description: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    return {"name": name, "description": description, "item": items}


def chat_body(task_name: str, content: str = "What is the refund window?", **extra: Any) -> dict[str, Any]:
    return {
        "model": task_name,
        "messages": [
            {
                "role": "system",
                "content": "Answer using only the provided context and cite sources.",
            },
            {"role": "user", "content": content},
        ],
        **extra,
    }


def stream_body(task_name: str) -> dict[str, Any]:
    return chat_body(
        task_name,
        "Summarise the onboarding guide in 3 bullets.",
        stream=True,
        stream_options={"include_usage": True},
    )


def model_capture(variable_name: str) -> tuple[str, str, Callable[[Any], Any]]:
    return (variable_name, "pm.response.json().id", lambda body: body["id"])


def json_with_number_variables(body: dict[str, Any]) -> str:
    """Pretty JSON where "{{somePk}}" placeholders become bare numbers in the Postman body."""
    return re.sub(r'"(\{\{\w+Pk\}\})"', r"\1", json.dumps(body, indent=2))


def chain_body(steps: list[dict[str, Any]], append_default_model: bool, **route_fields: Any) -> str:
    """A route or chain body; ``"{{somePk}}"`` model references become bare numbers."""
    return json_with_number_variables(
        {**route_fields, "steps": steps, "append_default_model": append_default_model}
    )


def replace_chain_request(
    name: str,
    task_name: str,
    steps: list[dict[str, Any]],
    append_default_model: bool,
    description: str,
) -> dict[str, Any]:
    """Points a built-in task at the chain the next scenario needs (tasks are fixed, so demos reuse them)."""
    return make_request(
        name,
        "PUT",
        f"/admin/api/routes/{task_name}/chain",
        auth="admin",
        raw_body=chain_body(steps, append_default_model),
        description=description,
        tests=[
            *status_test(200),
            f'pm.test("Chain has {len(steps)} step(s)", () => pm.expect(pm.response.json().steps.length).to.eql({len(steps)}));',
        ],
    )


LOCAL_DEPLOYMENT_BODY = {
    "display_name": "Demo document parser",
    "base_url": "{{fakeProviderUrl}}/openai/v1",
    "api_protocol": "openai_chat_completions",
    "capabilities": ["vision"],
    "context_window_tokens": 8192,
    "max_output_tokens": 4096,
    "default_for_tasks": ["document_parse"],
}
VISION_PAGE_BODY = {
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Transcribe this page."},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
                    },
                },
            ],
        }
    ],
}


folders: list[dict[str, Any]] = []

folders.append(
    folder(
        "1. Health & Docs",
        "Unauthenticated probes. Keep /docs internal.",
        [
            make_request(
                "Liveness",
                "GET",
                "/health/live",
                auth="none",
                description="200 while the process is serving HTTP.",
                tests=[
                    *status_test(200),
                    'pm.test("Reports alive", () => pm.expect(pm.response.json().status).to.eql("alive"));',
                ],
            ),
            make_request(
                "Readiness",
                "GET",
                "/health/ready",
                auth="none",
                description="200 when started and Postgres answers within 2 s; 503 `starting` / `database_unavailable` otherwise.",
                tests=[
                    *status_test(200),
                    'pm.test("Reports ready", () => pm.expect(pm.response.json().status).to.eql("ready"));',
                ],
            ),
            make_request(
                "OpenAPI Schema",
                "GET",
                "/openapi.json",
                auth="none",
                description="Only served when LLM_GATEWAY_ENABLE_API_DOCS=true (Swagger UI at /docs).",
                tests=[
                    *status_test(200),
                    'pm.test("Documents chat completions", () => pm.expect(pm.response.json().paths).to.have.property("/v1/chat/completions"));',
                ],
                example_body_note='{\n  "openapi": "3.1.0",\n  "info": {"title": "LLM Gateway", "version": "1.0.0"},\n  "paths": {"/v1/chat/completions": {"...": "..."}}\n}',
            ),
        ],
    )
)

folders.append(
    folder(
        "2. Admin - Session",
        "Single admin from LLM_GATEWAY_ADMIN_USERNAME / LLM_GATEWAY_ADMIN_PASSWORD_HASH. "
        "Login sets an HttpOnly, SameSite=Strict cookie scoped to /admin/api that Postman's cookie jar sends automatically. "
        "Every POST/PUT/PATCH/DELETE needs `X-Requested-With: llm-gateway-dashboard` (CSRF guard).",
        [
            make_request(
                "Get session before login (401)",
                "GET",
                "/admin/api/session",
                auth="admin",
                description="Without the session cookie every admin endpoint returns 401.",
                tests=[
                    *status_test(401),
                    'pm.test("FastAPI detail body", () => pm.expect(pm.response.json().detail).to.eql("Not signed in"));',
                ],
            ),
            make_request(
                "Login without CSRF header (403)",
                "POST",
                "/admin/api/session",
                auth="none",
                body={"username": "{{adminUsername}}", "password": "{{adminPassword}}"},
                description="Mutations without `X-Requested-With: llm-gateway-dashboard` are rejected, which blocks cross-site form posts.",
                tests=status_test(403),
            ),
            make_request(
                "Login with wrong password (401)",
                "POST",
                "/admin/api/session",
                auth="admin",
                body={"username": "{{adminUsername}}", "password": "definitely-wrong"},
                description="Wrong username or password. After 5 failures per minute the endpoint answers 429.",
                tests=[
                    *status_test(401),
                    'pm.test("Generic message", () => pm.expect(pm.response.json().detail).to.eql("Invalid username or password"));',
                ],
            ),
            make_request(
                "Login",
                "POST",
                "/admin/api/session",
                auth="admin",
                body={"username": "{{adminUsername}}", "password": "{{adminPassword}}"},
                description="Checks the scrypt hash and sets the `llm_gateway_admin_session` cookie.",
                tests=[
                    *status_test(200),
                    'pm.test("Returns the admin and expiry", () => { const body = pm.response.json(); pm.expect(body.username).to.eql(pm.collectionVariables.get("adminUsername")); pm.expect(Date.parse(body.expires_at)).to.be.above(Date.now()); });',
                    'pm.test("Sets an HttpOnly SameSite=Strict cookie", () => { const cookie = pm.response.headers.get("Set-Cookie"); pm.expect(cookie).to.include("HttpOnly"); pm.expect(cookie).to.include("SameSite=strict"); });',
                ],
            ),
        ],
    )
)
# Log the python client in for the rest of the run.
http_client.post(
    BASE_URL + "/admin/api/session",
    headers={"X-Requested-With": "llm-gateway-dashboard"},
    json={"username": "admin", "password": ADMIN_PASSWORD},
)

DEMO_ROUTED_TASK_NAMES = (
    "answer_generation",
    "conversation_summary",
    "query_rewrite",
    "chart_description",
    "document_parse",
)

reset_items = [
    make_request(
        "Reset circuit breakers",
        "POST",
        "/admin/api/circuit-breakers/reset",
        auth="admin",
        description="Breaker state lives in memory; a re-run starts with every model trusted again.",
        tests=status_test(200),
    ),
    *[
        make_request(
            f"Delete route {task_name} if present",
            "DELETE",
            f"/admin/api/routes/{task_name}",
            auth="admin",
            description="Makes the collection re-runnable: 204 if it existed, 404 otherwise.",
            tests=status_test(204, 404),
        )
        for task_name in DEMO_ROUTED_TASK_NAMES
    ],
]
reset_items += [
    make_request(
        "Find a leftover demo deployment",
        "GET",
        "/admin/api/providers/local-models",
        auth="admin",
        description="200 with the Local models provider if any deployment was ever registered, 404 otherwise. Captures the demo deployment's model key (0 if absent).",
        tests=[*status_test(200, 404)],
        captures=[
            (
                "leftoverLocalModelPk",
                '(pm.response.code === 200 ? (pm.response.json().models.find(m => m.model_id === "demo-parser") || {id: 0}).id : 0)',
                lambda body: (
                    next(
                        (m["id"] for m in body.get("models", []) if m["model_id"] == "demo-parser"),
                        0,
                    )
                    if "models" in body
                    else 0
                ),
            )
        ],
    ),
    make_request(
        "Delete leftover demo deployment if present",
        "DELETE",
        "/admin/api/models/{{leftoverLocalModelPk}}",
        auth="admin",
        description="Only the collection's own `demo-parser` deployment is removed; other local models are left alone.",
        tests=status_test(204, 404),
    ),
]
reset_items.append(
    make_request(
        "Clear default model",
        "PUT",
        "/admin/api/settings",
        auth="admin",
        body={"default_model_pk": None},
        description="Unset the default so demo providers can be deleted.",
        tests=status_test(200),
    )
)
reset_items += [
    make_request(
        f"Delete provider {provider_id} if present",
        "DELETE",
        f"/admin/api/providers/{provider_id}",
        auth="admin",
        description="204 if it existed (its models are deleted too), 404 otherwise.",
        tests=status_test(204, 404),
    )
    for provider_id in ("demo-chat", "demo-responses", "demo-anthropic")
]
folders.append(
    folder(
        "3. Admin - Reset demo data",
        "Removes anything a previous run of this collection left behind. The demos route built-in tasks, "
        "so this also deletes their existing routes: run the collection against a demo stack only.",
        reset_items,
    )
)


def provider_body(provider_id: str, protocol: str, path_prefix: str, display_name: str) -> dict[str, Any]:
    return {
        "provider_id": provider_id,
        "display_name": display_name,
        "base_url": "{{fakeProviderUrl}}/" + path_prefix + "/v1",
        "api_protocol": protocol,
        "api_key": "sk-demo-" + provider_id,
        "extra_headers": [{"name": "X-Organization", "value": "demo-org"}],
        "request_timeout_seconds": 60,
        "max_concurrent_requests": 32,
    }


PROVIDER_TESTS = [
    'pm.test("Secrets are write-only", () => { const body = pm.response.json(); pm.expect(body.has_api_key).to.eql(true); pm.expect(JSON.stringify(body)).to.not.include("sk-demo-"); pm.expect(body.extra_header_names).to.eql(["X-Organization"]); });',
]
MODEL_TESTS = [
    'pm.test("Returns the numeric model key", () => pm.expect(pm.response.json().id).to.be.a("number"));'
]
PRICES = {
    "input_price_usd_per_million_tokens": 0.27,
    "cached_input_price_usd_per_million_tokens": 0.07,
    "output_price_usd_per_million_tokens": 1.10,
}

folders.append(
    folder(
        "4. Admin - Providers & Models",
        'Mirrors the dashboard\'s "Custom model API" form. These demo providers point at the '
        "fake provider from `docker compose --profile demo up`; for a real provider use e.g. base_url `https://api.deepseek.com/v1` with protocol `openai_chat_completions`.",
        [
            make_request(
                "Create provider (OpenAI Chat Completions)",
                "POST",
                "/admin/api/providers",
                auth="admin",
                body=provider_body(
                    "demo-chat",
                    "openai_chat_completions",
                    "openai",
                    "Demo Chat Completions",
                ),
                description="API key and extra-header values are Fernet-encrypted at rest and never returned.",
                tests=[*status_test(201), *PROVIDER_TESTS],
            ),
            make_request(
                "Create provider (OpenAI Responses)",
                "POST",
                "/admin/api/providers",
                auth="admin",
                body=provider_body("demo-responses", "openai_responses", "openai", "Demo Responses"),
                description="Chat Completions calls routed here are translated to the Responses API.",
                tests=[*status_test(201), *PROVIDER_TESTS],
            ),
            make_request(
                "Create provider (Anthropic Messages)",
                "POST",
                "/admin/api/providers",
                auth="admin",
                body=provider_body(
                    "demo-anthropic",
                    "anthropic_messages",
                    "anthropic",
                    "Demo Anthropic",
                ),
                description="Chat Completions calls routed here are translated to Anthropic Messages (system prompt, tools, images, streaming).",
                tests=[*status_test(201), *PROVIDER_TESTS],
            ),
            make_request(
                "Fetch available models",
                "POST",
                "/admin/api/providers/demo-anthropic/discover-models",
                auth="admin",
                description="Calls the provider's models endpoint. Nothing is saved; add the ones you want.",
                tests=[
                    *status_test(200),
                    'pm.test("Lists model IDs", () => pm.expect(pm.response.json().map(m => m.model_id)).to.include("fake-small"));',
                ],
            ),
            make_request(
                "Add model demo-chat/fake-small",
                "POST",
                "/admin/api/providers/demo-chat/models",
                auth="admin",
                body={
                    "model_id": "fake-small",
                    "display_name": "Fake small (chat)",
                    "context_window_tokens": 128000,
                    "max_output_tokens": 8192,
                    **PRICES,
                },
                description="Prices are USD per 1M tokens; cost is computed per request and stored with the metric row. `context_window_tokens` and `max_output_tokens` are published to callers by `GET /v1/tasks/{task}`.",
                tests=[*status_test(201), *MODEL_TESTS],
                captures=[model_capture("chatModelPk")],
            ),
            make_request(
                "Add model demo-chat/fail-400",
                "POST",
                "/admin/api/providers/demo-chat/models",
                auth="admin",
                body={"model_id": "fail-400"},
                description="Fake model that always rejects the request (400).",
                tests=[*status_test(201), *MODEL_TESTS],
                captures=[model_capture("rejectingModelPk")],
            ),
            make_request(
                "Add model demo-responses/fake-small",
                "POST",
                "/admin/api/providers/demo-responses/models",
                auth="admin",
                body={"model_id": "fake-small", **PRICES},
                description="",
                tests=[*status_test(201), *MODEL_TESTS],
                captures=[model_capture("responsesModelPk")],
            ),
            make_request(
                "Add model demo-anthropic/fake-small",
                "POST",
                "/admin/api/providers/demo-anthropic/models",
                auth="admin",
                body={
                    "model_id": "fake-small",
                    "default_max_output_tokens": 1024,
                    "context_window_tokens": 200000,
                    "max_output_tokens": 8192,
                    **PRICES,
                },
                description="`default_max_output_tokens` is used when the caller omits max_tokens (Anthropic requires it); it may not exceed `max_output_tokens`.",
                tests=[*status_test(201), *MODEL_TESTS],
                captures=[model_capture("anthropicModelPk")],
            ),
            make_request(
                "Add model demo-anthropic/fail-500",
                "POST",
                "/admin/api/providers/demo-anthropic/models",
                auth="admin",
                body={"model_id": "fail-500"},
                description="Fake model that always fails with 500 (demonstrates retries + fallback).",
                tests=[*status_test(201), *MODEL_TESTS],
                captures=[model_capture("brokenModelPk")],
            ),
            make_request(
                "Add model demo-anthropic/fail-401",
                "POST",
                "/admin/api/providers/demo-anthropic/models",
                auth="admin",
                body={"model_id": "fail-401"},
                description="Fake model whose provider rejects the credentials (401).",
                tests=[*status_test(201), *MODEL_TESTS],
                captures=[model_capture("misconfiguredModelPk")],
            ),
            make_request(
                "Add breaker demo model demo-chat/fail-503",
                "POST",
                "/admin/api/providers/demo-chat/models",
                auth="admin",
                body={
                    "model_id": "fail-503",
                    "breaker_failure_threshold": 1,
                    "breaker_cooldown_seconds": 300,
                },
                description="Always fails with 503. Its circuit breaker opens after 1 failed request and skips the model for 5 minutes "
                "(null = the gateway defaults LLM_GATEWAY_CIRCUIT_BREAKER_FAILURE_THRESHOLD / _COOLDOWN_SECONDS).",
                tests=[
                    *status_test(201),
                    *MODEL_TESTS,
                    'pm.test("Breaker settings stored", () => { const model = pm.response.json(); pm.expect(model.breaker_failure_threshold).to.eql(1); pm.expect(model.breaker_cooldown_seconds).to.eql(300); });',
                ],
                captures=[model_capture("breakerModelPk")],
            ),
            make_request(
                "Add model demo-anthropic/tool-caller",
                "POST",
                "/admin/api/providers/demo-anthropic/models",
                auth="admin",
                body={"model_id": "tool-caller"},
                description="Fake model that answers with a tool call.",
                tests=[*status_test(201), *MODEL_TESTS],
                captures=[model_capture("toolModelPk")],
            ),
            make_request(
                "Add vision model demo-chat/fake-vision",
                "POST",
                "/admin/api/providers/demo-chat/models",
                auth="admin",
                body={
                    "model_id": "fake-vision",
                    "capabilities": ["vision"],
                    "context_window_tokens": 32000,
                    "max_output_tokens": 4096,
                    **PRICES,
                },
                description='`capabilities: ["vision"]` lets tasks that require vision route to this model.',
                tests=[
                    *status_test(201),
                    *MODEL_TESTS,
                    'pm.test("Has vision", () => pm.expect(pm.response.json().capabilities).to.eql(["vision"]));',
                ],
                captures=[model_capture("visionModelPk")],
            ),
            make_request(
                "Update model limits",
                "PATCH",
                "/admin/api/models/{{responsesModelPk}}",
                auth="admin",
                body={"context_window_tokens": 64000, "max_output_tokens": 4096},
                description="Explicit `null` clears a limit (then callers see `null`, meaning undeclared).",
                tests=[
                    *status_test(200),
                    'pm.test("Limits updated", () => { const body = pm.response.json(); pm.expect(body.context_window_tokens).to.eql(64000); pm.expect(body.max_output_tokens).to.eql(4096); pm.expect(body.is_available).to.eql(true); });',
                ],
            ),
            make_request(
                "Use the chat-template thinking switch",
                "PATCH",
                "/admin/api/models/{{visionModelPk}}",
                auth="admin",
                body={"reasoning_control": "enable_thinking"},
                description="For Qwen-style models on vLLM or llama.cpp: the gateway replaces `reasoning_effort` with "
                "`chat_template_kwargs.enable_thinking` (absent, null or `none` = off; any other effort = on; a caller's own "
                "`enable_thinking` wins). The default, `reasoning_effort`, passes the field on unchanged.",
                tests=[
                    *status_test(200),
                    'pm.test("Thinking switch set", () => pm.expect(pm.response.json().reasoning_control).to.eql("enable_thinking"));',
                ],
            ),
            make_request(
                "Test model",
                "POST",
                "/admin/api/models/{{anthropicModelPk}}/test",
                auth="admin",
                description="Sends a tiny real request to the model (works for disabled models; not recorded in metrics).",
                tests=[
                    *status_test(200),
                    'pm.test("Model answered", () => { const body = pm.response.json(); pm.expect(body.success).to.eql(true); pm.expect(body.latency_ms).to.be.a("number"); });',
                ],
            ),
            make_request(
                "Test failing model",
                "POST",
                "/admin/api/models/{{misconfiguredModelPk}}/test",
                auth="admin",
                description="A failing test still returns 200 with `success: false` and the provider's status and message.",
                tests=[
                    *status_test(200),
                    'pm.test("Reports the failure", () => { const body = pm.response.json(); pm.expect(body.success).to.eql(false); pm.expect(body.http_status).to.eql(401); });',
                ],
            ),
            make_request(
                "List providers",
                "GET",
                "/admin/api/providers",
                auth="admin",
                description="All providers with their models; no secret values.",
                tests=[
                    *status_test(200),
                    'pm.test("Includes demo providers", () => pm.expect(pm.response.json().map(p => p.provider_id)).to.include.members(["demo-chat", "demo-responses", "demo-anthropic"]));',
                ],
            ),
            make_request(
                "Update provider (rotate key, keep header value)",
                "PATCH",
                "/admin/api/providers/demo-chat",
                auth="admin",
                body={
                    "api_key": "sk-demo-rotated",
                    "extra_headers": [{"name": "X-Organization", "value": None}],
                    "request_timeout_seconds": 90,
                },
                description="Omit `api_key` to keep it, send a value to replace it, or `clear_api_key: true` to remove it. In `extra_headers`, `value: null` keeps the stored value.",
                tests=[
                    *status_test(200),
                    'pm.test("Timeout updated, header kept", () => { const body = pm.response.json(); pm.expect(body.request_timeout_seconds).to.eql(90); pm.expect(body.extra_header_names).to.eql(["X-Organization"]); });',
                ],
            ),
            make_request(
                "Update model price",
                "PATCH",
                "/admin/api/models/{{chatModelPk}}",
                auth="admin",
                body={"output_price_usd_per_million_tokens": 1.2},
                description="Partial update. Explicit `null` clears optional fields. New prices apply to new requests only.",
                tests=[
                    *status_test(200),
                    'pm.test("Price updated", () => pm.expect(pm.response.json().output_price_usd_per_million_tokens).to.eql(1.2));',
                ],
            ),
        ],
    )
)

folders.append(
    folder(
        "5. Admin - Task list",
        "The task names callers send as `model` are a fixed list seeded by migrations: `document_parse`, `table_extraction`, "
        "`equation_ocr` and `chart_description` require vision-capable models; `query_rewrite`, `answer_generation` and "
        "`conversation_summary` do not. Admins route these tasks but cannot add, change or delete them. "
        "Any other name sent as `model` is served by the default model.",
        [
            make_request(
                "List tasks",
                "GET",
                "/admin/api/tasks",
                auth="admin",
                description="Every built-in task with its vision need and whether it has a route.",
                tests=[
                    *status_test(200),
                    'pm.test("Exactly the built-in tasks", () => { const tasks = pm.response.json(); pm.expect(tasks.map(t => t.task_name).sort()).to.eql(["answer_generation", "chart_description", "conversation_summary", "document_parse", "equation_ocr", "query_rewrite", "table_extraction"]); pm.expect(tasks.filter(t => t.requires_vision).map(t => t.task_name).sort()).to.eql(["chart_description", "document_parse", "equation_ocr", "table_extraction"]); pm.expect(tasks[0]).to.include.keys("description", "has_route", "created_at", "updated_at"); });',
                ],
            ),
            make_request(
                "Route an unknown task (422)",
                "POST",
                "/admin/api/routes",
                auth="admin",
                raw_body=chain_body([{"model_pk": "{{chatModelPk}}"}], True, task_name="sms"),
                description="Only built-in tasks can be routed; nothing is saved. Callers may still send `sms` as `model`: the default model serves it.",
                tests=[
                    *status_test(422),
                    'pm.test("Not a built-in task", () => pm.expect(pm.response.json().detail).to.include("is not a built-in task"));',
                ],
            ),
        ],
    )
)

folders.append(
    folder(
        "6. Admin - Routing",
        "Callers send a task name in `model`. Each task route has an ordered **model chain** of 1-10 steps (model, "
        "`max_attempts`, optional `timeout_seconds`, `is_enabled`), tried top to bottom; `append_default_model` adds the "
        "gateway default as the last step. Only built-in tasks can be routed; the default model also serves any other task name. "
        "The demos reuse the built-in tasks, replacing a route's chain (PUT .../chain) right before each scenario.",
        [
            make_request(
                "Set default model",
                "PUT",
                "/admin/api/settings",
                auth="admin",
                body={"default_model_pk": "{{chatModelPk}}"},
                raw_body=json.dumps({"default_model_pk": "{{chatModelPk}}"}, indent=2).replace(
                    '"{{chatModelPk}}"', "{{chatModelPk}}"
                ),
                description="Serves unknown tasks and is the last fallback for every route.",
                tests=[
                    *status_test(200),
                    'pm.test("Default is demo-chat/fake-small", () => pm.expect(pm.response.json().default_model_name).to.eql("demo-chat/fake-small"));',
                ],
            ),
            make_request(
                "Route a vision task to a text model (422)",
                "POST",
                "/admin/api/routes",
                auth="admin",
                raw_body=chain_body([{"model_pk": "{{chatModelPk}}"}], False, task_name="chart_description"),
                description="`chart_description` requires vision and demo-chat/fake-small has none. Vision routes use vision models, as below, or come from local-model registration.",
                tests=[
                    *status_test(422),
                    'pm.test("Explains the vision rule", () => pm.expect(pm.response.json().detail).to.include("requires vision"));',
                ],
            ),
            *[
                make_request(
                    f"Create route {task_name}",
                    "POST",
                    "/admin/api/routes",
                    auth="admin",
                    raw_body=chain_body(
                        steps,
                        append_default_model,
                        task_name=task_name,
                        description=description,
                    ),
                    description=route_description,
                    tests=[
                        *status_test(201),
                        (
                            f'pm.test("Route created with {len(steps)} step(s)", () => {{ const route = pm.response.json(); '
                            f'pm.expect(route.task_name).to.eql("{task_name}"); pm.expect(route.steps.length).to.eql({len(steps)}); '
                            f"pm.expect(route.append_default_model).to.eql({str(append_default_model).lower()}); }});"
                        ),
                    ],
                )
                for task_name, description, steps, append_default_model, route_description in [
                    (
                        "answer_generation",
                        "RAG answers",
                        [
                            {"model_pk": "{{anthropicModelPk}}"},
                            {"model_pk": "{{responsesModelPk}}"},
                        ],
                        False,
                        "Step 1: Anthropic-protocol model; step 2: Responses-protocol model. Steps default to 1 attempt.",
                    ),
                    (
                        "conversation_summary",
                        "Summaries",
                        [{"model_pk": "{{responsesModelPk}}"}],
                        True,
                        "One step, then the gateway default model (`append_default_model`).",
                    ),
                    (
                        "query_rewrite",
                        "Query rewrites",
                        [
                            {"model_pk": "{{brokenModelPk}}", "max_attempts": 2},
                            {"model_pk": "{{responsesModelPk}}"},
                        ],
                        False,
                        "Step 1 always returns 500: 2 attempts (`max_attempts`), then step 2. "
                        "Later scenarios replace this chain (tool calling, rejected input, every step failing, circuit breaker).",
                    ),
                    (
                        "chart_description",
                        "Chart images to text",
                        [{"model_pk": "{{visionModelPk}}"}],
                        False,
                        "A vision task routed to demo-chat/fake-vision, which declares the `vision` capability.",
                    ),
                ]
            ],
            make_request(
                "List routes",
                "GET",
                "/admin/api/routes",
                auth="admin",
                description="Routes with their ordered chains, model names and each step's circuit-breaker status.",
                tests=[
                    *status_test(200),
                    'pm.test("answer_generation chain in order", () => { const route = pm.response.json().find(r => r.task_name === "answer_generation"); pm.expect(route.steps.map(s => s.model_name)).to.eql(["demo-anthropic/fake-small", "demo-responses/fake-small"]); pm.expect(route.steps[0].breaker_status).to.eql("closed"); });',
                ],
            ),
            make_request(
                "Update route settings",
                "PATCH",
                "/admin/api/routes/conversation_summary",
                auth="admin",
                body={"description": "Short summaries"},
                description="Partial update of description, `is_enabled` and `append_default_model`; the chain itself is replaced with PUT .../chain.",
                tests=[
                    *status_test(200),
                    'pm.test("Description updated", () => pm.expect(pm.response.json().description).to.eql("Short summaries"));',
                ],
            ),
            make_request(
                "Read a task's chain",
                "GET",
                "/admin/api/routes/query_rewrite/chain",
                auth="admin",
                description="The ordered steps with `max_attempts`, `timeout_seconds`, `is_enabled` and `breaker_status`.",
                tests=[
                    *status_test(200),
                    'pm.test("Step 1 retries twice", () => { const steps = pm.response.json().steps; pm.expect(steps.map(s => s.position)).to.eql([1, 2]); pm.expect(steps[0].max_attempts).to.eql(2); });',
                ],
            ),
            make_request(
                "Replace a chain (reorder, timeout, disabled step)",
                "PUT",
                "/admin/api/routes/conversation_summary/chain",
                auth="admin",
                raw_body=chain_body(
                    [
                        {"model_pk": "{{chatModelPk}}", "is_enabled": False},
                        {
                            "model_pk": "{{responsesModelPk}}",
                            "max_attempts": 2,
                            "timeout_seconds": 60,
                        },
                    ],
                    True,
                ),
                description="Atomic replace of the whole ordered chain (creates the route if missing). Steps run in list order; a disabled step stays but is never tried.",
                tests=[
                    *status_test(200),
                    'pm.test("New order and settings", () => { const steps = pm.response.json().steps; pm.expect(steps.map(s => s.model_name)).to.eql(["demo-chat/fake-small", "demo-responses/fake-small"]); pm.expect(steps[0].is_enabled).to.eql(false); pm.expect(steps[1].timeout_seconds).to.eql(60); });',
                ],
            ),
            make_request(
                "Chain with a duplicate model (422)",
                "PUT",
                "/admin/api/routes/conversation_summary/chain",
                auth="admin",
                raw_body=chain_body(
                    [{"model_pk": "{{chatModelPk}}"}, {"model_pk": "{{chatModelPk}}"}],
                    False,
                ),
                description="1-10 steps, each model at most once; a rejected replace leaves the chain unchanged.",
                tests=status_test(422),
            ),
        ],
    )
)

folders.append(
    folder(
        "7. Local models - machine registration",
        "What `services/local-llm` calls. Authenticated with LLM_GATEWAY_REGISTRATION_API_KEY "
        "(collection variable `registrationKey`), never the caller key. Deployments land under the `local-models` provider; each keeps its own endpoint.",
        [
            make_request(
                "Register deployment (first time, 201)",
                "PUT",
                "/v1/local-models/demo-parser",
                auth="registration",
                body=LOCAL_DEPLOYMENT_BODY,
                description="Idempotent upsert keyed by deployment name (also the model ID sent upstream). `default_for_tasks` routes `document_parse` here because it has no route yet; existing routes are never overwritten. "
                "local-llm also sends `api_key` (its own key): the gateway stores it encrypted on the `local-models` provider, shares it across deployments, and keeps it when omitted. "
                "The demo omits it so it never replaces a real local-llm key; responses only show `has_api_key`.",
                tests=[
                    *status_test(201),
                    'pm.test("Created and claimed the free route", () => { const body = pm.response.json(); pm.expect(body.was_created).to.eql(true); pm.expect(body.qualified_name).to.eql("local-models/demo-parser"); pm.expect(body.claimed_default_routes).to.eql(["document_parse"]); pm.expect(body.is_available).to.eql(true); pm.expect(body.has_api_key).to.be.a("boolean"); pm.expect(body).to.not.have.property("api_key"); });',
                ],
                captures=[
                    (
                        "localModelPk",
                        "pm.response.json().model_pk",
                        lambda body: body["model_pk"],
                    )
                ],
            ),
            make_request(
                "Register again (idempotent, 200)",
                "PUT",
                "/v1/local-models/demo-parser",
                auth="registration",
                body=LOCAL_DEPLOYMENT_BODY,
                description="Repeating the call changes nothing and claims nothing new.",
                tests=[
                    *status_test(200),
                    'pm.test("Same deployment, nothing claimed", () => { const body = pm.response.json(); pm.expect(body.was_created).to.eql(false); pm.expect(body.model_pk).to.eql(Number(pm.collectionVariables.get("localModelPk"))); pm.expect(body.claimed_default_routes).to.eql([]); });',
                ],
            ),
            make_request(
                "List registered deployments",
                "GET",
                "/v1/local-models",
                auth="registration",
                description="For reconciliation after local-llm restarts.",
                tests=[
                    *status_test(200),
                    'pm.test("Lists demo-parser", () => pm.expect(pm.response.json().map(d => d.deployment_name)).to.include("demo-parser"));',
                ],
            ),
            make_request(
                "Mark deployment unavailable",
                "POST",
                "/v1/local-models/demo-parser/unavailable",
                auth="registration",
                description="Unloaded or failed: routing skips it (its tasks fall back) until it registers again.",
                tests=[
                    *status_test(200),
                    'pm.test("Unavailable", () => pm.expect(pm.response.json().is_available).to.eql(false));',
                ],
            ),
            make_request(
                "Task resolution while unavailable (503)",
                "GET",
                "/v1/tasks/document_parse",
                description="No other vision model serves `document_parse` and the default model has no vision, so nothing can serve it.",
                tests=[*status_test(503), *openai_error_test("no_model_configured")],
            ),
            make_request(
                "Register again to restore",
                "PUT",
                "/v1/local-models/demo-parser",
                auth="registration",
                body=LOCAL_DEPLOYMENT_BODY,
                description="Ready again: available, routed as before.",
                tests=[
                    *status_test(200),
                    'pm.test("Available again", () => pm.expect(pm.response.json().is_available).to.eql(true));',
                ],
            ),
            make_request(
                "Caller key is rejected (401)",
                "PUT",
                "/v1/local-models/demo-parser",
                auth="none",
                extra_headers=[{"key": "Authorization", "value": "Bearer {{apiKey}}"}],
                body=LOCAL_DEPLOYMENT_BODY,
                description="The caller key cannot register models (and the registration key cannot call chat completions).",
                tests=[*status_test(401), *openai_error_test("invalid_api_key")],
            ),
            make_request(
                "Unknown default task (422)",
                "PUT",
                "/v1/local-models/demo-parser",
                auth="registration",
                body={**LOCAL_DEPLOYMENT_BODY, "default_for_tasks": ["not-a-task"]},
                description="`default_for_tasks` must name built-in tasks; nothing is saved.",
                tests=status_test(422),
            ),
            make_request(
                "Mark unknown deployment unavailable (404)",
                "POST",
                "/v1/local-models/ghost/unavailable",
                auth="registration",
                description="",
                tests=status_test(404),
            ),
        ],
    )
)

folders.append(
    folder(
        "8. Inference - Chat Completions",
        "What the RAG backend calls. Any OpenAI SDK works with base_url `{{baseUrl}}/v1` and the gateway API key. "
        "`model` is the task name. Response headers `X-LLM-Gateway-Provider/-Model/-Fallback/-Attempts` say what served it.",
        [
            make_request(
                "List task names (/v1/models)",
                "GET",
                "/v1/models",
                description="Enabled task routes plus `default`.",
                tests=[
                    *status_test(200),
                    'pm.test("Lists answer_generation and default", () => pm.expect(pm.response.json().data.map(m => m.id)).to.include.members(["answer_generation", "default"]));',
                ],
            ),
            make_request(
                "Task resolution and limits (/v1/tasks/answer_generation)",
                "GET",
                "/v1/tasks/answer_generation",
                description="The models that would serve the task, in order, and the tightest `context_window_tokens` / `max_output_tokens` across them. `rag` budgets prompts with `limits`.",
                tests=[
                    *status_test(200),
                    'pm.test("Primary, fallback and tightest limits", () => { const body = pm.response.json(); pm.expect(body.models.map(m => m.role)).to.eql(["primary", "fallback"]); pm.expect(body.limits.context_window_tokens).to.eql(64000); pm.expect(body.limits.max_output_tokens).to.eql(4096); });',
                ],
            ),
            make_request(
                "List tasks with resolution (/v1/tasks)",
                "GET",
                "/v1/tasks",
                description="Every built-in task with its current models and limits.",
                tests=[
                    *status_test(200),
                    'pm.test("Includes conversation_summary", () => pm.expect(pm.response.json().map(t => t.task_name)).to.include("conversation_summary"));',
                ],
            ),
            make_request(
                "Vision task served by the local deployment",
                "POST",
                "/v1/chat/completions",
                body={"model": "document_parse", **VISION_PAGE_BODY},
                description="Routed to `local-models/demo-parser` at the endpoint it registered.",
                tests=[*status_test(200), *served_by_test("local-models", False)],
            ),
            make_request(
                "Vision task served by a vision model",
                "POST",
                "/v1/chat/completions",
                body={"model": "chart_description", **VISION_PAGE_BODY},
                description="`chart_description` is routed to demo-chat/fake-vision; the image part is passed through unchanged.",
                tests=[*status_test(200), *CHAT_COMPLETION_TESTS, *served_by_test("demo-chat", False)],
            ),
            make_request(
                "Answer - non-streaming (Anthropic upstream)",
                "POST",
                "/v1/chat/completions",
                body=chat_body("answer_generation"),
                description="Translated to Anthropic Messages and back.",
                tests=[
                    *status_test(200),
                    *CHAT_COMPLETION_TESTS,
                    *served_by_test("demo-anthropic", False),
                ],
            ),
            make_request(
                "Answer - streaming (Anthropic upstream)",
                "POST",
                "/v1/chat/completions",
                body=stream_body("answer_generation"),
                description="SSE `chat.completion.chunk` events translated from Anthropic stream events, ending with `data: [DONE]`. Disconnecting cancels the upstream call.",
                tests=[
                    *status_test(200),
                    *STREAM_TESTS,
                    *served_by_test("demo-anthropic", False),
                ],
            ),
            make_request(
                "Summary - non-streaming (Responses upstream)",
                "POST",
                "/v1/chat/completions",
                body=chat_body("conversation_summary", "Summarise the policy."),
                description="Translated to the OpenAI Responses API (`store: false`).",
                tests=[
                    *status_test(200),
                    *CHAT_COMPLETION_TESTS,
                    *served_by_test("demo-responses", False),
                ],
            ),
            make_request(
                "Summary - streaming (Responses upstream)",
                "POST",
                "/v1/chat/completions",
                body=stream_body("conversation_summary"),
                description="Responses stream events translated to chat chunks.",
                tests=[
                    *status_test(200),
                    *STREAM_TESTS,
                    *served_by_test("demo-responses", False),
                ],
            ),
            make_request(
                "Unrouted task - non-streaming (default model, pass-through)",
                "POST",
                "/v1/chat/completions",
                body=chat_body("sms", "Draft a 160-character reminder."),
                description="`sms` is not a built-in task, so the default model serves it. Chat Completions providers are pass-through. The task still appears in the dashboard.",
                tests=[
                    *status_test(200),
                    *CHAT_COMPLETION_TESTS,
                    *served_by_test("demo-chat", False),
                ],
            ),
            make_request(
                "Unrouted task - streaming (default model, pass-through)",
                "POST",
                "/v1/chat/completions",
                body=stream_body("sms"),
                description="The gateway adds `stream_options.include_usage` upstream so token metrics are always recorded.",
                tests=[
                    *status_test(200),
                    *STREAM_TESTS,
                    *served_by_test("demo-chat", False),
                ],
            ),
            make_request(
                "Step 1 fails - chain moves to step 2",
                "POST",
                "/v1/chat/completions",
                body=chat_body("query_rewrite"),
                description="Step 1 returns 500 twice (its `max_attempts`, with backoff), then step 2 serves the request. "
                "`X-LLM-Gateway-Chain-Step` says which step answered; both steps are recorded in metrics.",
                tests=[
                    *status_test(200),
                    *CHAT_COMPLETION_TESTS,
                    *served_by_test("demo-responses", True),
                    'pm.test("Served by chain step 2", () => pm.expect(pm.response.headers.get("X-LLM-Gateway-Chain-Step")).to.eql("2"));',
                ],
            ),
            replace_chain_request(
                "Point query_rewrite at the tool-calling model",
                "query_rewrite",
                [{"model_pk": "{{toolModelPk}}"}],
                True,
                "demo-anthropic/tool-caller always answers with a tool call.",
            ),
            make_request(
                "Tool calling (Anthropic tool_use -> tool_calls)",
                "POST",
                "/v1/chat/completions",
                body={
                    "model": "query_rewrite",
                    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "description": "Current weather for a city",
                                "parameters": {
                                    "type": "object",
                                    "properties": {"city": {"type": "string"}},
                                    "required": ["city"],
                                },
                            },
                        }
                    ],
                    "tool_choice": "auto",
                },
                description="OpenAI tools are translated to Anthropic tools, and the tool_use answer back to `tool_calls`.",
                tests=[
                    *status_test(200),
                    'pm.test("Returns a tool call", () => { const choice = pm.response.json().choices[0]; pm.expect(choice.finish_reason).to.eql("tool_calls"); pm.expect(choice.message.tool_calls[0].function.name).to.eql("get_weather"); });',
                ],
            ),
            make_request(
                "Tool result follow-up",
                "POST",
                "/v1/chat/completions",
                body={
                    "model": "answer_generation",
                    "messages": [
                        {"role": "user", "content": "What is the weather in Paris?"},
                        {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "toolu_1",
                                    "type": "function",
                                    "function": {
                                        "name": "get_weather",
                                        "arguments": '{"city": "Paris"}',
                                    },
                                }
                            ],
                        },
                        {
                            "role": "tool",
                            "tool_call_id": "toolu_1",
                            "content": "18C and sunny",
                        },
                    ],
                },
                description="`tool` messages become Anthropic `tool_result` blocks.",
                tests=[*status_test(200), *CHAT_COMPLETION_TESTS],
            ),
            make_request(
                "X-API-Key header and caller request ID",
                "POST",
                "/v1/chat/completions",
                auth="none",
                extra_headers=[
                    {"key": "X-API-Key", "value": "{{apiKey}}"},
                    {"key": "X-Request-ID", "value": "rag-trace-0001"},
                ],
                body=chat_body("conversation_summary"),
                description="`X-API-Key` works as an alternative to Bearer auth. A well-formed `X-Request-ID` is reused in logs, metrics and the response.",
                tests=[
                    *status_test(200),
                    'pm.test("Request ID is echoed", () => pm.expect(pm.response.headers.get("X-Request-ID")).to.eql("rag-trace-0001"));',
                ],
            ),
        ],
    )
)

folders.append(
    folder(
        "9. Errors - Inference",
        'Errors use the OpenAI envelope `{"error": {message, type, param, code}}` so SDKs raise typed exceptions. '
        "The upstream failure cases first point `query_rewrite` at failing fake models.",
        [
            make_request(
                "Missing API key (401)",
                "POST",
                "/v1/chat/completions",
                auth="none",
                body=chat_body("answer_generation"),
                description="No Authorization or X-API-Key header.",
                tests=[*status_test(401), *openai_error_test("invalid_api_key")],
            ),
            make_request(
                "Wrong API key (401)",
                "POST",
                "/v1/chat/completions",
                auth="none",
                extra_headers=[{"key": "Authorization", "value": "Bearer wrong-key"}],
                body=chat_body("answer_generation"),
                description="Constant-time comparison; same response as a missing key.",
                tests=[*status_test(401), *openai_error_test("invalid_api_key")],
            ),
            make_request(
                "Empty messages (400)",
                "POST",
                "/v1/chat/completions",
                body={"model": "answer_generation", "messages": []},
                description="At least one message is required.",
                tests=[*status_test(400), *openai_error_test("invalid_request")],
            ),
            make_request(
                "Missing messages (400)",
                "POST",
                "/v1/chat/completions",
                body={"model": "answer_generation"},
                description="",
                tests=[*status_test(400), *openai_error_test("invalid_request")],
            ),
            make_request(
                "Invalid message role (400)",
                "POST",
                "/v1/chat/completions",
                body={
                    "model": "answer_generation",
                    "messages": [{"role": "robot", "content": "hi"}],
                },
                description="Roles: system, developer, user, assistant, tool.",
                tests=[*status_test(400), *openai_error_test("invalid_request")],
            ),
            make_request(
                "Malformed JSON (400)",
                "POST",
                "/v1/chat/completions",
                raw_body='{"model": "answer_generation", "messages": [',
                description="",
                tests=[*status_test(400), *openai_error_test("invalid_request")],
            ),
            replace_chain_request(
                "Point query_rewrite at a model that rejects input",
                "query_rewrite",
                [{"model_pk": "{{rejectingModelPk}}"}],
                True,
                "demo-chat/fail-400 answers every request with 400.",
            ),
            make_request(
                "Provider rejects the request (400, no fallback)",
                "POST",
                "/v1/chat/completions",
                body=chat_body("query_rewrite"),
                description="A 400/413/422 from the provider is passed through without retry or fallback, since another model would reject it too.",
                tests=[
                    *status_test(400),
                    *openai_error_test("upstream_rejected_request"),
                ],
            ),
            replace_chain_request(
                "Point query_rewrite at two failing models",
                "query_rewrite",
                [{"model_pk": "{{brokenModelPk}}"}, {"model_pk": "{{misconfiguredModelPk}}"}],
                False,
                "Step 1 always returns 500, step 2 always returns 401, and no default model is appended.",
            ),
            make_request(
                "Every chain step fails (502, error.steps)",
                "POST",
                "/v1/chat/completions",
                body=chat_body("query_rewrite"),
                description="Step 1 500, then step 2 401 (not retried). One error comes back: the last step's status and code, "
                "plus `error.steps` listing every step reached (model, outcome, HTTP status, error class, attempts; never secrets).",
                tests=[
                    *status_test(502),
                    *openai_error_test("upstream_configuration_error"),
                    'pm.test("Failed on the fallback", () => pm.expect(pm.response.headers.get("X-LLM-Gateway-Fallback")).to.eql("true"));',
                    'pm.test("Lists both steps", () => { const steps = pm.response.json().error.steps; pm.expect(steps.map(s => [s.step, s.model, s.outcome, s.error_class])).to.eql([[1, "demo-anthropic/fail-500", "failed", "upstream_server_error"], [2, "demo-anthropic/fail-401", "failed", "upstream_configuration_error"]]); });',
                ],
            ),
            make_request(
                "Request body over 16 MiB (413)",
                "POST",
                "/v1/chat/completions",
                raw_body="{{oversizedBody}}",
                prerequest=[
                    'pm.collectionVariables.set("oversizedBody", JSON.stringify({model: "answer_generation", messages: [{role: "user", content: "x".repeat(17 * 1024 * 1024)}]}));'
                ],
                python_body_override=json.dumps(
                    {
                        "model": "answer_generation",
                        "messages": [{"role": "user", "content": "x" * (17 * 1024 * 1024)}],
                    }
                ).encode(),
                description="Rejected before the body is read (LLM_GATEWAY_MAX_REQUEST_BODY_BYTES).",
                tests=[
                    *status_test(413),
                    *openai_error_test("request_too_large"),
                    'pm.collectionVariables.unset("oversizedBody");',
                ],
            ),
            make_request(
                "Wrong HTTP method (405)",
                "GET",
                "/v1/chat/completions",
                description="",
                tests=status_test(405),
            ),
        ],
    )
)

folders.append(
    folder(
        "10. Model chains - circuit breaker",
        "A model that fails `breaker_failure_threshold` requests in a row is skipped by every chain for its cooldown, "
        "then gets one trial request. Content rejections (400/413/422) do not count. State is per gateway replica.",
        [
            replace_chain_request(
                "Point query_rewrite at the breaker demo chain",
                "query_rewrite",
                [{"model_pk": "{{breakerModelPk}}"}, {"model_pk": "{{chatModelPk}}"}],
                False,
                "Step 1's model opens its breaker after 1 failure (`breaker_failure_threshold`), so later requests skip it.",
            ),
            make_request(
                "First failure opens the breaker (served by step 2)",
                "POST",
                "/v1/chat/completions",
                body=chat_body("query_rewrite"),
                description="Step 1 (demo-chat/fail-503) fails once, which reaches its threshold of 1; step 2 serves the request.",
                tests=[
                    *status_test(200),
                    'pm.test("Served by step 2", () => pm.expect(pm.response.headers.get("X-LLM-Gateway-Chain-Step")).to.eql("2"));',
                ],
            ),
            make_request(
                "Open breaker: step 1 is skipped",
                "POST",
                "/v1/chat/completions",
                body=chat_body("query_rewrite"),
                description="No call to the failing model: the chain skips it (`fallback_reason: circuit_open` in metrics).",
                tests=[
                    *status_test(200),
                    'pm.test("Skipped to step 2 without retrying step 1", () => { pm.expect(pm.response.headers.get("X-LLM-Gateway-Chain-Step")).to.eql("2"); pm.expect(pm.response.headers.get("X-LLM-Gateway-Attempts")).to.eql("1"); });',
                ],
            ),
            make_request(
                "List circuit breakers",
                "GET",
                "/admin/api/circuit-breakers",
                auth="admin",
                description="Models with recent consecutive failures: status (open = skipped, half_open = next call is a trial), "
                "failures vs threshold, cooldown left, last error class.",
                tests=[
                    *status_test(200),
                    'pm.test("demo-chat/fail-503 is open", () => { const breaker = pm.response.json().find(b => b.model_pk === Number(pm.collectionVariables.get("breakerModelPk"))); pm.expect(breaker.status).to.eql("open"); pm.expect(breaker.consecutive_failures).to.eql(1); pm.expect(breaker.last_error_class).to.eql("upstream_server_error"); });',
                ],
            ),
            make_request(
                "Chain shows the open breaker",
                "GET",
                "/admin/api/routes/query_rewrite/chain",
                auth="admin",
                description="Each step carries its model's `breaker_status`.",
                tests=[
                    *status_test(200),
                    'pm.test("Step 1 open", () => pm.expect(pm.response.json().steps[0].breaker_status).to.eql("open"));',
                ],
            ),
            make_request(
                "Reset one breaker",
                "POST",
                "/admin/api/circuit-breakers/{{breakerModelPk}}/reset",
                auth="admin",
                description="Chains try the model again on the next request.",
                tests=status_test(204),
            ),
            make_request(
                "Reset all breakers",
                "POST",
                "/admin/api/circuit-breakers/reset",
                auth="admin",
                description="Closes every breaker and returns how many had recorded failures.",
                tests=[
                    *status_test(200),
                    'pm.test("Returns a count", () => pm.expect(pm.response.json().reset_count).to.be.a("number"));',
                ],
            ),
        ],
    )
)

time.sleep(2)  # Metrics are flushed asynchronously.
folders.append(
    folder(
        "11. Admin - Analytics",
        "Dashboard queries over the request_metrics table (exact p50/p90/p99 via percentile_cont). "
        "Metrics are written asynchronously (about 1 s), so run this folder after the inference folders.",
        [
            make_request(
                "Overview by model (last 24 h)",
                "GET",
                "/admin/api/analytics/overview?group_by=model",
                auth="admin",
                prerequest=["setTimeout(() => {}, 1500);"],
                description="Totals plus one row per model: requests, error rate, fallbacks, tokens, cost, and latency/TTFT/tokens-per-second percentiles. Optional `start`/`end` (ISO-8601).",
                tests=[
                    *status_test(200),
                    'pm.test("Has traffic and percentiles", () => { const body = pm.response.json(); pm.expect(body.totals.request_count).to.be.above(0); const group = body.groups.find(g => g.group_key === "demo-anthropic/fake-small"); pm.expect(group.latency_ms.p50).to.be.a("number"); pm.expect(group.latency_ms.p99).to.be.at.least(group.latency_ms.p50); });',
                ],
            ),
            make_request(
                "Overview by task",
                "GET",
                "/admin/api/analytics/overview?group_by=task",
                auth="admin",
                description="Unrouted tasks (like `sms`) appear here too.",
                tests=[
                    *status_test(200),
                    'pm.test("Includes the unrouted sms task", () => pm.expect(pm.response.json().groups.map(g => g.group_key)).to.include("sms"));',
                ],
            ),
            make_request(
                "Overview by provider",
                "GET",
                "/admin/api/analytics/overview?group_by=provider",
                auth="admin",
                description="",
                tests=[
                    *status_test(200),
                    'pm.test("Groups by provider", () => pm.expect(pm.response.json().group_by).to.eql("provider"));',
                ],
            ),
            make_request(
                "Time series",
                "GET",
                "/admin/api/analytics/timeseries?group_by=model",
                auth="admin",
                description="Bucketed requests, errors, tokens, cost and latency/TTFT percentiles. The bucket size is automatic (about 120 points) unless `bucket_seconds` is given; filters: provider_id, model_id, task_name.",
                tests=[
                    *status_test(200),
                    'pm.test("Has points", () => { const body = pm.response.json(); pm.expect(body.bucket_seconds).to.be.above(0); pm.expect(body.points.length).to.be.above(0); });',
                ],
            ),
            make_request(
                "Top errors",
                "GET",
                "/admin/api/analytics/errors?limit=10",
                auth="admin",
                description="Most frequent error classes per model with a sample message.",
                tests=[
                    *status_test(200),
                    'pm.test("Lists the fake 500s", () => pm.expect(pm.response.json().map(e => e.error_class)).to.include("upstream_server_error"));',
                ],
            ),
            make_request(
                "Recent requests (errors only)",
                "GET",
                "/admin/api/analytics/requests?errors_only=true&limit=20",
                auth="admin",
                description="Newest metric rows. Request and response bodies are never stored.",
                tests=[
                    *status_test(200),
                    'pm.test("Only errors", () => pm.response.json().forEach(row => pm.expect(row.error_class).to.not.be.null));',
                ],
            ),
            make_request(
                "Share of requests served per chain step",
                "GET",
                "/admin/api/analytics/chain-steps?task_name=query_rewrite",
                auth="admin",
                description="Per task: requests served by each chain step (share 0-1) and why chains moved on "
                "(error class, or `circuit_open`). Recent-request rows also carry `chain_step`, `chain_steps_tried` and `fallback_reason`.",
                tests=[
                    *status_test(200),
                    'pm.test("Step 2 served query_rewrite", () => { const task = pm.response.json().tasks[0]; pm.expect(task.task_name).to.eql("query_rewrite"); pm.expect(task.steps.map(s => s.chain_step)).to.include(2); pm.expect(task.fallback_reasons[0].reason).to.eql("upstream_server_error"); });',
                ],
            ),
            make_request(
                "Recent requests for a task",
                "GET",
                "/admin/api/analytics/requests?task_name=answer_generation&limit=5",
                auth="admin",
                description="Rows carry tokens (`cached_input_tokens` included), `cost_usd`, and `cost_saved_usd`: what the provider's prompt cache saved.",
                tests=[
                    *status_test(200),
                    'pm.test("Only answer_generation rows with cost fields", () => { const rows = pm.response.json(); pm.expect(rows.length).to.be.above(0); rows.forEach(row => { pm.expect(row.task_name).to.eql("answer_generation"); pm.expect(row).to.include.keys("cost_usd", "cost_saved_usd", "cached_input_tokens"); }); });',
                ],
            ),
        ],
    )
)

folders.append(
    folder(
        "12. Errors - Admin",
        'Admin endpoints use FastAPI\'s `{"detail": ...}` error format.',
        [
            make_request(
                "Invalid provider ID (422)",
                "POST",
                "/admin/api/providers",
                auth="admin",
                body={
                    "provider_id": "Bad_ID",
                    "display_name": "x",
                    "base_url": "https://api.example.com/v1",
                    "api_protocol": "openai_chat_completions",
                },
                description="Lowercase slug starting with a letter.",
                tests=[
                    *status_test(422),
                    'pm.test("Points at provider_id", () => pm.expect(JSON.stringify(pm.response.json().detail)).to.include("provider_id"));',
                ],
            ),
            make_request(
                "Unsupported API protocol (422)",
                "POST",
                "/admin/api/providers",
                auth="admin",
                body={
                    "provider_id": "gemini",
                    "display_name": "x",
                    "base_url": "https://api.example.com/v1",
                    "api_protocol": "gemini_generate_content",
                },
                description="",
                tests=status_test(422),
            ),
            make_request(
                "Duplicate provider (409)",
                "POST",
                "/admin/api/providers",
                auth="admin",
                body=provider_body("demo-chat", "openai_chat_completions", "openai", "Again"),
                description="",
                tests=status_test(409),
            ),
            make_request(
                "Unknown provider (404)",
                "GET",
                "/admin/api/providers/does-not-exist",
                auth="admin",
                description="",
                tests=status_test(404),
            ),
            make_request(
                "Delete a model that a route uses (409)",
                "DELETE",
                "/admin/api/models/{{anthropicModelPk}}",
                auth="admin",
                description="Models used by a task route or the default-model setting cannot be deleted.",
                tests=[
                    *status_test(409),
                    'pm.test("Names the route", () => pm.expect(pm.response.json().detail).to.include("answer_generation"));',
                ],
            ),
            make_request(
                "Route to a missing model (422)",
                "POST",
                "/admin/api/routes",
                auth="admin",
                body={"task_name": "equation_ocr", "steps": [{"model_pk": 99999999}]},
                description="",
                tests=[
                    *status_test(422),
                    'pm.test("Names the missing model", () => pm.expect(pm.response.json().detail).to.include("does not exist"));',
                ],
            ),
            make_request(
                "Remove vision from a model a vision task uses (409)",
                "PATCH",
                "/admin/api/models/{{localModelPk}}",
                auth="admin",
                body={"capabilities": []},
                description="`document_parse` is routed to it.",
                tests=[
                    *status_test(409),
                    'pm.test("Names the task", () => pm.expect(pm.response.json().detail).to.include("document_parse"));',
                ],
            ),
            make_request(
                "Default output above max output (422)",
                "PATCH",
                "/admin/api/models/{{chatModelPk}}",
                auth="admin",
                body={"default_max_output_tokens": 9000},
                description="`default_max_output_tokens` may not exceed `max_output_tokens` (8192).",
                tests=status_test(422),
            ),
            make_request(
                "Analytics range with start after end (422)",
                "GET",
                "/admin/api/analytics/overview?start=2026-01-02T00:00:00Z&end=2026-01-01T00:00:00Z",
                auth="admin",
                description="",
                tests=status_test(422),
            ),
        ],
    )
)

cleanup_items = [
    make_request(
        f"Delete route {task_name}",
        "DELETE",
        f"/admin/api/routes/{task_name}",
        auth="admin",
        description="The task stays in the list; the default model serves it again.",
        tests=status_test(204),
    )
    for task_name in DEMO_ROUTED_TASK_NAMES
]
cleanup_items.append(
    make_request(
        "Delete demo local deployment",
        "DELETE",
        "/admin/api/models/{{localModelPk}}",
        auth="admin",
        description="Admins can remove a registered deployment; local-llm would re-create it on its next registration.",
        tests=status_test(204),
    )
)
cleanup_items.append(
    make_request(
        "Clear default model",
        "PUT",
        "/admin/api/settings",
        auth="admin",
        body={"default_model_pk": None},
        description="",
        tests=status_test(200),
    )
)
cleanup_items += [
    make_request(
        f"Delete provider {provider_id}",
        "DELETE",
        f"/admin/api/providers/{provider_id}",
        auth="admin",
        description="Also deletes its models. Metrics history is kept.",
        tests=status_test(204),
    )
    for provider_id in ("demo-chat", "demo-responses", "demo-anthropic")
]
cleanup_items.append(
    make_request(
        "Logout",
        "DELETE",
        "/admin/api/session",
        auth="admin",
        description="Clears the session cookie.",
        tests=status_test(204),
    )
)
folders.append(
    folder(
        "13. Cleanup",
        "Removes the demo configuration, including the demo routes of built-in tasks (request metrics stay).",
        cleanup_items,
    )
)

collection = {
    "info": {
        "name": "LLM Gateway API",
        "_postman_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "llm-gateway-postman-collection")),
        "description": (
            "Requests, automated checks, and saved example responses for the LLM gateway: the OpenAI-compatible inference API "
            "used by the RAG backend (chat completions, task resolution and limits), the machine registration API used by "
            "services/local-llm, and the admin API behind the dashboard (providers, models, task list, routing, analytics).\n\n"
            "Setup:\n"
            "1. In services/llm-gateway run `docker compose --profile demo up --build` (the `demo` profile adds a fake "
            "OpenAI/Anthropic-compatible provider, so no real API keys are needed) and wait until Readiness returns 200.\n"
            "2. Set the `apiKey` collection variable to LLM_GATEWAY_API_KEY, `registrationKey` to LLM_GATEWAY_REGISTRATION_API_KEY, "
            "and `adminPassword` to the admin password whose hash is in LLM_GATEWAY_ADMIN_PASSWORD_HASH.\n"
            "3. Run the whole collection with the Collection Runner, in order. It logs in, removes leftovers from earlier runs, creates three "
            "demo providers (one per upstream protocol), models with limits and capabilities, routes for the built-in tasks and a default model, "
            "registers a local deployment the way services/local-llm does, sends streaming and non-streaming requests through each, "
            "checks the dashboard analytics, exercises error cases, and cleans up. Tasks are a fixed built-in list, so the demos "
            "replace the routes of built-in tasks: use a demo stack, not a gateway whose routes you want to keep.\n\n"
            "Admin requests rely on Postman's cookie jar (the login cookie is sent automatically to {{baseUrl}}/admin/api). "
            "Example responses were captured from a live run against the fake provider."
        ),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "auth": {
        "type": "bearer",
        "bearer": [{"key": "token", "value": "{{apiKey}}", "type": "string"}],
    },
    "variable": [
        *[
            {"key": key, "value": value, "type": "string"}
            for key, value in COLLECTION_VARIABLE_DEFAULTS.items()
        ],
        *[
            {"key": key, "value": "", "type": "string"}
            for key in (
                "chatModelPk",
                "rejectingModelPk",
                "responsesModelPk",
                "anthropicModelPk",
                "brokenModelPk",
                "misconfiguredModelPk",
                "toolModelPk",
                "breakerModelPk",
                "visionModelPk",
                "localModelPk",
                "leftoverLocalModelPk",
            )
        ],
    ],
    "item": folders,
}
with open(OUTPUT_PATH, "w", encoding="utf-8") as output_file:
    json.dump(collection, output_file, indent=2, ensure_ascii=False)
    output_file.write("\n")
print("requests:", sum(len(f["item"]) for f in folders))
