ALTER TABLE "chatbot_settings_versions" DROP CONSTRAINT "chatbot_settings_threshold_in_range";--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "heading_level" smallint;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD COLUMN "min_similarity" real DEFAULT 0.35 NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_settings_versions" ADD CONSTRAINT "chatbot_settings_min_similarity_in_range" CHECK ("chatbot_settings_versions"."min_similarity" BETWEEN 0 AND 1);