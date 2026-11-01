CREATE TABLE "eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"language" text NOT NULL,
	"is_answerable" boolean DEFAULT true NOT NULL,
	"expected_document_id" uuid,
	"expected_pages" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"reference_answer" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_cases_pages_need_document" CHECK (cardinality("eval_cases"."expected_pages") = 0 OR "eval_cases"."expected_document_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"eval_run_id" uuid NOT NULL,
	"eval_case_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"evidence_rank" integer,
	"best_dense_similarity" real,
	"retrieved_sources" jsonb NOT NULL,
	"answer" text,
	"cited_source_numbers" integer[],
	"judgement" jsonb,
	"retrieval_milliseconds" integer,
	"generation_milliseconds" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_results_eval_run_id_eval_case_id_pk" PRIMARY KEY("eval_run_id","eval_case_id")
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"includes_answers" boolean NOT NULL,
	"tag" text,
	"index_version_id" integer,
	"chatbot_settings_version" integer,
	"case_count" integer DEFAULT 0 NOT NULL,
	"completed_case_count" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"failure_message" text,
	"created_by_admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "eval_runs_status_is_known" CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_expected_document_id_documents_id_fk" FOREIGN KEY ("expected_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_eval_case_id_eval_cases_id_fk" FOREIGN KEY ("eval_case_id") REFERENCES "public"."eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_index_version_id_index_versions_id_fk" FOREIGN KEY ("index_version_id") REFERENCES "public"."index_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_is_active_index" ON "eval_cases" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "eval_runs_created_at_index" ON "eval_runs" USING btree ("created_at");