CREATE TYPE "public"."failed_job_status" AS ENUM('pending', 'retried', 'abandoned', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."deduplication_status" AS ENUM('pending_review', 'auto_merged', 'user_merged', 'user_rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."source_role" AS ENUM('origin', 'update', 'confirmation', 'context', 'supersession');--> statement-breakpoint
CREATE TYPE "public"."timeline_event_type" AS ENUM('created', 'status_changed', 'due_date_changed', 'due_date_confirmed', 'participant_added', 'source_added', 'merged', 'user_verified', 'user_corrected', 'auto_completed');--> statement-breakpoint
CREATE TYPE "public"."unified_object_status" AS ENUM('active', 'merged', 'archived', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."unified_object_type" AS ENUM('commitment', 'decision', 'topic', 'project');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('pending', 'approved', 'rejected', 'converted');--> statement-breakpoint
CREATE TABLE "failed_job" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"task_name" text,
	"trigger_run_id" text,
	"payload" jsonb,
	"error_message" text,
	"error_stack" text,
	"error_code" text,
	"attempt_number" integer NOT NULL,
	"max_attempts" integer,
	"first_attempt_at" timestamp,
	"failed_at" timestamp DEFAULT now() NOT NULL,
	"status" "failed_job_status" DEFAULT 'pending' NOT NULL,
	"retried_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution_note" text,
	"account_id" text,
	"thread_id" text,
	"organization_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deduplication_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_object_id" text NOT NULL,
	"target_object_id" text NOT NULL,
	"semantic_similarity" real NOT NULL,
	"party_match_score" real,
	"temporal_score" real,
	"overall_score" real NOT NULL,
	"match_reasons" text[] DEFAULT '{}',
	"match_explanation" text,
	"status" "deduplication_status" DEFAULT 'pending_review' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution_note" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dc_pair_unique" UNIQUE("source_object_id","target_object_id")
);
--> statement-breakpoint
CREATE TABLE "unified_intelligence_object" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" "unified_object_type" NOT NULL,
	"status" "unified_object_status" DEFAULT 'active' NOT NULL,
	"canonical_title" text NOT NULL,
	"canonical_description" text,
	"due_date" timestamp,
	"due_date_confidence" real,
	"due_date_last_updated_at" timestamp,
	"due_date_last_updated_source_id" text,
	"owner_contact_id" text,
	"participant_contact_ids" text[] DEFAULT '{}',
	"overall_confidence" real DEFAULT 0.5 NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_updated_at" timestamp NOT NULL,
	"last_activity_source_type" "source_type",
	"merged_into_id" text,
	"is_user_verified" boolean DEFAULT false,
	"is_user_dismissed" boolean DEFAULT false,
	"user_corrected_title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unified_object_embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"unified_object_id" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"input_hash" text,
	"status" "embedding_status" DEFAULT 'completed',
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unified_object_embedding_unified_object_id_unique" UNIQUE("unified_object_id")
);
--> statement-breakpoint
CREATE TABLE "unified_object_source" (
	"id" text PRIMARY KEY NOT NULL,
	"unified_object_id" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_account_id" text,
	"role" "source_role" DEFAULT 'context' NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"email_thread_id" text,
	"email_message_id" text,
	"original_commitment_id" text,
	"original_decision_id" text,
	"original_claim_id" text,
	"quoted_text" text,
	"quoted_text_start" text,
	"quoted_text_end" text,
	"extracted_title" text,
	"extracted_due_date" timestamp,
	"extracted_status" text,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"source_timestamp" timestamp,
	"detection_method" text,
	"match_score" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uos_unique_source" UNIQUE("unified_object_id","conversation_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "unified_object_timeline" (
	"id" text PRIMARY KEY NOT NULL,
	"unified_object_id" text NOT NULL,
	"event_type" timeline_event_type NOT NULL,
	"event_description" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"source_type" "source_type",
	"source_id" text,
	"source_name" text,
	"message_id" text,
	"quoted_text" text,
	"triggered_by" text,
	"confidence" real,
	"event_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_code" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"waitlist_application_id" text NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" text,
	"expires_at" timestamp with time zone,
	"last_email_sent_at" timestamp with time zone,
	"email_send_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_code_code_unique" UNIQUE("code"),
	CONSTRAINT "invite_code_waitlist_application_id_unique" UNIQUE("waitlist_application_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist_application" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"role" text,
	"use_case" text,
	"status" "waitlist_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"admin_notes" text,
	"rejection_reason" text,
	"ip_address" text,
	"user_agent" text,
	"referral_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "commitment" ADD COLUMN "unified_object_id" text;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "unified_object_id" text;--> statement-breakpoint
ALTER TABLE "deduplication_candidate" ADD CONSTRAINT "deduplication_candidate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduplication_candidate" ADD CONSTRAINT "deduplication_candidate_source_object_id_unified_intelligence_object_id_fk" FOREIGN KEY ("source_object_id") REFERENCES "public"."unified_intelligence_object"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduplication_candidate" ADD CONSTRAINT "deduplication_candidate_target_object_id_unified_intelligence_object_id_fk" FOREIGN KEY ("target_object_id") REFERENCES "public"."unified_intelligence_object"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_intelligence_object" ADD CONSTRAINT "unified_intelligence_object_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_intelligence_object" ADD CONSTRAINT "unified_intelligence_object_owner_contact_id_contact_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_embedding" ADD CONSTRAINT "unified_object_embedding_unified_object_id_unified_intelligence_object_id_fk" FOREIGN KEY ("unified_object_id") REFERENCES "public"."unified_intelligence_object"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_unified_object_id_unified_intelligence_object_id_fk" FOREIGN KEY ("unified_object_id") REFERENCES "public"."unified_intelligence_object"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_email_thread_id_email_thread_id_fk" FOREIGN KEY ("email_thread_id") REFERENCES "public"."email_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_email_message_id_email_message_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_original_commitment_id_commitment_id_fk" FOREIGN KEY ("original_commitment_id") REFERENCES "public"."commitment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_original_decision_id_decision_id_fk" FOREIGN KEY ("original_decision_id") REFERENCES "public"."decision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_source" ADD CONSTRAINT "unified_object_source_original_claim_id_claim_id_fk" FOREIGN KEY ("original_claim_id") REFERENCES "public"."claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_object_timeline" ADD CONSTRAINT "unified_object_timeline_unified_object_id_unified_intelligence_object_id_fk" FOREIGN KEY ("unified_object_id") REFERENCES "public"."unified_intelligence_object"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_waitlist_application_id_waitlist_application_id_fk" FOREIGN KEY ("waitlist_application_id") REFERENCES "public"."waitlist_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_used_by_user_id_user_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_application" ADD CONSTRAINT "waitlist_application_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "failed_job_task_idx" ON "failed_job" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "failed_job_status_idx" ON "failed_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "failed_job_failed_at_idx" ON "failed_job" USING btree ("failed_at");--> statement-breakpoint
CREATE INDEX "failed_job_account_idx" ON "failed_job" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "failed_job_org_idx" ON "failed_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dc_org_idx" ON "deduplication_candidate" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dc_source_idx" ON "deduplication_candidate" USING btree ("source_object_id");--> statement-breakpoint
CREATE INDEX "dc_target_idx" ON "deduplication_candidate" USING btree ("target_object_id");--> statement-breakpoint
CREATE INDEX "dc_status_idx" ON "deduplication_candidate" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dc_score_idx" ON "deduplication_candidate" USING btree ("overall_score");--> statement-breakpoint
CREATE INDEX "uio_org_idx" ON "unified_intelligence_object" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "uio_type_idx" ON "unified_intelligence_object" USING btree ("type");--> statement-breakpoint
CREATE INDEX "uio_status_idx" ON "unified_intelligence_object" USING btree ("status");--> statement-breakpoint
CREATE INDEX "uio_owner_idx" ON "unified_intelligence_object" USING btree ("owner_contact_id");--> statement-breakpoint
CREATE INDEX "uio_due_date_idx" ON "unified_intelligence_object" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "uio_last_updated_idx" ON "unified_intelligence_object" USING btree ("last_updated_at");--> statement-breakpoint
CREATE INDEX "uio_merged_into_idx" ON "unified_intelligence_object" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "uio_org_type_status_idx" ON "unified_intelligence_object" USING btree ("organization_id","type","status");--> statement-breakpoint
CREATE INDEX "uoe_unified_object_idx" ON "unified_object_embedding" USING btree ("unified_object_id");--> statement-breakpoint
CREATE INDEX "uoe_model_idx" ON "unified_object_embedding" USING btree ("model");--> statement-breakpoint
CREATE INDEX "uoe_status_idx" ON "unified_object_embedding" USING btree ("status");--> statement-breakpoint
CREATE INDEX "uos_unified_object_idx" ON "unified_object_source" USING btree ("unified_object_id");--> statement-breakpoint
CREATE INDEX "uos_source_type_idx" ON "unified_object_source" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "uos_conversation_idx" ON "unified_object_source" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "uos_source_timestamp_idx" ON "unified_object_source" USING btree ("source_timestamp");--> statement-breakpoint
CREATE INDEX "uos_original_commitment_idx" ON "unified_object_source" USING btree ("original_commitment_id");--> statement-breakpoint
CREATE INDEX "uos_original_decision_idx" ON "unified_object_source" USING btree ("original_decision_id");--> statement-breakpoint
CREATE INDEX "uot_unified_object_idx" ON "unified_object_timeline" USING btree ("unified_object_id");--> statement-breakpoint
CREATE INDEX "uot_event_type_idx" ON "unified_object_timeline" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "uot_event_at_idx" ON "unified_object_timeline" USING btree ("event_at");--> statement-breakpoint
CREATE INDEX "uot_source_type_idx" ON "unified_object_timeline" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "uot_object_event_at_idx" ON "unified_object_timeline" USING btree ("unified_object_id","event_at");--> statement-breakpoint
CREATE INDEX "invite_code_code_idx" ON "invite_code" USING btree ("code");--> statement-breakpoint
CREATE INDEX "invite_code_application_idx" ON "invite_code" USING btree ("waitlist_application_id");--> statement-breakpoint
CREATE INDEX "invite_code_expires_idx" ON "invite_code" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "waitlist_status_idx" ON "waitlist_application" USING btree ("status");--> statement-breakpoint
CREATE INDEX "waitlist_created_at_idx" ON "waitlist_application" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "waitlist_email_idx" ON "waitlist_application" USING btree ("email");