ALTER TABLE "audit_events" ADD COLUMN "actor_username" text;--> statement-breakpoint
-- Earlier events by signed-in admins get the admin's current username.
UPDATE "audit_events" SET "actor_username" = "admin_users"."username"
FROM "admin_users" WHERE "admin_users"."id" = "audit_events"."actor_admin_user_id";
