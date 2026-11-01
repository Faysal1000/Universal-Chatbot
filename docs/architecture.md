# Architecture

Universal Chatbot is a single-organisation RAG platform. Admins upload documents and run
every service through one admin console; anonymous website visitors ask questions in a public chat
and get streamed, grounded answers that cite document pages.

## System context

```mermaid
flowchart LR
  visitor([Website visitor]) -- public chat, SSE --> rag
  admin([Organisation admin]) -- one sign-in --> console[admin-console]
  console -- admin APIs, service keys --> rag & gateway & localllm[local-llm]
  rag[rag] --> gateway[llm-gateway]
  gateway --> providers[(LLM providers / self-hosted VLMs)]
```

## Containers

```mermaid
flowchart TB
  subgraph rag
    api[api process<br/>NestJS: public + admin HTTP]
    worker[worker process<br/>NestJS: BullMQ pipeline]
    end
  parser[document-parser<br/>Python: pypdfium2, pdfminer, Tesseract, Nemotron via gateway]
  embed[embedding-server<br/>Python: EmbeddingGemma 2]
  gateway[llm-gateway<br/>Python: admin API, no UI]
  console[admin-console<br/>TypeScript BFF + React SPA<br/>the only admin UI]
  localllm[local-llm<br/>Python: Transformers + llama.cpp<br/>Nemotron Parse + admin models]

  pg[(Postgres + pgvector, Neon<br/>one database for rag + llm-gateway<br/>holds the search index)]
  redis[(Redis<br/>BullMQ, rate limits)]
  s3[(S3 bucket, Neon<br/>originals, renders, manifests)]

  api --> pg & redis & s3
  worker --> pg & redis & s3
  api -- query embeddings --> embed
  api -- query_rewrite, answer_generation --> gateway
  worker -- document embeddings --> embed
  redis -- parse.inspect / parse.pages --> parser
  parser --> s3
  parser -- document_parse, table_extraction, ... --> gateway
  gateway --> pg
  gateway -- self-hosted deployments --> localllm
  localllm -. registers deployments .-> gateway
  console -- admin API + bearer key --> api & gateway & localllm
```

| Service | Owns |
|---|---|
| embedding-server | Hugging Face model cache |
| llm-gateway | its tables in Postgres (providers, routes, request metrics) |
| admin-console | nothing persistent (in-memory sessions) |
| local-llm | volume `local-llm-state` (deployments, model cache) |
| rag | its tables in Postgres (including chunk vectors), the bucket, Redis `rag:*` |
| document-parser | nothing (writes only under keys it is given) |

## Ingestion

```mermaid
sequenceDiagram
  autonumber
  actor Admin
  participant API as rag api
  participant S3 as S3 bucket
  participant W as rag worker
  participant P as document-parser
  participant GW as llm-gateway
  participant E as embedding-server
  participant PG as Postgres

  Admin->>API: POST /v1/admin/documents (multipart)
  API->>S3: stream original, computing sha256
  API->>API: dedupe by sha256, insert document + ingestion run
  API-->>Admin: 202 {documentId, runId}
  API->>W: enqueue parse.inspect (requestId in job meta)
  W-->>P: parse.inspect
  P->>S3: convert images to PDF if needed
  P-->>W: ParseInspectResult (page kinds, complexity)
  W->>P: FlowProducer: N × parse.pages under ingest.assemble
  P->>GW: selective VLM calls (model = task name)
  P->>S3: blocks-NNNN.jsonl, crops, renders
  P-->>W: ParsePagesResult (manifest key)
  W->>S3: read and schema-validate manifests
  W->>W: assemble blocks, then structure-aware chunking
  W->>E: POST /v1/embed/batch (≤64, task=document)
  W->>PG: chunk_vectors: embedding (pgvector) + search terms (tsvector)
  W->>W: document status = ready
```

## Question answering

```mermaid
sequenceDiagram
  autonumber
  actor Visitor
  participant API as rag api
  participant GW as llm-gateway
  participant E as embedding-server
  participant PG as Postgres

  Note over Visitor: messages sent within a 1–2 s pause go out as one turn, and only Stop is offered until the reply ends
  Visitor->>API: POST /v1/public/conversations/{id}/turns
  API->>API: Turnstile session, IP / fingerprint / session limits, token budget, max_message_chars
  API->>GW: query_rewrite (when there is history)
  API->>E: embed query (task=query)
  API->>PG: pgvector cosine top-K + full-text top-K, enabled docs only
  API->>API: RRF fusion, dedupe, keep sources ≥ min_similarity, top max_sources
  alt no source reaches min_similarity
    API-->>Visitor: fallback message (no LLM call)
  else
    API->>API: fit prompt to the context window (sources, summary, recent turns)
    API->>GW: answer_generation (stream)
    GW-->>API: tokens
    alt answer text
      API-->>Visitor: SSE answer.delta …, answer.citations, message.completed
    else output limit spent before any answer
      API-->>Visitor: SSE error answer_cut_off (turn failed, retryable)
    end
  end
```

### Prompt budget

The answer prompt is fitted to the smallest context window among the models routed to
`answer_generation` (12,288 tokens when none declares one). The admin's **max answer tokens** are
reserved first; the rules, instruction, sources and new messages come next, and history gets what is
left. History over the summary threshold is folded into a rolling summary by the worker, and the
newest turns are always kept word for word. Whatever the prompt leaves unused is added to the output
limit, up to four times the answer length, because models that think before answering spend output
tokens on it. A turn that ends without answer text is recorded as failed, not as an answer.

## Cross-cutting conventions

- **Configuration:** each service reads only `<SERVICE>_*` environment variables,
  validated at startup. The process refuses to start on any invalid value and names
  every offending variable.
- **Errors:** RFC 9457 `application/problem+json` with a stable `code` and the
  `requestId`.
- **Logs:** JSON lines on stdout (`make logs`); every request has an `X-Request-ID`
  that appears in each log line it causes, including the queue jobs it enqueues.
- **Health:** `/health/live` is the process alone; `/health/ready` checks every
  dependency within a timeout and returns 503 while shutting down.
- **Security:** non-root read-only containers with no Linux capabilities, host ports
  bound to 127.0.0.1, and one admin key per service.
- **Contracts:** queue payloads and manifests are JSON Schemas in
  `services/rag/contracts/`, with generated types and examples validated in CI.

## Deployment

Postgres and the bucket are always external (Neon provides both); every service reads them through
connection strings only. The same service images run in three ways:

| Where | How | Redis |
|---|---|---|
| One machine or VM | root `docker-compose.yml`, one container per service (`make up`) | container in the stack |
| Hugging Face Space | [deploy/huggingface-space](../deploy/huggingface-space/README.md): all services in one container behind nginx, deployed by `.github/workflows/huggingface-space.yml`; GitHub is the only source of its secrets | in the container |
| One service alone | `services/<service>/docker-compose.yml` with its own `.env` | per service |

The service workflows in `.github/workflows/` lint, typecheck and test each service; only the
Space workflow deploys.
