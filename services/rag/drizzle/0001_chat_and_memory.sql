CREATE TABLE "chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_session_id" uuid NOT NULL,
	"message_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width_pixels" integer NOT NULL,
	"height_pixels" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_sequence_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"role" text NOT NULL,
	"client_message_id" text,
	"content" text NOT NULL,
	"reasoning" text,
	"status" text DEFAULT 'complete' NOT NULL,
	"estimated_token_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_is_known" CHECK (role IN ('user', 'assistant')),
	CONSTRAINT "chat_messages_status_is_known" CHECK (status IN ('streaming', 'complete', 'stopped', 'error'))
);
--> statement-breakpoint
CREATE TABLE "chat_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_body_hash" char(64) NOT NULL,
	"replaces_turn_id" uuid,
	"superseded_by_turn_id" uuid,
	"rewritten_queries" text[] DEFAULT '{}'::text[] NOT NULL,
	"finish_reason" text,
	"failure_code" text,
	"chatbot_settings_version" integer,
	"served_by_model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"time_to_first_token_milliseconds" integer,
	"total_milliseconds" integer,
	"trace_id" char(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "chat_turns_status_is_known" CHECK (status IN ('pending', 'running', 'completed', 'superseded', 'replaced', 'cancelled', 'failed')),
	CONSTRAINT "chat_turns_finish_reason_is_known" CHECK (finish_reason IS NULL OR finish_reason IN ('stop', 'length', 'no_evidence', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "client_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" char(64),
	"fingerprint_hash" char(64),
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_blocks_has_target" CHECK ("client_blocks"."ip_hash" IS NOT NULL OR "client_blocks"."fingerprint_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"summary_text" text NOT NULL,
	"covered_through_sequence_number" bigint NOT NULL,
	"covered_message_id" uuid NOT NULL,
	"estimated_token_count" integer NOT NULL,
	"served_by_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_session_id" uuid NOT NULL,
	"title" text NOT NULL,
	"is_title_generated" boolean DEFAULT true NOT NULL,
	"last_message_preview" text,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_title_length" CHECK (char_length("conversations"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "message_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"marker" smallint NOT NULL,
	"chunk_kind" text NOT NULL,
	"chunk_id" uuid,
	"document_id" uuid,
	"document_title" text NOT NULL,
	"page_number" integer NOT NULL,
	"snippet" text NOT NULL,
	"bbox_x0" real,
	"bbox_y0" real,
	"bbox_x1" real,
	"bbox_y1" real,
	"crop_storage_key" text,
	"page_render_storage_key" text,
	CONSTRAINT "message_citations_chunk_kind_is_known" CHECK (chunk_kind IN ('text', 'visual'))
);
--> statement-breakpoint
CREATE TABLE "message_feedback" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_feedback_rating_is_known" CHECK (rating IN ('up', 'down'))
);
--> statement-breakpoint
CREATE TABLE "retrieval_traces" (
	"turn_id" uuid PRIMARY KEY NOT NULL,
	"trace" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"ip_hash" char(64) NOT NULL,
	"fingerprint_hash" char(64) NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "suggested_prompts" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "max_answer_tokens" integer DEFAULT 1024 NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "show_reasoning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "reasoning_effort" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "memory_summary_threshold_ratio" real DEFAULT 0.6 NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "memory_recent_turn_count" smallint DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "max_turns_per_conversation" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "pages_parsed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_visitor_session_id_visitor_sessions_id_fk" FOREIGN KEY ("visitor_session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_turn_id_chat_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."chat_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_blocks" ADD CONSTRAINT "client_blocks_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_visitor_session_id_visitor_sessions_id_fk" FOREIGN KEY ("visitor_session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_traces" ADD CONSTRAINT "retrieval_traces_turn_id_chat_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."chat_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_attachments_message_id_index" ON "chat_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_attachments_expires_at_index" ON "chat_attachments" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_sequence_number_unique" ON "chat_messages" USING btree ("sequence_number");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_sequence_index" ON "chat_messages" USING btree ("conversation_id","sequence_number");--> statement-breakpoint
CREATE INDEX "chat_messages_turn_id_index" ON "chat_messages" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_client_message_id_unique" ON "chat_messages" USING btree ("conversation_id","client_message_id") WHERE client_message_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_turns_conversation_created_at_index" ON "chat_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turns_single_active_per_conversation" ON "chat_turns" USING btree ("conversation_id") WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "chat_turns_created_at_index" ON "chat_turns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "client_blocks_ip_hash_index" ON "client_blocks" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "client_blocks_fingerprint_hash_index" ON "client_blocks" USING btree ("fingerprint_hash");--> statement-breakpoint
CREATE INDEX "conversations_visitor_session_updated_at_index" ON "conversations" USING btree ("visitor_session_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_citations_message_marker_unique" ON "message_citations" USING btree ("message_id","marker");--> statement-breakpoint
CREATE INDEX "message_citations_document_id_index" ON "message_citations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "message_feedback_created_at_index" ON "message_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "retrieval_traces_created_at_index" ON "retrieval_traces" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_sessions_token_hash_unique" ON "visitor_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "visitor_sessions_expires_at_index" ON "visitor_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD CONSTRAINT "chatbot_settings_max_answer_tokens_in_range" CHECK ("chatbot_settings_versions"."max_answer_tokens" BETWEEN 64 AND 32768);--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD CONSTRAINT "chatbot_settings_reasoning_effort_is_known" CHECK (reasoning_effort IN ('off', 'minimal', 'low', 'medium', 'high'));--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD CONSTRAINT "chatbot_settings_summary_threshold_in_range" CHECK ("chatbot_settings_versions"."memory_summary_threshold_ratio" BETWEEN 0.1 AND 0.95);--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD CONSTRAINT "chatbot_settings_recent_turns_in_range" CHECK ("chatbot_settings_versions"."memory_recent_turn_count" BETWEEN 1 AND 50);--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD CONSTRAINT "chatbot_settings_max_turns_in_range" CHECK ("chatbot_settings_versions"."max_turns_per_conversation" BETWEEN 1 AND 10000);