CREATE TABLE "admin_sessions" (
	"token_hash" char(64) PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"ip_hash" char(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_length" CHECK (char_length("admin_users"."username") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_admin_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"trace_id" char(32)
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"block_type" text NOT NULL,
	"reading_order" integer NOT NULL,
	"text" text,
	"markdown" text,
	"latex" text,
	"bbox_x0" real NOT NULL,
	"bbox_y0" real NOT NULL,
	"bbox_x1" real NOT NULL,
	"bbox_y1" real NOT NULL,
	"section_path" text[] DEFAULT '{}'::text[] NOT NULL,
	"extraction_method" text NOT NULL,
	"confidence" real,
	"crop_storage_key" text,
	"language" text,
	CONSTRAINT "blocks_block_type_is_known" CHECK (block_type IN ('heading', 'paragraph', 'list', 'table', 'formula', 'figure', 'chart', 'caption', 'page_header', 'page_footer')),
	CONSTRAINT "blocks_bbox_is_normalised" CHECK ("blocks"."bbox_x0" >= 0 AND "blocks"."bbox_y0" >= 0 AND "blocks"."bbox_x1" <= 1 AND "blocks"."bbox_y1" <= 1 AND "blocks"."bbox_x0" <= "blocks"."bbox_x1" AND "blocks"."bbox_y0" <= "blocks"."bbox_y1"),
	CONSTRAINT "blocks_confidence_in_range" CHECK ("blocks"."confidence" IS NULL OR "blocks"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "chatbot_settings_versions" (
	"version" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chatbot_settings_versions_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bot_name" text NOT NULL,
	"greeting_message" text NOT NULL,
	"system_instruction" text NOT NULL,
	"fallback_message" text NOT NULL,
	"answer_temperature" real DEFAULT 0.2 NOT NULL,
	"max_sources" smallint DEFAULT 8 NOT NULL,
	"rerank_score_threshold" real DEFAULT 0.2 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by_admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatbot_settings_temperature_in_range" CHECK ("chatbot_settings_versions"."answer_temperature" BETWEEN 0 AND 2),
	CONSTRAINT "chatbot_settings_max_sources_in_range" CHECK ("chatbot_settings_versions"."max_sources" BETWEEN 1 AND 20),
	CONSTRAINT "chatbot_settings_threshold_in_range" CHECK ("chatbot_settings_versions"."rerank_score_threshold" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"index_version_id" integer NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"chunk_kind" text NOT NULL,
	"text" text NOT NULL,
	"contextual_header" text NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"block_ids" uuid[] NOT NULL,
	"crop_storage_key" text,
	"token_count" integer NOT NULL,
	"content_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_chunk_kind_is_known" CHECK (chunk_kind IN ('text', 'visual')),
	CONSTRAINT "chunks_page_range_valid" CHECK ("chunks"."page_start" > 0 AND "chunks"."page_end" >= "chunks"."page_start"),
	CONSTRAINT "chunks_visual_has_crop" CHECK ("chunks"."chunk_kind" <> 'visual' OR "chunks"."crop_storage_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"page_kind" text NOT NULL,
	"width_points" real NOT NULL,
	"height_points" real NOT NULL,
	"text_coverage_ratio" real,
	"ocr_quality_score" real,
	"parse_method" text NOT NULL,
	"render_storage_key" text,
	CONSTRAINT "document_pages_pkey" PRIMARY KEY("document_id","page_number"),
	CONSTRAINT "document_pages_page_kind_is_known" CHECK (page_kind IN ('digital', 'scanned', 'hybrid')),
	CONSTRAINT "document_pages_page_number_positive" CHECK ("document_pages"."page_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" char(64) NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"page_count" integer,
	"title" text,
	"detected_language" text,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"uploaded_by_admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_status_is_known" CHECK (status IN ('uploaded', 'inspecting', 'parsing', 'chunking', 'indexing', 'ready', 'failed', 'deleting')),
	CONSTRAINT "documents_sha256_is_hex" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_byte_size_positive" CHECK ("documents"."byte_size" > 0),
	CONSTRAINT "documents_page_count_positive" CHECK ("documents"."page_count" IS NULL OR "documents"."page_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "index_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "index_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"embedding_model" text NOT NULL,
	"embedding_model_revision" text,
	"embedding_dimension" smallint NOT NULL,
	"chunker_version" text NOT NULL,
	"lexical_tokenizer_version" text NOT NULL,
	"bm25_average_document_length" real,
	"qdrant_collection" text NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	CONSTRAINT "index_versions_status_is_known" CHECK (status IN ('building', 'live', 'retired', 'failed')),
	CONSTRAINT "index_versions_dimension_positive" CHECK ("index_versions"."embedding_dimension" > 0)
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"pipeline_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'inspect' NOT NULL,
	"progress_percent" smallint DEFAULT 0 NOT NULL,
	"pages_total" integer,
	"pages_digital" integer DEFAULT 0 NOT NULL,
	"pages_scanned" integer DEFAULT 0 NOT NULL,
	"pages_hybrid" integer DEFAULT 0 NOT NULL,
	"vlm_call_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"trace_id" char(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ingestion_runs_status_is_known" CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ingestion_runs_stage_is_known" CHECK (stage IN ('inspect', 'parse', 'assemble', 'chunk', 'embed_index', 'finalize')),
	CONSTRAINT "ingestion_runs_progress_in_range" CHECK ("ingestion_runs"."progress_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_admin_user_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD CONSTRAINT "chatbot_settings_versions_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_index_version_id_index_versions_id_fk" FOREIGN KEY ("index_version_id") REFERENCES "public"."index_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("uploaded_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_id_index" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_at_index" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_username_lower_unique" ON "admin_users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_index" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_index" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "blocks_document_page_order_index" ON "blocks" USING btree ("document_id","page_number","reading_order");--> statement-breakpoint
CREATE INDEX "blocks_ingestion_run_id_index" ON "blocks" USING btree ("ingestion_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chatbot_settings_versions_single_active" ON "chatbot_settings_versions" USING btree ("is_active") WHERE is_active;--> statement-breakpoint
CREATE INDEX "chunks_document_id_index_version_id_index" ON "chunks" USING btree ("document_id","index_version_id");--> statement-breakpoint
CREATE INDEX "chunks_content_hash_index" ON "chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_sha256_unique" ON "documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "documents_status_index" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_created_at_index" ON "documents" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "index_versions_qdrant_collection_unique" ON "index_versions" USING btree ("qdrant_collection");--> statement-breakpoint
CREATE UNIQUE INDEX "index_versions_single_live" ON "index_versions" USING btree ("status") WHERE status = 'live';--> statement-breakpoint
CREATE INDEX "ingestion_runs_document_id_created_at_index" ON "ingestion_runs" USING btree ("document_id","created_at");