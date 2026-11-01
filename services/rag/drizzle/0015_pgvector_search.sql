CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
-- The vectors lived outside Postgres until now; chunks are rebuilt from stored blocks by building each index version again.
DELETE FROM "chunks";--> statement-breakpoint
CREATE TABLE "chunk_vectors" (
	"chunk_id" uuid PRIMARY KEY NOT NULL,
	"index_version_id" integer NOT NULL,
	"embedding" vector NOT NULL,
	"search_terms" "tsvector" NOT NULL
);
--> statement-breakpoint
DROP INDEX "index_versions_qdrant_collection_unique";--> statement-breakpoint
ALTER TABLE "chunk_vectors" ADD CONSTRAINT "chunk_vectors_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_vectors" ADD CONSTRAINT "chunk_vectors_index_version_id_index_versions_id_fk" FOREIGN KEY ("index_version_id") REFERENCES "public"."index_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_vectors_index_version_id_index" ON "chunk_vectors" USING btree ("index_version_id");--> statement-breakpoint
CREATE INDEX "chunk_vectors_search_terms_index" ON "chunk_vectors" USING gin ("search_terms");--> statement-breakpoint
ALTER TABLE "index_versions" DROP COLUMN "bm25_average_document_length";--> statement-breakpoint
ALTER TABLE "index_versions" DROP COLUMN "qdrant_collection";