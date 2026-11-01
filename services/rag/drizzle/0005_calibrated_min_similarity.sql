ALTER TABLE "chatbot_settings_versions" ALTER COLUMN "min_similarity" SET DEFAULT 0.6;--> statement-breakpoint
-- The seeded version 1 still carries the uncalibrated default; admin-created versions are left alone.
UPDATE "chatbot_settings_versions" SET "min_similarity" = 0.6 WHERE "version" = 1 AND "created_by_admin_user_id" IS NULL AND "min_similarity" = 0.35::real;
