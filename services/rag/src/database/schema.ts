/**
 * PostgreSQL schema of rag.
 *
 * Conventions:
 * - Enumerations are `text` columns with CHECK constraints (not Postgres enums), so a
 *   new value is a one-line migration instead of an `ALTER TYPE`.
 * - Bounding boxes are page-relative and normalised to 0..1 (origin top-left), so they
 *   are independent of render DPI.
 * - Postgres is the source of truth and holds the search index (pgvector embeddings and
 *   full-text terms); object storage holds bulk files that are always reachable from a row here.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Untyped so index versions with different embedding models share one table. */
const vector = customType<{ data: readonly number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (values) => `[${values.join(',')}]`,
  fromDriver: (literal) => literal.slice(1, -1).split(',').map(Number),
});
/** Written as a tsvector literal so terms come from rag's tokenizer, not Postgres's parser. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** CHECK that a text column holds one of the allowed values. */
const oneOf = (columnName: string, allowedValues: readonly string[]) =>
  sql.raw(`${columnName} IN (${allowedValues.map((value) => `'${value}'`).join(', ')})`);

// ----- Admin access -----

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('admin_users_username_lower_unique').on(sql`lower(${table.username})`),
    check('admin_users_username_length', sql`char_length(${table.username}) BETWEEN 1 AND 128`),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    /** SHA-256 of the session token; the token itself is only ever in the cookie. */
    tokenHash: char('token_hash', { length: 64 }).primaryKey(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    ipHash: char('ip_hash', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('admin_sessions_admin_user_id_index').on(table.adminUserId),
    index('admin_sessions_expires_at_index').on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorAdminUserId: uuid('actor_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    /** Username at the time: the signed-in admin's, or the console user's sent as `X-Admin-Actor`. */
    actorUsername: text('actor_username'),
    /** Dotted verb, e.g. `document.uploaded`, `document.disabled`, `chatbot_settings.activated`. */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    requestId: text('request_id'),
  },
  (table) => [
    index('audit_events_occurred_at_index').on(table.occurredAt),
    index('audit_events_target_index').on(table.targetType, table.targetId),
  ],
);

// ----- Documents and ingestion -----

export const DOCUMENT_STATUSES = [
  'uploaded',
  'inspecting',
  'parsing',
  'chunking',
  'indexing',
  'ready',
  'failed',
  'deleting',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lowercase hex SHA-256 of the original bytes; identical uploads are rejected. */
    sha256: char('sha256', { length: 64 }).notNull(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    pageCount: integer('page_count'),
    title: text('title'),
    detectedLanguage: text('detected_language'),
    /** Object key of the original file in the service bucket. */
    storageKey: text('storage_key').notNull(),
    status: text('status').$type<DocumentStatus>().notNull().default('uploaded'),
    /** Disabled documents stay indexed but are excluded from retrieval. */
    isEnabled: boolean('is_enabled').notNull().default(true),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    uploadedByAdminUserId: uuid('uploaded_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('documents_sha256_unique').on(table.sha256),
    index('documents_status_index').on(table.status),
    index('documents_created_at_index').on(table.createdAt),
    check('documents_status_is_known', oneOf('status', DOCUMENT_STATUSES)),
    check('documents_sha256_is_hex', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('documents_byte_size_positive', sql`${table.byteSize} > 0`),
    check('documents_page_count_positive', sql`${table.pageCount} IS NULL OR ${table.pageCount} > 0`),
  ],
);

export const INGESTION_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

export const INGESTION_STAGES = ['inspect', 'parse', 'assemble', 'chunk', 'embed_index', 'finalize'] as const;
export type IngestionStage = (typeof INGESTION_STAGES)[number];

export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Version of the parsing + chunking pipeline that produced this run. */
    pipelineVersion: text('pipeline_version').notNull(),
    status: text('status').$type<IngestionRunStatus>().notNull().default('queued'),
    stage: text('stage').$type<IngestionStage>().notNull().default('inspect'),
    progressPercent: smallint('progress_percent').notNull().default(0),
    pagesTotal: integer('pages_total'),
    pagesDigital: integer('pages_digital').notNull().default(0),
    pagesScanned: integer('pages_scanned').notNull().default(0),
    pagesHybrid: integer('pages_hybrid').notNull().default(0),
    pagesParsed: integer('pages_parsed').notNull().default(0),
    vlmCallCount: integer('vlm_call_count').notNull().default(0),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('ingestion_runs_document_id_created_at_index').on(table.documentId, table.createdAt),
    check('ingestion_runs_status_is_known', oneOf('status', INGESTION_RUN_STATUSES)),
    check('ingestion_runs_stage_is_known', oneOf('stage', INGESTION_STAGES)),
    check('ingestion_runs_progress_in_range', sql`${table.progressPercent} BETWEEN 0 AND 100`),
  ],
);

export const PAGE_KINDS = ['digital', 'scanned', 'hybrid'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const documentPages = pgTable(
  'document_pages',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** 1-based page number. */
    pageNumber: integer('page_number').notNull(),
    ingestionRunId: uuid('ingestion_run_id')
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: 'cascade' }),
    pageKind: text('page_kind').$type<PageKind>().notNull(),
    widthPoints: real('width_points').notNull(),
    heightPoints: real('height_points').notNull(),
    /** Share of the page area covered by native text spans (0..1). */
    textCoverageRatio: real('text_coverage_ratio'),
    /** OCR quality score (0..1); NULL when the page was not OCR'd. */
    ocrQualityScore: real('ocr_quality_score'),
    parseMethod: text('parse_method').notNull(),
    renderStorageKey: text('render_storage_key'),
  },
  (table) => [
    primaryKey({ name: 'document_pages_pkey', columns: [table.documentId, table.pageNumber] }),
    check('document_pages_page_kind_is_known', oneOf('page_kind', PAGE_KINDS)),
    check('document_pages_page_number_positive', sql`${table.pageNumber} > 0`),
  ],
);

export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'list',
  'table',
  'formula',
  'figure',
  'chart',
  'caption',
  'page_header',
  'page_footer',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Normalised content unit with full provenance, produced by the document-parser. */
export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ingestionRunId: uuid('ingestion_run_id')
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    blockType: text('block_type').$type<BlockType>().notNull(),
    readingOrder: integer('reading_order').notNull(),
    text: text('text'),
    /** Tables as GitHub-flavoured Markdown. */
    markdown: text('markdown'),
    /** Formulas as LaTeX. */
    latex: text('latex'),
    bboxX0: real('bbox_x0').notNull(),
    bboxY0: real('bbox_y0').notNull(),
    bboxX1: real('bbox_x1').notNull(),
    bboxY1: real('bbox_y1').notNull(),
    /** Heading trail from the document root, e.g. {"2 Pricing", "2.1 Plans"}. */
    sectionPath: text('section_path')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 1–6 for headings (from the parser), NULL otherwise. */
    headingLevel: smallint('heading_level'),
    /** `native`, `ocr_tesseract`, or `vlm:<gateway task>`. */
    extractionMethod: text('extraction_method').notNull(),
    confidence: real('confidence'),
    cropStorageKey: text('crop_storage_key'),
    language: text('language'),
  },
  (table) => [
    index('blocks_document_page_order_index').on(table.documentId, table.pageNumber, table.readingOrder),
    index('blocks_ingestion_run_id_index').on(table.ingestionRunId),
    check('blocks_block_type_is_known', oneOf('block_type', BLOCK_TYPES)),
    check(
      'blocks_bbox_is_normalised',
      sql`${table.bboxX0} >= 0 AND ${table.bboxY0} >= 0 AND ${table.bboxX1} <= 1 AND ${table.bboxY1} <= 1 AND ${table.bboxX0} <= ${table.bboxX1} AND ${table.bboxY0} <= ${table.bboxY1}`,
    ),
    check(
      'blocks_confidence_in_range',
      sql`${table.confidence} IS NULL OR ${table.confidence} BETWEEN 0 AND 1`,
    ),
  ],
);

// ----- Search index -----

export const INDEX_VERSION_STATUSES = ['building', 'ready', 'live', 'retired', 'failed'] as const;
export type IndexVersionStatus = (typeof INDEX_VERSION_STATUSES)[number];

/**
 * One set of chunks and vectors built with a specific embedding model, chunker and
 * tokenizer. Exactly one version is `live`; questions are answered from it.
 */
export const indexVersions = pgTable(
  'index_versions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    embeddingModel: text('embedding_model').notNull(),
    embeddingModelRevision: text('embedding_model_revision'),
    embeddingDimension: smallint('embedding_dimension').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    lexicalTokenizerVersion: text('lexical_tokenizer_version').notNull(),
    status: text('status').$type<IndexVersionStatus>().notNull().default('building'),
    createdAt: createdAt(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('index_versions_single_live')
      .on(table.status)
      .where(sql`status = 'live'`),
    check('index_versions_status_is_known', oneOf('status', INDEX_VERSION_STATUSES)),
    check('index_versions_dimension_positive', sql`${table.embeddingDimension} > 0`),
  ],
);

export const CHUNK_KINDS = ['text', 'visual'] as const;
export type ChunkKind = (typeof CHUNK_KINDS)[number];

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    indexVersionId: integer('index_version_id')
      .notNull()
      .references(() => indexVersions.id, { onDelete: 'cascade' }),
    ingestionRunId: uuid('ingestion_run_id')
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: 'cascade' }),
    chunkKind: text('chunk_kind').$type<ChunkKind>().notNull(),
    text: text('text').notNull(),
    /** "Document title › section › subsection", prepended at embedding time. */
    contextualHeader: text('contextual_header').notNull(),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    blockIds: uuid('block_ids').array().notNull(),
    cropStorageKey: text('crop_storage_key'),
    tokenCount: integer('token_count').notNull(),
    /** SHA-256 of the normalised text, used to drop duplicate hits at query time. */
    contentHash: char('content_hash', { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('chunks_document_id_index_version_id_index').on(table.documentId, table.indexVersionId),
    index('chunks_content_hash_index').on(table.contentHash),
    check('chunks_chunk_kind_is_known', oneOf('chunk_kind', CHUNK_KINDS)),
    check('chunks_page_range_valid', sql`${table.pageStart} > 0 AND ${table.pageEnd} >= ${table.pageStart}`),
    check(
      'chunks_visual_has_crop',
      sql`${table.chunkKind} <> 'visual' OR ${table.cropStorageKey} IS NOT NULL`,
    ),
  ],
);

/** A chunk's embedding and search terms; a chunk is searchable once it has a row here. */
export const chunkVectors = pgTable(
  'chunk_vectors',
  {
    chunkId: uuid('chunk_id')
      .primaryKey()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    indexVersionId: integer('index_version_id')
      .notNull()
      .references(() => indexVersions.id, { onDelete: 'cascade' }),
    embedding: vector('embedding').notNull(),
    searchTerms: tsvector('search_terms').notNull(),
  },
  (table) => [
    index('chunk_vectors_index_version_id_index').on(table.indexVersionId),
    index('chunk_vectors_search_terms_index').using('gin', table.searchTerms),
  ],
);

// ----- Chatbot behaviour -----

export const REASONING_EFFORT_SETTINGS = ['off', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffortSetting = (typeof REASONING_EFFORT_SETTINGS)[number];

/**
 * Append-only history of the admin-editable chatbot settings. Saving creates a new
 * version; exactly one version is active, so any change can be rolled back.
 */
export const chatbotSettingsVersions = pgTable(
  'chatbot_settings_versions',
  {
    version: integer('version').primaryKey().generatedAlwaysAsIdentity(),
    botName: text('bot_name').notNull(),
    greetingMessage: text('greeting_message').notNull(),
    suggestedPrompts: text('suggested_prompts')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Admin-written behaviour instruction; non-editable grounding rules are added in code. */
    systemInstruction: text('system_instruction').notNull(),
    /** Sent verbatim when retrieval finds no sufficiently relevant source and answers stay in the documents. */
    fallbackMessage: text('fallback_message').notNull(),
    /** Off: with no relevant source the model still answers, from the conversation and general knowledge. */
    answerOnlyFromDocuments: boolean('answer_only_from_documents').notNull().default(true),
    answerTemperature: real('answer_temperature').notNull().default(0.2),
    maxAnswerTokens: integer('max_answer_tokens').notNull().default(1024),
    maxSources: smallint('max_sources').notNull().default(8),
    /** Dense cosine similarity a passage must reach to be used. */
    minSimilarity: real('min_similarity').notNull().default(0.6),
    /** Streams the model's reasoning to visitors (`/config.features.reasoning`). */
    showReasoning: boolean('show_reasoning').notNull().default(false),
    /** Shows citations and `[n]` markers to visitors (`/config.showSources`); stored either way. */
    showSources: boolean('show_sources').notNull().default(true),
    /** Sent as `reasoning_effort` on `answer_generation`; `off` sends nothing. */
    reasoningEffort: text('reasoning_effort').$type<ReasoningEffortSetting>().notNull().default('off'),
    /** Share of the prompt budget history may use before older turns are summarised. */
    memorySummaryThresholdRatio: real('memory_summary_threshold_ratio').notNull().default(0.6),
    /** Most recent turns always sent verbatim. */
    memoryRecentTurnCount: smallint('memory_recent_turn_count').notNull().default(6),
    /** Longest message a visitor may send, in characters; the chat input enforces it too. */
    maxMessageChars: smallint('max_message_chars').notNull().default(700),
    /** A conversation with this many turns accepts no more; the visitor starts a new one. */
    maxTurnsPerConversation: integer('max_turns_per_conversation').notNull().default(200),
    /** Why the admin saved this version, shown in the version history. */
    note: text('note'),
    isActive: boolean('is_active').notNull().default(false),
    createdByAdminUserId: uuid('created_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('chatbot_settings_versions_single_active')
      .on(table.isActive)
      .where(sql`is_active`),
    check('chatbot_settings_temperature_in_range', sql`${table.answerTemperature} BETWEEN 0 AND 2`),
    check('chatbot_settings_max_sources_in_range', sql`${table.maxSources} BETWEEN 1 AND 20`),
    check('chatbot_settings_min_similarity_in_range', sql`${table.minSimilarity} BETWEEN 0 AND 1`),
    check('chatbot_settings_max_answer_tokens_in_range', sql`${table.maxAnswerTokens} BETWEEN 64 AND 32768`),
    check('chatbot_settings_reasoning_effort_is_known', oneOf('reasoning_effort', REASONING_EFFORT_SETTINGS)),
    check(
      'chatbot_settings_summary_threshold_in_range',
      sql`${table.memorySummaryThresholdRatio} BETWEEN 0.1 AND 0.95`,
    ),
    check('chatbot_settings_recent_turns_in_range', sql`${table.memoryRecentTurnCount} BETWEEN 1 AND 50`),
    check('chatbot_settings_max_message_chars_in_range', sql`${table.maxMessageChars} BETWEEN 50 AND 8000`),
    check('chatbot_settings_max_turns_in_range', sql`${table.maxTurnsPerConversation} BETWEEN 1 AND 10000`),
  ],
);

// ----- Website widgets -----

/**
 * A publishable key for the embeddable chat widget on one website. The key is public (it ships in the page), so
 * it is stored as is; what makes it safe is the allowed-origins list the browser's Origin header is checked
 * against, plus Turnstile and the per-key turn limit.
 */
export const widgetKeys = pgTable(
  'widget_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    publishableKey: text('publishable_key').notNull(),
    /** Exact origins (`https://www.example.com`), normalised to lower case without a trailing slash. */
    allowedOrigins: text('allowed_origins').array().notNull(),
    turnsPerMinute: integer('turns_per_minute').notNull(),
    createdByAdminUserId: uuid('created_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('widget_keys_publishable_key_unique').on(table.publishableKey),
    check('widget_keys_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 120`),
    check('widget_keys_has_origin', sql`cardinality(${table.allowedOrigins}) BETWEEN 1 AND 50`),
    check('widget_keys_turns_per_minute_range', sql`${table.turnsPerMinute} BETWEEN 1 AND 10000`),
  ],
);

// ----- Public chat -----

/** Anonymous website visitor, identified by a bearer token whose hash is stored here. */
export const visitorSessions = pgTable(
  'visitor_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    /** HMAC-SHA256 of the client IP and device fingerprint; raw values are never stored. */
    ipHash: char('ip_hash', { length: 64 }).notNull(),
    fingerprintHash: char('fingerprint_hash', { length: 64 }).notNull(),
    userAgent: text('user_agent'),
    /** Set when the session was started by the website widget; its key must stay active for the session to work. */
    widgetKeyId: uuid('widget_key_id').references(() => widgetKeys.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('visitor_sessions_token_hash_unique').on(table.tokenHash),
    index('visitor_sessions_expires_at_index').on(table.expiresAt),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitorSessionId: uuid('visitor_session_id')
      .notNull()
      .references(() => visitorSessions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** False once the visitor renames it, so the server stops auto-titling. */
    isTitleGenerated: boolean('is_title_generated').notNull().default(true),
    lastMessagePreview: text('last_message_preview'),
    turnCount: integer('turn_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('conversations_visitor_session_updated_at_index').on(table.visitorSessionId, table.updatedAt),
    check('conversations_title_length', sql`char_length(${table.title}) BETWEEN 1 AND 200`),
  ],
);

export const CHAT_TURN_STATUSES = [
  'pending',
  'running',
  'completed',
  'superseded',
  'replaced',
  'cancelled',
  'failed',
] as const;
export type ChatTurnStatus = (typeof CHAT_TURN_STATUSES)[number];

export const TURN_FINISH_REASONS = ['stop', 'length', 'no_evidence', 'cancelled'] as const;
export type TurnFinishReason = (typeof TURN_FINISH_REASONS)[number];

/** One batch of user messages and the single assistant reply generated for it. */
export const chatTurns = pgTable(
  'chat_turns',
  {
    /** Client-generated id; also the Idempotency-Key of the submission. */
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    status: text('status').$type<ChatTurnStatus>().notNull().default('pending'),
    /** SHA-256 of the canonical request body, to detect a reused key with a different body. */
    requestBodyHash: char('request_body_hash', { length: 64 }).notNull(),
    replacesTurnId: uuid('replaces_turn_id'),
    supersededByTurnId: uuid('superseded_by_turn_id'),
    rewrittenQueries: text('rewritten_queries')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    finishReason: text('finish_reason').$type<TurnFinishReason>(),
    failureCode: text('failure_code'),
    chatbotSettingsVersion: integer('chatbot_settings_version'),
    servedByModel: text('served_by_model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    timeToFirstTokenMilliseconds: integer('time_to_first_token_milliseconds'),
    totalMilliseconds: integer('total_milliseconds'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('chat_turns_conversation_created_at_index').on(table.conversationId, table.createdAt),
    uniqueIndex('chat_turns_single_active_per_conversation')
      .on(table.conversationId)
      .where(sql`status IN ('pending', 'running')`),
    index('chat_turns_created_at_index').on(table.createdAt),
    check('chat_turns_status_is_known', oneOf('status', CHAT_TURN_STATUSES)),
    check(
      'chat_turns_finish_reason_is_known',
      sql`finish_reason IS NULL OR ${oneOf('finish_reason', TURN_FINISH_REASONS)}`,
    ),
  ],
);

export const CHAT_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const CHAT_MESSAGE_STATUSES = ['streaming', 'complete', 'stopped', 'error'] as const;
export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[number];

/** Full transcript; prompts may drop old turns, the database never does. */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Global insertion order; history cursors and summaries refer to it. */
    sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => chatTurns.id, { onDelete: 'cascade' }),
    role: text('role').$type<ChatMessageRole>().notNull(),
    clientMessageId: text('client_message_id'),
    content: text('content').notNull(),
    reasoning: text('reasoning'),
    status: text('status').$type<ChatMessageStatus>().notNull().default('complete'),
    /** Estimated prompt tokens of `content`, for memory budgeting. */
    estimatedTokenCount: integer('estimated_token_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('chat_messages_sequence_number_unique').on(table.sequenceNumber),
    index('chat_messages_conversation_sequence_index').on(table.conversationId, table.sequenceNumber),
    index('chat_messages_turn_id_index').on(table.turnId),
    uniqueIndex('chat_messages_client_message_id_unique')
      .on(table.conversationId, table.clientMessageId)
      .where(sql`client_message_id IS NOT NULL`),
    check('chat_messages_role_is_known', oneOf('role', CHAT_MESSAGE_ROLES)),
    check('chat_messages_status_is_known', oneOf('status', CHAT_MESSAGE_STATUSES)),
  ],
);

/** Visitor-uploaded image, re-encoded on upload; unreferenced ones expire. */
export const chatAttachments = pgTable(
  'chat_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitorSessionId: uuid('visitor_session_id')
      .notNull()
      .references(() => visitorSessions.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => chatMessages.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    widthPixels: integer('width_pixels').notNull(),
    heightPixels: integer('height_pixels').notNull(),
    createdAt: createdAt(),
    /** NULL once attached to a message. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('chat_attachments_message_id_index').on(table.messageId),
    index('chat_attachments_expires_at_index').on(table.expiresAt),
  ],
);

/** Source cited by an assistant message; document details are snapshotted for history. */
export const messageCitations = pgTable(
  'message_citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    marker: smallint('marker').notNull(),
    chunkKind: text('chunk_kind').$type<ChunkKind>().notNull(),
    chunkId: uuid('chunk_id').references(() => chunks.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    documentTitle: text('document_title').notNull(),
    pageNumber: integer('page_number').notNull(),
    snippet: text('snippet').notNull(),
    bboxX0: real('bbox_x0'),
    bboxY0: real('bbox_y0'),
    bboxX1: real('bbox_x1'),
    bboxY1: real('bbox_y1'),
    cropStorageKey: text('crop_storage_key'),
    pageRenderStorageKey: text('page_render_storage_key'),
  },
  (table) => [
    uniqueIndex('message_citations_message_marker_unique').on(table.messageId, table.marker),
    index('message_citations_document_id_index').on(table.documentId),
    check('message_citations_chunk_kind_is_known', oneOf('chunk_kind', CHUNK_KINDS)),
  ],
);

export const FEEDBACK_RATINGS = ['up', 'down'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const messageFeedback = pgTable(
  'message_feedback',
  {
    messageId: uuid('message_id')
      .primaryKey()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    rating: text('rating').$type<FeedbackRating>().notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('message_feedback_rating_is_known', oneOf('rating', FEEDBACK_RATINGS)),
    index('message_feedback_created_at_index').on(table.createdAt),
  ],
);

/** Ranked candidates and scores behind a turn, for debugging. */
export const retrievalTraces = pgTable(
  'retrieval_traces',
  {
    turnId: uuid('turn_id')
      .primaryKey()
      .references(() => chatTurns.id, { onDelete: 'cascade' }),
    trace: jsonb('trace').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('retrieval_traces_created_at_index').on(table.createdAt)],
);

/**
 * Rolling summary of a conversation's older messages, extended incrementally. Messages
 * with a sequence number up to `coveredThroughSequenceNumber` are represented by it.
 */
export const conversationSummaries = pgTable('conversation_summaries', {
  conversationId: uuid('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  summaryText: text('summary_text').notNull(),
  coveredThroughSequenceNumber: bigint('covered_through_sequence_number', { mode: 'number' }).notNull(),
  coveredMessageId: uuid('covered_message_id').notNull(),
  estimatedTokenCount: integer('estimated_token_count').notNull(),
  servedByModel: text('served_by_model'),
  updatedAt: updatedAt(),
});

/** Admin-imposed block on a client (by hashed IP or fingerprint). */
export const clientBlocks = pgTable(
  'client_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipHash: char('ip_hash', { length: 64 }),
    fingerprintHash: char('fingerprint_hash', { length: 64 }),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByAdminUserId: uuid('created_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index('client_blocks_ip_hash_index').on(table.ipHash),
    index('client_blocks_fingerprint_hash_index').on(table.fingerprintHash),
    check(
      'client_blocks_has_target',
      sql`${table.ipHash} IS NOT NULL OR ${table.fingerprintHash} IS NOT NULL`,
    ),
  ],
);
