"""Build postman_collection.json, with saved example responses captured from a running stack.

Usage (from services/rag, with the stack up):
    RAG_ADMIN_API_KEY=... python3 scripts/postman/build_collection.py [base-url]

Each request is sent once, in collection order, to capture a real example response. The
same chaining (ids, the visitor token) is written into the collection as test scripts, so
`postman collection run postman_collection.json --working-dir . --env-var adminApiKey=...`
replays it. Secrets never reach the file: the admin key is a placeholder variable and
visitor tokens in examples are masked.
"""

import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

SERVICE_DIRECTORY = Path(__file__).resolve().parents[2]
COLLECTION_FILE = SERVICE_DIRECTORY / "postman_collection.json"
COLLECTION_ID = "8d0e0fe0-ca0b-512f-88bb-2474c28fc8a5"
ADMIN_KEY_PLACEHOLDER = "change_this_admin_api_key"
MASK = "<redacted>"
UNKNOWN_ID = "00000000-0000-4000-8000-000000000000"
SENSITIVE_FIELDS = ("sessionToken",)


def request(
    name,
    method,
    path,
    *,
    auth=None,
    body=None,
    file=None,
    form=None,
    expect=200,
    tests=(),
    capture=None,
    sse_capture=None,
    skip_unless=None,
    description="",
    headers=None,
    has_request_id=True,
):
    return {
        "has_request_id": has_request_id,
        "name": name,
        "method": method,
        "path": path,
        "auth": auth,
        "body": body,
        "file": file,
        "form": form or {},
        "expect": expect,
        "tests": list(tests),
        "capture": capture or {},
        "sse_capture": sse_capture or {},
        "skip_unless": skip_unless,
        "description": description,
        "headers": headers or {},
    }


def problem(code):
    return f"pm.test('Problem code is {code}', () => pm.expect(pm.response.json().code).to.eql('{code}'));"


FOLDERS = [
    (
        "1. Health",
        [
            request(
                "Liveness (api)",
                "GET",
                "/health/live",
                tests=[
                    "pm.test('Reports alive', () => pm.expect(pm.response.json()).to.eql({ status: 'alive' }));"
                ],
                description="200 while the process runs.",
            ),
            request(
                "Readiness (api)",
                "GET",
                "/health/ready",
                tests=[
                    "pm.test('Every dependency is up', () => pm.expect(pm.response.json().status).to.eql('ready'));"
                ],
                description="503 until Postgres, Redis and object storage answer.",
            ),
        ],
    ),
    (
        "2. API documentation",
        [
            request(
                "OpenAPI document",
                "GET",
                "/openapi.json",
                has_request_id=False,
                tests=[
                    "pm.test('Lists the public and admin APIs', () => { const paths = Object.keys(pm.response.json().paths); pm.expect(paths).to.include('/v1/public/conversations/{conversationId}/turns'); pm.expect(paths).to.include('/v1/admin/documents'); });"
                ],
                description="Served when RAG_ENABLE_API_DOCS=true; Swagger UI at /docs.",
            ),
        ],
    ),
    (
        "3. Errors (RFC 9457 problem details)",
        [
            request(
                "Unknown route",
                "GET",
                "/v1/does-not-exist",
                expect=404,
                tests=[
                    "pm.test('Problem JSON', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('application/problem+json'));",
                    problem("route_not_found"),
                ],
            ),
            request(
                "Admin call without credentials",
                "GET",
                "/v1/admin/documents",
                expect=401,
                tests=[problem("authentication_required")],
            ),
        ],
    ),
    (
        "4. Admin: documents",
        [
            request(
                "Upload a document (or find the duplicate)",
                "POST",
                "/v1/admin/documents",
                auth="admin",
                file=("file", "test/fixtures/sample-handbook.pdf"),
                form={"title": "Employee Handbook"},
                expect=(201, 409),
                capture={"documentId": ["id", "details.existingDocumentId"]},
                description="Multipart upload of a PDF, PNG, JPEG or TIFF. 409 duplicate_document carries details.existingDocumentId.",
            ),
            request(
                "List documents",
                "GET",
                "/v1/admin/documents?limit=20",
                auth="admin",
                tests=["pm.test('Has items', () => pm.expect(pm.response.json().items).to.be.an('array'));"],
            ),
            request(
                "Documents by id",
                "GET",
                "/v1/admin/documents?ids={{documentId}}",
                auth="admin",
                tests=[
                    "pm.test('Only that document', () => pm.expect(pm.response.json().items.map((document) => document.id)).to.eql([pm.collectionVariables.get('documentId')]));"
                ],
                description="ids takes up to 100 comma-separated document ids.",
            ),
            request(
                "Document detail",
                "GET",
                "/v1/admin/documents/{{documentId}}",
                auth="admin",
                tests=[
                    "pm.test('Includes runs', () => pm.expect(pm.response.json().runs).to.be.an('array'));"
                ],
            ),
            request(
                "Rename or toggle a document",
                "PATCH",
                "/v1/admin/documents/{{documentId}}",
                auth="admin",
                body={"title": "Employee Handbook", "isEnabled": True},
                tests=["pm.test('Enabled', () => pm.expect(pm.response.json().isEnabled).to.eql(true));"],
                description="isEnabled false hides the document from answers at once.",
            ),
            request(
                "Progress stream (SSE)",
                "GET",
                "/v1/admin/documents/{{documentId}}/events",
                auth="admin",
                tests=[
                    "pm.test('Server-sent events', () => pm.expect(pm.response.text()).to.include('event:'));"
                ],
                description="text/event-stream of progress; closes once the run is ready or failed.",
            ),
            request("Pages", "GET", "/v1/admin/documents/{{documentId}}/pages", auth="admin"),
            request(
                "Page with blocks",
                "GET",
                "/v1/admin/documents/{{documentId}}/pages/1",
                auth="admin",
                tests=[
                    "pm.test('Has blocks with boxes', () => pm.expect(pm.response.json().blocks.length).to.be.above(0));"
                ],
            ),
            request(
                "Page image (scanned page)",
                "GET",
                "/v1/admin/documents/{{documentId}}/pages/3/image",
                auth="admin",
                tests=[
                    "pm.test('PNG', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('image/png'));"
                ],
            ),
            request(
                "Chunks in the live index",
                "GET",
                "/v1/admin/documents/{{documentId}}/chunks",
                auth="admin",
                tests=[
                    "pm.test('Has chunks', () => pm.expect(pm.response.json().items.length).to.be.above(0));",
                    "pm.test('Chunks name their block types', () => pm.expect(pm.response.json().items[0].blockTypes).to.be.an('array').that.is.not.empty);",
                ],
            ),
            request(
                "Download the original",
                "GET",
                "/v1/admin/documents/{{documentId}}/download",
                auth="admin",
                tests=[
                    "pm.test('Attachment', () => pm.expect(pm.response.headers.get('Content-Disposition')).to.include('attachment'));"
                ],
            ),
            request(
                "Ingestion runs (all documents)",
                "GET",
                "/v1/admin/ingestion-runs?status=all&limit=5",
                auth="admin",
            ),
            request(
                "Ingestion runs of one document",
                "GET",
                "/v1/admin/ingestion-runs?status=all&documentId={{documentId}}",
                auth="admin",
                tests=[
                    "pm.test('Only that document', () => pm.response.json().forEach((run) => pm.expect(run.documentId).to.eql(pm.collectionVariables.get('documentId'))));"
                ],
            ),
            request(
                "Reprocess an unknown document",
                "POST",
                f"/v1/admin/documents/{UNKNOWN_ID}/reprocess",
                auth="admin",
                expect=404,
                tests=[problem("document_not_found")],
                description="On a real document: 202 with the new ingestionRunId; current chunks answer until it finishes.",
            ),
            request(
                "Delete an unknown document",
                "DELETE",
                f"/v1/admin/documents/{UNKNOWN_ID}",
                auth="admin",
                expect=404,
                tests=[problem("document_not_found")],
                description="On a real document: 202, then points, objects and rows are removed in the background.",
            ),
        ],
    ),
    (
        "5. Admin: chatbot settings",
        [
            request(
                "Active settings",
                "GET",
                "/v1/admin/chatbot-settings",
                auth="admin",
                capture={"settingsVersion": ["version"]},
                tests=[
                    "pm.test('Has the showSources switch', () => pm.expect(pm.response.json().showSources).to.be.a('boolean'));",
                    "pm.test('Has a version note field', () => pm.expect(pm.response.json()).to.have.property('note'));",
                ],
                description="showSources false hides citations, [n] markers and source previews from visitors; citations are still stored.",
            ),
            request("Settings versions", "GET", "/v1/admin/chatbot-settings/versions", auth="admin"),
            request(
                "Activate a version",
                "POST",
                "/v1/admin/chatbot-settings/versions/{{settingsVersion}}/activate",
                auth="admin",
                expect=(200, 204),
                description="PUT /v1/admin/chatbot-settings saves a new version (full body, see OpenAPI); any version can be re-activated.",
            ),
        ],
    ),
    (
        "6. Public: configuration and sessions",
        [
            request(
                "Chat configuration",
                "GET",
                "/v1/public/config",
                tests=[
                    "pm.test('Has a greeting', () => pm.expect(pm.response.json().greeting).to.be.a('string'));",
                    "pm.test('Says whether sources are shown', () => pm.expect(pm.response.json().showSources).to.be.a('boolean'));",
                ],
                description="showSources false: no answer.citations events, no [n] markers, and citation previews answer 404.",
            ),
            request(
                "Start a visitor session",
                "POST",
                "/v1/public/sessions",
                expect=201,
                body={"turnstileToken": None, "fingerprint": "postman-device"},
                capture={"visitorToken": ["sessionToken"], "visitorSessionId": ["sessionId"]},
                description="Send the Turnstile token when /config has a turnstileSiteKey. The token is a bearer credential.",
            ),
        ],
    ),
    (
        "7. Public: conversations and turns",
        [
            request(
                "Create a conversation",
                "POST",
                "/v1/public/conversations",
                auth="visitor",
                body={},
                expect=201,
                capture={"conversationId": ["id"]},
            ),
            request(
                "Rename the conversation",
                "PATCH",
                "/v1/public/conversations/{{conversationId}}",
                auth="visitor",
                body={"title": "Leave questions"},
            ),
            request(
                "Upload an image attachment",
                "POST",
                "/v1/public/attachments",
                auth="visitor",
                file=("file", "test/fixtures/sample-image.png"),
                expect=201,
                tests=[
                    "pm.test('Signed URL', () => pm.expect(pm.response.json().url).to.include('/v1/public/assets/'));"
                ],
                description="JPEG/PNG/WEBP up to 5 MiB, re-encoded without metadata; reference its id in a turn within 1 h.",
            ),
            request(
                "Send a turn (SSE)",
                "POST",
                "/v1/public/conversations/{{conversationId}}/turns",
                auth="visitor",
                body={
                    "turnId": "{{turnId}}",
                    "replacesTurnId": None,
                    "messages": [
                        {
                            "clientMessageId": "{{clientMessageId}}",
                            "content": "How many days of annual leave do employees get?",
                            "attachmentIds": [],
                        }
                    ],
                },
                headers={"Idempotency-Key": "{{turnId}}"},
                tests=[
                    "pm.test('Completes', () => pm.expect(pm.response.text()).to.include('event: message.completed'));"
                ],
                sse_capture={
                    "assistantMessageId": ("message.started", "assistantMessageId"),
                    "citationId": ("answer.citations", "citations.0.id"),
                },
                description="The response is the stream: message.started, status, answer.delta…, answer.citations, conversation.updated, message.completed.",
            ),
            request(
                "Replay the finished turn",
                "GET",
                "/v1/public/conversations/{{conversationId}}/turns/{{turnId}}/events",
                auth="visitor",
                headers={"Last-Event-ID": "1"},
                tests=[
                    "pm.test('Replays the end', () => pm.expect(pm.response.text()).to.include('message.completed'));"
                ],
                description="Resumes after a disconnect from the event after Last-Event-ID.",
            ),
            request(
                "Stop a turn that is not running",
                "POST",
                f"/v1/public/conversations/{{{{conversationId}}}}/turns/{UNKNOWN_ID}/cancel",
                auth="visitor",
                expect=404,
                description="On a running turn: 202; the stream ends with finishReason cancelled.",
            ),
            request(
                "Messages",
                "GET",
                "/v1/public/conversations/{{conversationId}}/messages?limit=50",
                auth="visitor",
                tests=[
                    "pm.test('Question and answer', () => pm.expect(pm.response.json().items.length).to.be.at.least(2));"
                ],
            ),
            request(
                "Citation preview",
                "GET",
                "/v1/public/citations/{{citationId}}/preview",
                auth="visitor",
                skip_unless="citationId",
                description="Signed page and crop image URLs, valid 10 minutes. Skipped when the answer cited nothing.",
            ),
            request(
                "Rate the answer",
                "POST",
                "/v1/public/messages/{{assistantMessageId}}/feedback",
                auth="visitor",
                body={"rating": "up", "comment": "Clear answer"},
                expect=(200, 201, 204),
            ),
            request("List conversations", "GET", "/v1/public/conversations", auth="visitor"),
        ],
    ),
    (
        "8. Admin: conversations and feedback",
        [
            request("Conversations", "GET", "/v1/admin/conversations", auth="admin"),
            request(
                "Conversation with retrieval traces",
                "GET",
                "/v1/admin/conversations/{{conversationId}}",
                auth="admin",
                tests=[
                    "pm.test('Traces name the selected sources', () => { const trace = pm.response.json().turns.map((turn) => turn.retrievalTrace).find((candidate) => candidate !== null); pm.expect(trace.selected).to.be.an('array'); });"
                ],
            ),
            request(
                "Feedback",
                "GET",
                "/v1/admin/feedback",
                auth="admin",
                tests=[
                    "pm.test('Shows what was rated', () => { const [rating] = pm.response.json(); pm.expect(rating.questionExcerpt).to.be.a('string'); pm.expect(rating.answerExcerpt).to.be.a('string'); });"
                ],
            ),
            request(
                "Delete the visitor's conversation",
                "DELETE",
                "/v1/public/conversations/{{conversationId}}",
                auth="visitor",
                expect=204,
            ),
        ],
    ),
    (
        "9. Admin: abuse protection",
        [
            request(
                "Block an address",
                "POST",
                "/v1/admin/client-blocks",
                auth="admin",
                expect=201,
                body={"ipAddress": "203.0.113.9", "reason": "Postman example", "expiresAt": None},
                capture={"clientBlockId": ["id"]},
                description="Or send visitorSessionId to block that session's address and device. Stored only as keyed hashes.",
            ),
            request("Blocked clients", "GET", "/v1/admin/client-blocks", auth="admin"),
            request(
                "Unblock", "DELETE", "/v1/admin/client-blocks/{{clientBlockId}}", auth="admin", expect=204
            ),
        ],
    ),
    (
        "10. Admin: operations",
        [
            request(
                "Queues",
                "GET",
                "/v1/admin/queues",
                auth="admin",
                tests=[
                    "pm.test('Includes the parser queues', () => pm.expect(pm.response.json().map((queue) => queue.queueName)).to.include('parse.pages'));"
                ],
            ),
            request("Dead letters", "GET", "/v1/admin/dead-letters", auth="admin"),
            request(
                "Retry an unknown dead letter",
                "POST",
                "/v1/admin/dead-letters/unknown.job/retry",
                auth="admin",
                expect=404,
                tests=[problem("dead_letter_not_found")],
                description="Ingestion jobs start a new run of their document; other jobs are retried in place.",
            ),
        ],
    ),
    (
        "11. Admin: index versions",
        [
            request(
                "Index versions",
                "GET",
                "/v1/admin/index-versions",
                auth="admin",
                capture={"liveIndexVersionId": ["0.id"]},
            ),
            request(
                "Promote the live version (refused)",
                "POST",
                "/v1/admin/index-versions/{{liveIndexVersionId}}/promote",
                auth="admin",
                expect=409,
                tests=[problem("index_version_not_promotable")],
                description="POST /v1/admin/index-versions builds a new version; promote a ready or retired one to go live or roll back.",
            ),
        ],
    ),
    (
        "12. Admin: analytics and audit",
        [
            request(
                "Analytics overview",
                "GET",
                "/v1/admin/analytics/overview?days=7",
                auth="admin",
                tests=[
                    "pm.test('Has turn counts', () => pm.expect(pm.response.json().turns.total).to.be.a('number'));"
                ],
            ),
            request("Audit log", "GET", "/v1/admin/audit-events?limit=10", auth="admin"),
        ],
    ),
]

#: Fresh UUIDs for every request that sends them (a new turn per run).
GENERATED_VARIABLES = ("turnId", "clientMessageId")


def uses_variable(spec, name):
    """Only requests that send the variable get a fresh value; later ones reuse it."""
    placeholder = f"{{{{{name}}}}}"
    return placeholder in json.dumps(spec["body"]) or placeholder in json.dumps(spec["headers"])


# ----- capturing real examples -----


def substitute(text, variables):
    return re.sub(r"\{\{(\w+)\}\}", lambda match: str(variables.get(match.group(1), match.group(0))), text)


def lookup(data, dotted_path):
    for part in dotted_path.split("."):
        if isinstance(data, list) and part.isdigit() and int(part) < len(data):
            data = data[int(part)]
        elif isinstance(data, dict) and part in data:
            data = data[part]
        else:
            return None
    return data


def sse_events(text):
    events, name = [], None
    for line in text.splitlines():
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:") and name is not None:
            events.append((name, json.loads(line[5:])))
    return events


def multipart(field, file_path, form):
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
        for key, value in form.items()
    ]
    content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{Path(file_path).name}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n".encode()
        + (SERVICE_DIRECTORY / file_path).read_bytes()
        + b"\r\n"
    )
    return b"".join(parts) + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def send(spec, base_url, variables, admin_key):
    headers = {key: substitute(value, variables) for key, value in spec["headers"].items()}
    data = None
    if spec["auth"] == "admin":
        headers["Authorization"] = f"Bearer {admin_key}"
    elif spec["auth"] == "visitor":
        headers["Authorization"] = f"Bearer {variables['visitorToken']}"
    if spec["file"] is not None:
        data, headers["Content-Type"] = multipart(*spec["file"], spec["form"])
    elif spec["body"] is not None:
        data = substitute(json.dumps(spec["body"]), variables).encode()
        headers["Content-Type"] = "application/json"
    http_request = urllib.request.Request(
        base_url + substitute(spec["path"], variables), data=data, method=spec["method"], headers=headers
    )
    try:
        with urllib.request.urlopen(http_request, timeout=180) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def capture_example(spec, base_url, variables, admin_key):
    for name in GENERATED_VARIABLES:
        if uses_variable(spec, name):
            variables[name] = str(uuid.uuid4())
    if spec["skip_unless"] is not None and not variables.get(spec["skip_unless"]):
        return None
    status, headers, body_bytes = send(spec, base_url, variables, admin_key)
    expected = spec["expect"] if isinstance(spec["expect"], tuple) else (spec["expect"],)
    if status not in expected:
        raise SystemExit(f"{spec['name']}: expected {expected}, got {status}: {body_bytes[:300]!r}")
    content_type = headers.get("Content-Type", "")
    body_text = (
        body_bytes.decode("utf-8", "replace")
        if not content_type.startswith(("image/", "application/pdf"))
        else ""
    )
    if "json" in content_type and body_text:
        parsed = json.loads(body_text)
        for variable, paths in spec["capture"].items():
            variables[variable] = next(
                (lookup(parsed, path) for path in paths if lookup(parsed, path) is not None), None
            )
        body_text = json.dumps(mask(parsed), indent=2, ensure_ascii=False)
    if "event-stream" in content_type:
        events = sse_events(body_text)
        for variable, (event_name, path) in spec["sse_capture"].items():
            variables[variable] = next(
                (lookup(data, path) for name, data in events if name == event_name), None
            )
    if content_type.startswith(("image/", "application/pdf")):
        body_text = f"<{len(body_bytes)} bytes of {content_type}>"
    return status, content_type, body_text


def mask(value):
    if isinstance(value, dict):
        return {key: (MASK if key in SENSITIVE_FIELDS else mask(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [mask(item) for item in value]
    return value


# ----- writing the collection -----


def url_of(path):
    raw = "{{baseUrl}}" + path
    path_part, _, query = path.partition("?")
    url = {
        "raw": raw,
        "host": ["{{baseUrl}}"],
        "path": [segment for segment in path_part.split("/") if segment],
    }
    if query:
        url["query"] = [
            {"key": key, "value": value}
            for key, _, value in (pair.partition("=") for pair in query.split("&"))
        ]
    return url


def postman_request(spec):
    headers = [{"key": key, "value": value} for key, value in spec["headers"].items()]
    item_request = {"method": spec["method"], "header": headers, "url": url_of(spec["path"])}
    if spec["auth"] is not None:
        token = "{{adminApiKey}}" if spec["auth"] == "admin" else "{{visitorToken}}"
        item_request["auth"] = {
            "type": "bearer",
            "bearer": [{"key": "token", "value": token, "type": "string"}],
        }
    if spec["file"] is not None:
        field, file_path = spec["file"]
        item_request["body"] = {
            "mode": "formdata",
            "formdata": [{"key": field, "type": "file", "src": file_path}]
            + [{"key": key, "value": value, "type": "text"} for key, value in spec["form"].items()],
        }
    elif spec["body"] is not None:
        item_request["body"] = {
            "mode": "raw",
            "raw": json.dumps(spec["body"], indent=2, ensure_ascii=False),
            "options": {"raw": {"language": "json"}},
        }
    if spec["description"]:
        item_request["description"] = spec["description"]
    return item_request


def test_script(spec):
    expected = spec["expect"] if isinstance(spec["expect"], tuple) else (spec["expect"],)
    lines = [
        f"pm.test('Status is {' or '.join(map(str, expected))}', () => pm.expect(pm.response.code).to.be.oneOf({list(expected)}));",
    ]
    if spec["has_request_id"]:
        lines.append("pm.test('Carries an X-Request-ID', () => pm.response.to.have.header('X-Request-ID'));")
    lines += spec["tests"]
    for variable, paths in spec["capture"].items():
        reads = " ?? ".join(f"pick(body, {json.dumps(path)})" for path in paths)
        lines.append(
            "{ const body = pm.response.json(); const pick = (data, path) => path.split('.').reduce((value, key) => value == null ? undefined : value[key], data);"
            f" pm.collectionVariables.set('{variable}', {reads}); }}"
        )
    for variable, (event_name, path) in spec["sse_capture"].items():
        lines.append(
            "{ const blocks = pm.response.text().split('\\n\\n');"
            f" const block = blocks.find((text) => text.includes('event: {event_name}'));"
            " const data = block ? JSON.parse(block.split('\\n').find((line) => line.startsWith('data:')).slice(5)) : undefined;"
            f" const value = {json.dumps(path)}.split('.').reduce((current, key) => current == null ? undefined : current[key], data);"
            f" pm.collectionVariables.set('{variable}', value ?? ''); }}"
        )
    return lines


def prerequest_script(spec):
    lines = [
        f"pm.collectionVariables.set('{name}', crypto.randomUUID());"
        for name in GENERATED_VARIABLES
        if uses_variable(spec, name)
    ]
    if spec["skip_unless"] is not None:
        lines.append(f"if (!pm.collectionVariables.get('{spec['skip_unless']}')) pm.execution.skipRequest();")
    return lines


def collection_item(spec, example):
    item = {
        "name": spec["name"],
        "request": postman_request(spec),
        "response": [],
        "event": [{"listen": "test", "script": {"type": "text/javascript", "exec": test_script(spec)}}],
    }
    prerequest = prerequest_script(spec)
    if prerequest:
        item["event"].insert(
            0, {"listen": "prerequest", "script": {"type": "text/javascript", "exec": prerequest}}
        )
    if example is not None:
        status, content_type, body_text = example
        item["response"].append(
            {
                "name": f"{status} example",
                "originalRequest": postman_request(spec),
                "code": status,
                "status": "",
                "header": [{"key": "Content-Type", "value": content_type}],
                "body": body_text,
                "_postman_previewlanguage": "json" if "json" in content_type else "text",
            }
        )
    return item


def main():
    base_url = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080").rstrip("/")
    admin_key = os.environ["RAG_ADMIN_API_KEY"]
    variables = {}
    folders = []
    for folder_name, specs in FOLDERS:
        folders.append(
            {
                "name": folder_name,
                "item": [
                    collection_item(spec, capture_example(spec, base_url, variables, admin_key))
                    for spec in specs
                ],
            }
        )
    collection = {
        "info": {
            "_postman_id": COLLECTION_ID,
            "name": "RAG API",
            "description": "Public chat API and admin API of services/rag. Set adminApiKey to RAG_ADMIN_API_KEY; "
            "the run creates its own visitor session. Run with `postman collection run "
            "postman_collection.json --working-dir . --env-var adminApiKey=...` from services/rag.",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "item": folders,
        "variable": [
            {"key": "baseUrl", "value": "http://localhost:8080", "type": "string"},
            {"key": "adminApiKey", "value": ADMIN_KEY_PLACEHOLDER, "type": "secret"},
        ]
        + [
            {"key": name, "value": "", "type": "string"}
            for name in (
                "visitorToken",
                "visitorSessionId",
                "documentId",
                "settingsVersion",
                "conversationId",
                "turnId",
                "clientMessageId",
                "assistantMessageId",
                "citationId",
                "clientBlockId",
                "liveIndexVersionId",
            )
        ],
    }
    COLLECTION_FILE.write_text(json.dumps(collection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {sum(len(folder['item']) for folder in folders)} requests to {COLLECTION_FILE.name}")


if __name__ == "__main__":
    main()
