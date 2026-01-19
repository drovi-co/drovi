-- Multi-source conversation and message embedding tables
-- Enables semantic search across WhatsApp, Slack, Calendar, and other non-email sources

-- Conversation embedding table (aggregated embeddings for conversations)
CREATE TABLE "conversation_embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"aggregation_method" "thread_embedding_aggregation" DEFAULT 'mean' NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"message_count" integer NOT NULL,
	"total_tokens" integer,
	"input_hash" text,
	"status" "embedding_status" DEFAULT 'completed',
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_embedding_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_embedding" ADD CONSTRAINT "conversation_embedding_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "conversation_embedding_conv_idx" ON "conversation_embedding" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX "conversation_embedding_model_idx" ON "conversation_embedding" USING btree ("model");
--> statement-breakpoint
CREATE INDEX "conversation_embedding_status_idx" ON "conversation_embedding" USING btree ("status");
--> statement-breakpoint

-- Generic message embedding table (individual message embeddings for multi-source messages)
CREATE TABLE "generic_message_embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"token_count" integer,
	"input_hash" text,
	"status" "embedding_status" DEFAULT 'completed',
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "generic_message_embedding_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "generic_message_embedding" ADD CONSTRAINT "generic_message_embedding_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "generic_message_embedding_msg_idx" ON "generic_message_embedding" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "generic_message_embedding_model_idx" ON "generic_message_embedding" USING btree ("model");
--> statement-breakpoint
CREATE INDEX "generic_message_embedding_status_idx" ON "generic_message_embedding" USING btree ("status");
--> statement-breakpoint

-- HNSW vector indexes for fast semantic search
CREATE INDEX IF NOT EXISTS conversation_embedding_vector_idx
ON conversation_embedding
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS generic_message_embedding_vector_idx
ON generic_message_embedding
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
