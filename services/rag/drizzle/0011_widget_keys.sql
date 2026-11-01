CREATE TABLE "widget_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"publishable_key" text NOT NULL,
	"allowed_origins" text[] NOT NULL,
	"turns_per_minute" integer NOT NULL,
	"created_by_admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "widget_keys_name_length" CHECK (char_length("widget_keys"."name") BETWEEN 1 AND 120),
	CONSTRAINT "widget_keys_has_origin" CHECK (cardinality("widget_keys"."allowed_origins") BETWEEN 1 AND 50),
	CONSTRAINT "widget_keys_turns_per_minute_range" CHECK ("widget_keys"."turns_per_minute" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD COLUMN "widget_key_id" uuid;--> statement-breakpoint
ALTER TABLE "widget_keys" ADD CONSTRAINT "widget_keys_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "widget_keys_publishable_key_unique" ON "widget_keys" USING btree ("publishable_key");--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_widget_key_id_widget_keys_id_fk" FOREIGN KEY ("widget_key_id") REFERENCES "public"."widget_keys"("id") ON DELETE set null ON UPDATE no action;