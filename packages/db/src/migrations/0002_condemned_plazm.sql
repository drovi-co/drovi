CREATE TYPE "public"."approval_status" AS ENUM('not_required', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."policy_category" AS ENUM('communication', 'data_handling', 'financial', 'compliance', 'security', 'custom');--> statement-breakpoint
CREATE TYPE "public"."policy_severity" AS ENUM('info', 'warning', 'violation', 'critical');--> statement-breakpoint
CREATE TYPE "public"."risk_analysis_status" AS ENUM('pending', 'analyzing', 'completed', 'approved', 'blocked', 'error');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."triage_action" AS ENUM('respond', 'archive', 'delegate', 'schedule', 'wait', 'escalate', 'review');--> statement-breakpoint
CREATE TYPE "public"."triage_priority_tier" AS ENUM('urgent', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."triage_rule_action" AS ENUM('archive', 'label', 'forward', 'priority');--> statement-breakpoint
CREATE TYPE "public"."triage_rule_trigger_condition" AS ENUM('contains', 'equals', 'matches');--> statement-breakpoint
CREATE TYPE "public"."triage_rule_trigger_type" AS ENUM('sender', 'subject', 'content', 'label');--> statement-breakpoint
CREATE TYPE "public"."conversation_type" AS ENUM('thread', 'channel', 'dm', 'group_dm', 'slack_thread', 'event', 'recurring_event', 'page', 'database_item', 'comment_thread', 'document', 'doc_comment_thread', 'meeting', 'recording', 'chat', 'group_chat', 'other');--> statement-breakpoint
CREATE TYPE "public"."priority_tier" AS ENUM('urgent', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('connected', 'disconnected', 'syncing', 'error', 'expired', 'revoked', 'pending');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('email', 'slack', 'calendar', 'whatsapp', 'notion', 'google_docs', 'google_sheets', 'meeting_transcript', 'teams', 'discord', 'linear', 'github');--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"email_digest_enabled" boolean DEFAULT true NOT NULL,
	"email_digest_frequency" text DEFAULT 'daily',
	"commitments_new_enabled" boolean DEFAULT true NOT NULL,
	"commitments_due_enabled" boolean DEFAULT true NOT NULL,
	"commitments_overdue_enabled" boolean DEFAULT true NOT NULL,
	"decisions_new_enabled" boolean DEFAULT true NOT NULL,
	"decisions_superseded_enabled" boolean DEFAULT true NOT NULL,
	"calendar_reminders_enabled" boolean DEFAULT true NOT NULL,
	"email_urgent_enabled" boolean DEFAULT true NOT NULL,
	"email_important_enabled" boolean DEFAULT true NOT NULL,
	"sync_status_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" text DEFAULT '22:00',
	"quiet_hours_end" text DEFAULT '08:00',
	"quiet_hours_timezone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "policy_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "policy_category" NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"severity" "policy_severity" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp,
	"created_by" text,
	"last_modified_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"thread_id" text,
	"message_id" text,
	"analysis_type" text NOT NULL,
	"status" "risk_analysis_status" DEFAULT 'pending' NOT NULL,
	"overall_risk_score" real DEFAULT 0,
	"overall_risk_level" "risk_level",
	"has_contradictions" boolean DEFAULT false,
	"has_sensitive_data" boolean DEFAULT false,
	"has_fraud_signals" boolean DEFAULT false,
	"has_policy_violations" boolean DEFAULT false,
	"contradiction_score" real DEFAULT 0,
	"sensitive_data_score" real DEFAULT 0,
	"fraud_score" real DEFAULT 0,
	"policy_score" real DEFAULT 0,
	"requires_approval" boolean DEFAULT false,
	"approval_status" "approval_status" DEFAULT 'not_required',
	"approval_requested_by" text,
	"approval_requested_at" timestamp,
	"approval_reason" text,
	"approved_by" text,
	"approved_at" timestamp,
	"approval_comments" text,
	"draft_content" text,
	"draft_subject" text,
	"draft_recipients" jsonb,
	"details" jsonb,
	"processing_time_ms" integer,
	"analyzed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_result" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"account_id" text NOT NULL,
	"suggested_action" "triage_action" NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"reasoning" text,
	"priority_tier" "triage_priority_tier" NOT NULL,
	"urgency_score" real DEFAULT 0 NOT NULL,
	"importance_score" real DEFAULT 0 NOT NULL,
	"used_llm" boolean DEFAULT false NOT NULL,
	"delegate_to" text,
	"delegate_reason" text,
	"scheduled_for" timestamp,
	"schedule_reason" text,
	"matched_rule_id" text,
	"user_accepted" boolean,
	"user_feedback" text,
	"user_action_taken" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "triage_result_thread_id_unique" UNIQUE("thread_id")
);
--> statement-breakpoint
CREATE TABLE "triage_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"action" "triage_rule_action" NOT NULL,
	"action_value" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_user_created" boolean DEFAULT true NOT NULL,
	"suggested_by_ai" boolean DEFAULT false NOT NULL,
	"suggestion_confidence" real,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"external_id" text,
	"filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"content_id" text,
	"is_inline" boolean DEFAULT false NOT NULL,
	"storage_key" text,
	"download_url" text,
	"downloaded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"conversation_type" "conversation_type",
	"title" text,
	"snippet" text,
	"participant_ids" text[] DEFAULT '{}',
	"message_count" integer DEFAULT 0 NOT NULL,
	"first_message_at" timestamp,
	"last_message_at" timestamp,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_muted" boolean DEFAULT false NOT NULL,
	"is_trashed" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp,
	"brief_summary" text,
	"intent_classification" text,
	"urgency_score" real,
	"importance_score" real,
	"sentiment_score" real,
	"has_open_loops" boolean DEFAULT false,
	"open_loop_count" integer DEFAULT 0,
	"suggested_action" text,
	"suggested_action_reason" text,
	"priority_tier" "priority_tier",
	"commitment_count" integer DEFAULT 0,
	"decision_count" integer DEFAULT 0,
	"claim_count" integer DEFAULT 0,
	"has_risk_warning" boolean DEFAULT false,
	"risk_level" text,
	"last_analyzed_at" timestamp,
	"analysis_version" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_source_external_unique" UNIQUE("source_account_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_topic" (
	"conversation_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"external_id" text NOT NULL,
	"sender_external_id" text NOT NULL,
	"sender_name" text,
	"sender_email" text,
	"sender_avatar_url" text,
	"recipients" jsonb DEFAULT '[]'::jsonb,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"snippet" text,
	"sent_at" timestamp,
	"received_at" timestamp,
	"edited_at" timestamp,
	"message_index" integer DEFAULT 0 NOT NULL,
	"is_from_user" boolean DEFAULT false NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_conv_external_unique" UNIQUE("conversation_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "participant" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"contact_id" text,
	"external_id" text NOT NULL,
	"display_name" text,
	"email" text,
	"phone" text,
	"avatar_url" text,
	"metadata" jsonb,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "participant_source_external_unique" UNIQUE("source_account_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "source_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"added_by_user_id" text NOT NULL,
	"type" "source_type" NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"api_key" text,
	"webhook_id" text,
	"webhook_secret" text,
	"webhook_url" text,
	"status" "source_status" DEFAULT 'disconnected' NOT NULL,
	"sync_cursor" text,
	"last_sync_at" timestamp,
	"last_sync_status" text,
	"last_sync_error" text,
	"next_sync_at" timestamp,
	"backfill_progress" jsonb DEFAULT '{"phase":"idle","totalItems":0,"processedItems":0,"phaseProgress":0,"overallProgress":0,"errorCount":0}'::jsonb,
	"settings" jsonb DEFAULT '{"syncEnabled":true,"syncFrequencyMinutes":5}'::jsonb,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_account_org_type_external_unique" UNIQUE("organization_id","type","external_id")
);
--> statement-breakpoint
ALTER TABLE "email_account" ALTER COLUMN "settings" SET DEFAULT '{"syncEnabled":true,"syncFrequencyMinutes":5}'::jsonb;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "category" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "priority" text DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "action_required" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "action_type" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ai_settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "email_account" ADD COLUMN "backfill_progress" jsonb DEFAULT '{"phase":"idle","totalThreads":0,"processedThreads":0,"totalMessages":0,"phaseProgress":0,"overallProgress":0,"errorCount":0}'::jsonb;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "source_account_id" text;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "generic_message_id" text;--> statement-breakpoint
ALTER TABLE "commitment" ADD COLUMN "source_account_id" text;--> statement-breakpoint
ALTER TABLE "commitment" ADD COLUMN "source_conversation_id" text;--> statement-breakpoint
ALTER TABLE "commitment" ADD COLUMN "source_generic_message_id" text;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "source_account_id" text;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "source_conversation_id" text;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "source_generic_message_ids" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule" ADD CONSTRAINT "policy_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis" ADD CONSTRAINT "risk_analysis_account_id_email_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis" ADD CONSTRAINT "risk_analysis_thread_id_email_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis" ADD CONSTRAINT "risk_analysis_message_id_email_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_result" ADD CONSTRAINT "triage_result_thread_id_email_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_result" ADD CONSTRAINT "triage_result_account_id_email_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rule" ADD CONSTRAINT "triage_rule_account_id_email_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_topic" ADD CONSTRAINT "conversation_topic_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_account" ADD CONSTRAINT "source_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_account" ADD CONSTRAINT "source_account_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_preferences_userId_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "policy_rule_org_idx" ON "policy_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "policy_rule_category_idx" ON "policy_rule" USING btree ("category");--> statement-breakpoint
CREATE INDEX "policy_rule_severity_idx" ON "policy_rule" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "policy_rule_enabled_idx" ON "policy_rule" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "risk_analysis_account_idx" ON "risk_analysis" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "risk_analysis_thread_idx" ON "risk_analysis" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "risk_analysis_message_idx" ON "risk_analysis" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "risk_analysis_status_idx" ON "risk_analysis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "risk_analysis_risk_level_idx" ON "risk_analysis" USING btree ("overall_risk_level");--> statement-breakpoint
CREATE INDEX "risk_analysis_approval_idx" ON "risk_analysis" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "risk_analysis_created_idx" ON "risk_analysis" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "triage_result_thread_idx" ON "triage_result" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "triage_result_account_idx" ON "triage_result" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "triage_result_action_idx" ON "triage_result" USING btree ("suggested_action");--> statement-breakpoint
CREATE INDEX "triage_result_priority_idx" ON "triage_result" USING btree ("priority_tier");--> statement-breakpoint
CREATE INDEX "triage_result_created_idx" ON "triage_result" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "triage_rule_account_idx" ON "triage_rule" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "triage_rule_enabled_idx" ON "triage_rule" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "triage_rule_priority_idx" ON "triage_rule" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "attachment_message_idx" ON "attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "attachment_mime_idx" ON "attachment" USING btree ("mime_type");--> statement-breakpoint
CREATE INDEX "conversation_source_idx" ON "conversation" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "conversation_last_message_idx" ON "conversation" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_urgency_idx" ON "conversation" USING btree ("urgency_score");--> statement-breakpoint
CREATE INDEX "conversation_priority_idx" ON "conversation" USING btree ("priority_tier");--> statement-breakpoint
CREATE INDEX "conversation_open_loops_idx" ON "conversation" USING btree ("has_open_loops");--> statement-breakpoint
CREATE INDEX "conversation_is_read_idx" ON "conversation" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "conversation_is_archived_idx" ON "conversation" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "conversation_type_idx" ON "conversation" USING btree ("conversation_type");--> statement-breakpoint
CREATE INDEX "conversation_topic_conv_idx" ON "conversation_topic" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_topic_topic_idx" ON "conversation_topic" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_sender_idx" ON "message" USING btree ("sender_external_id");--> statement-breakpoint
CREATE INDEX "message_sent_idx" ON "message" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "message_received_idx" ON "message" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "participant_source_idx" ON "participant" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "participant_contact_idx" ON "participant" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "participant_email_idx" ON "participant" USING btree ("email");--> statement-breakpoint
CREATE INDEX "participant_resolved_idx" ON "participant" USING btree ("is_resolved");--> statement-breakpoint
CREATE INDEX "source_account_org_idx" ON "source_account" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "source_account_type_idx" ON "source_account" USING btree ("type");--> statement-breakpoint
CREATE INDEX "source_account_status_idx" ON "source_account" USING btree ("status");--> statement-breakpoint
CREATE INDEX "source_account_added_by_idx" ON "source_account" USING btree ("added_by_user_id");--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_generic_message_id_message_id_fk" FOREIGN KEY ("generic_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_source_conversation_id_conversation_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_source_generic_message_id_message_id_fk" FOREIGN KEY ("source_generic_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_source_conversation_id_conversation_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_userId_category_idx" ON "notification" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "notification_groupKey_idx" ON "notification" USING btree ("group_key");--> statement-breakpoint
CREATE INDEX "claim_source_account_idx" ON "claim" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "claim_conversation_idx" ON "claim" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "claim_generic_message_idx" ON "claim" USING btree ("generic_message_id");--> statement-breakpoint
CREATE INDEX "commitment_source_account_idx" ON "commitment" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "commitment_source_conversation_idx" ON "commitment" USING btree ("source_conversation_id");--> statement-breakpoint
CREATE INDEX "decision_source_account_idx" ON "decision" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "decision_source_conversation_idx" ON "decision" USING btree ("source_conversation_id");