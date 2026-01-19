CREATE TYPE "public"."task_priority" AS ENUM('no_priority', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_source_type" AS ENUM('conversation', 'commitment', 'decision', 'manual');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "google_docs_comment_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"google_comment_id" text NOT NULL,
	"google_document_id" text NOT NULL,
	"content" text,
	"anchor" text,
	"quoted_content" text,
	"author_email" text,
	"author_name" text,
	"author_photo_url" text,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"google_created_at" timestamp,
	"google_modified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_docs_comment_unique" UNIQUE("document_id","google_comment_id")
);
--> statement-breakpoint
CREATE TABLE "google_docs_document" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"google_document_id" text NOT NULL,
	"title" text,
	"mime_type" text DEFAULT 'application/vnd.google-apps.document',
	"description" text,
	"parent_folder_id" text,
	"web_view_link" text,
	"icon_link" text,
	"thumbnail_link" text,
	"is_starred" boolean DEFAULT false NOT NULL,
	"is_trashed" boolean DEFAULT false NOT NULL,
	"file_size" integer,
	"owner_email" text,
	"owner_name" text,
	"last_modified_by_email" text,
	"last_modified_by_name" text,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_comment" boolean DEFAULT false NOT NULL,
	"can_share" boolean DEFAULT false NOT NULL,
	"can_download" boolean DEFAULT false NOT NULL,
	"google_created_at" timestamp,
	"google_modified_at" timestamp,
	"last_content_sync_at" timestamp,
	"last_comment_sync_at" timestamp,
	"content_hash" text,
	"revision_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_docs_document_source_google_unique" UNIQUE("source_account_id","google_document_id")
);
--> statement-breakpoint
CREATE TABLE "google_docs_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"google_folder_id" text NOT NULL,
	"name" text,
	"mime_type" text DEFAULT 'application/vnd.google-apps.folder',
	"parent_folder_id" text,
	"web_view_link" text,
	"is_starred" boolean DEFAULT false NOT NULL,
	"is_trashed" boolean DEFAULT false NOT NULL,
	"is_root" boolean DEFAULT false NOT NULL,
	"owner_email" text,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_docs_folder_source_google_unique" UNIQUE("source_account_id","google_folder_id")
);
--> statement-breakpoint
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
CREATE TABLE "slack_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"name" text,
	"topic" text,
	"purpose" text,
	"is_channel" boolean DEFAULT true NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"is_im" boolean DEFAULT false NOT NULL,
	"is_mpim" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_general" boolean DEFAULT false NOT NULL,
	"is_member" boolean DEFAULT false NOT NULL,
	"member_count" integer,
	"creator_user_id" text,
	"slack_created_at" timestamp,
	"slack_updated_at" timestamp,
	"last_message_ts" text,
	"last_sync_at" timestamp,
	"unread_count" integer,
	"custom_priority" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_channel_source_slack_unique" UNIQUE("source_account_id","slack_channel_id")
);
--> statement-breakpoint
CREATE TABLE "slack_team" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"email_domain" text,
	"icon_url" text,
	"enterprise_id" text,
	"enterprise_name" text,
	"is_enterprise_install" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_team_source_slack_unique" UNIQUE("source_account_id","slack_team_id")
);
--> statement-breakpoint
CREATE TABLE "slack_user_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"name" text,
	"real_name" text,
	"display_name" text,
	"email" text,
	"image_url" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"is_ultra_restricted" boolean DEFAULT false NOT NULL,
	"timezone" text,
	"timezone_label" text,
	"timezone_offset" integer,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_user_cache_source_slack_unique" UNIQUE("source_account_id","slack_user_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_business_account" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone_id" text,
	"message_template_namespace" text,
	"account_review_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_waba_source_waba_unique" UNIQUE("source_account_id","waba_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_contact_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"wa_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"profile_name" text,
	"push_name" text,
	"profile_picture_url" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_contact_source_wa_unique" UNIQUE("source_account_id","wa_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_message_meta" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"wam_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"from_wa_id" text NOT NULL,
	"to_wa_id" text,
	"message_type" text NOT NULL,
	"status" text,
	"status_timestamp" timestamp,
	"media_id" text,
	"media_mime_type" text,
	"media_sha256" text,
	"media_url" text,
	"context_message_id" text,
	"is_forwarded" boolean DEFAULT false,
	"forwarding_score" integer,
	"reactions" jsonb,
	"error_code" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_msg_source_wam_unique" UNIQUE("source_account_id","wam_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_phone_number" (
	"id" text PRIMARY KEY NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text NOT NULL,
	"verified_name" text,
	"code_verification_status" text,
	"quality_rating" text,
	"messaging_limit" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_phone_waba_number_unique" UNIQUE("waba_id","phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_template" (
	"id" text PRIMARY KEY NOT NULL,
	"waba_id" text NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"components" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_template_waba_name_lang_unique" UNIQUE("waba_id","name","language")
);
--> statement-breakpoint
CREATE TABLE "notion_database" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"notion_database_id" text NOT NULL,
	"notion_workspace_id" text NOT NULL,
	"parent_type" text,
	"parent_id" text,
	"title" text,
	"description" text,
	"icon" text,
	"cover_url" text,
	"url" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_in_trash" boolean DEFAULT false NOT NULL,
	"is_inline" boolean DEFAULT false NOT NULL,
	"properties" jsonb,
	"notion_created_at" timestamp,
	"notion_updated_at" timestamp,
	"last_sync_at" timestamp,
	"item_count" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notion_database_source_notion_unique" UNIQUE("source_account_id","notion_database_id")
);
--> statement-breakpoint
CREATE TABLE "notion_page_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"notion_page_id" text NOT NULL,
	"notion_workspace_id" text NOT NULL,
	"parent_type" text,
	"parent_id" text,
	"title" text,
	"icon" text,
	"cover_url" text,
	"url" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_in_trash" boolean DEFAULT false NOT NULL,
	"is_database" boolean DEFAULT false NOT NULL,
	"notion_created_at" timestamp,
	"notion_updated_at" timestamp,
	"created_by_user_id" text,
	"last_edited_by_user_id" text,
	"last_content_sync_at" timestamp,
	"content_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notion_page_cache_source_notion_unique" UNIQUE("source_account_id","notion_page_id")
);
--> statement-breakpoint
CREATE TABLE "notion_user_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"notion_user_id" text NOT NULL,
	"type" text,
	"name" text,
	"avatar_url" text,
	"email" text,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notion_user_cache_source_notion_unique" UNIQUE("source_account_id","notion_user_id")
);
--> statement-breakpoint
CREATE TABLE "notion_workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"source_account_id" text NOT NULL,
	"notion_workspace_id" text NOT NULL,
	"notion_bot_id" text,
	"name" text,
	"icon" text,
	"owner_type" text,
	"owner_id" text,
	"owner_email" text,
	"last_sync_at" timestamp,
	"last_sync_cursor" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notion_workspace_source_notion_unique" UNIQUE("source_account_id","notion_workspace_id")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"priority" "task_priority" DEFAULT 'no_priority' NOT NULL,
	"assignee_id" text,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"source_type" "task_source_type" NOT NULL,
	"source_conversation_id" text,
	"source_commitment_id" text,
	"source_decision_id" text,
	"created_by_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_conversation_unique" UNIQUE("source_conversation_id"),
	CONSTRAINT "task_commitment_unique" UNIQUE("source_commitment_id"),
	CONSTRAINT "task_decision_unique" UNIQUE("source_decision_id")
);
--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"activity_type" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_label" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6B7280' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_label_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "task_label_junction" (
	"task_id" text NOT NULL,
	"label_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_label_junction_task_id_label_id_pk" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "google_docs_comment_cache" ADD CONSTRAINT "google_docs_comment_cache_document_id_google_docs_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."google_docs_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_docs_document" ADD CONSTRAINT "google_docs_document_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_docs_folder" ADD CONSTRAINT "google_docs_folder_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_embedding" ADD CONSTRAINT "conversation_embedding_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generic_message_embedding" ADD CONSTRAINT "generic_message_embedding_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel" ADD CONSTRAINT "slack_channel_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_team" ADD CONSTRAINT "slack_team_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_cache" ADD CONSTRAINT "slack_user_cache_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_business_account" ADD CONSTRAINT "whatsapp_business_account_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_contact_cache" ADD CONSTRAINT "whatsapp_contact_cache_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message_meta" ADD CONSTRAINT "whatsapp_message_meta_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_number" ADD CONSTRAINT "whatsapp_phone_number_waba_id_whatsapp_business_account_id_fk" FOREIGN KEY ("waba_id") REFERENCES "public"."whatsapp_business_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_waba_id_whatsapp_business_account_id_fk" FOREIGN KEY ("waba_id") REFERENCES "public"."whatsapp_business_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_database" ADD CONSTRAINT "notion_database_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_page_cache" ADD CONSTRAINT "notion_page_cache_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_user_cache" ADD CONSTRAINT "notion_user_cache_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_workspace" ADD CONSTRAINT "notion_workspace_source_account_id_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_conversation_id_conversation_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_commitment_id_commitment_id_fk" FOREIGN KEY ("source_commitment_id") REFERENCES "public"."commitment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_decision_id_decision_id_fk" FOREIGN KEY ("source_decision_id") REFERENCES "public"."decision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_junction" ADD CONSTRAINT "task_label_junction_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_junction" ADD CONSTRAINT "task_label_junction_label_id_task_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."task_label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_docs_comment_document_idx" ON "google_docs_comment_cache" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "google_docs_comment_google_doc_idx" ON "google_docs_comment_cache" USING btree ("google_document_id");--> statement-breakpoint
CREATE INDEX "google_docs_comment_resolved_idx" ON "google_docs_comment_cache" USING btree ("is_resolved");--> statement-breakpoint
CREATE INDEX "google_docs_document_source_idx" ON "google_docs_document" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "google_docs_document_folder_idx" ON "google_docs_document" USING btree ("parent_folder_id");--> statement-breakpoint
CREATE INDEX "google_docs_document_trashed_idx" ON "google_docs_document" USING btree ("is_trashed");--> statement-breakpoint
CREATE INDEX "google_docs_document_starred_idx" ON "google_docs_document" USING btree ("is_starred");--> statement-breakpoint
CREATE INDEX "google_docs_document_modified_idx" ON "google_docs_document" USING btree ("google_modified_at");--> statement-breakpoint
CREATE INDEX "google_docs_folder_source_idx" ON "google_docs_folder" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "google_docs_folder_parent_idx" ON "google_docs_folder" USING btree ("parent_folder_id");--> statement-breakpoint
CREATE INDEX "google_docs_folder_trashed_idx" ON "google_docs_folder" USING btree ("is_trashed");--> statement-breakpoint
CREATE INDEX "conversation_embedding_conv_idx" ON "conversation_embedding" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_embedding_model_idx" ON "conversation_embedding" USING btree ("model");--> statement-breakpoint
CREATE INDEX "conversation_embedding_status_idx" ON "conversation_embedding" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generic_message_embedding_msg_idx" ON "generic_message_embedding" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "generic_message_embedding_model_idx" ON "generic_message_embedding" USING btree ("model");--> statement-breakpoint
CREATE INDEX "generic_message_embedding_status_idx" ON "generic_message_embedding" USING btree ("status");--> statement-breakpoint
CREATE INDEX "slack_channel_source_idx" ON "slack_channel" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "slack_channel_team_idx" ON "slack_channel" USING btree ("slack_team_id");--> statement-breakpoint
CREATE INDEX "slack_channel_archived_idx" ON "slack_channel" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "slack_channel_type_idx" ON "slack_channel" USING btree ("is_channel","is_group","is_im","is_mpim");--> statement-breakpoint
CREATE INDEX "slack_team_source_idx" ON "slack_team" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "slack_user_cache_source_idx" ON "slack_user_cache" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "slack_user_cache_team_idx" ON "slack_user_cache" USING btree ("slack_team_id");--> statement-breakpoint
CREATE INDEX "slack_user_cache_email_idx" ON "slack_user_cache" USING btree ("email");--> statement-breakpoint
CREATE INDEX "whatsapp_waba_source_idx" ON "whatsapp_business_account" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "whatsapp_contact_source_idx" ON "whatsapp_contact_cache" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "whatsapp_contact_wa_id_idx" ON "whatsapp_contact_cache" USING btree ("wa_id");--> statement-breakpoint
CREATE INDEX "whatsapp_msg_source_idx" ON "whatsapp_message_meta" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "whatsapp_msg_wam_idx" ON "whatsapp_message_meta" USING btree ("wam_id");--> statement-breakpoint
CREATE INDEX "whatsapp_msg_from_idx" ON "whatsapp_message_meta" USING btree ("from_wa_id");--> statement-breakpoint
CREATE INDEX "whatsapp_msg_to_idx" ON "whatsapp_message_meta" USING btree ("to_wa_id");--> statement-breakpoint
CREATE INDEX "whatsapp_msg_status_idx" ON "whatsapp_message_meta" USING btree ("status");--> statement-breakpoint
CREATE INDEX "whatsapp_phone_waba_idx" ON "whatsapp_phone_number" USING btree ("waba_id");--> statement-breakpoint
CREATE INDEX "whatsapp_template_waba_idx" ON "whatsapp_template" USING btree ("waba_id");--> statement-breakpoint
CREATE INDEX "notion_database_source_idx" ON "notion_database" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "notion_database_workspace_idx" ON "notion_database" USING btree ("notion_workspace_id");--> statement-breakpoint
CREATE INDEX "notion_database_archived_idx" ON "notion_database" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "notion_page_cache_source_idx" ON "notion_page_cache" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "notion_page_cache_workspace_idx" ON "notion_page_cache" USING btree ("notion_workspace_id");--> statement-breakpoint
CREATE INDEX "notion_page_cache_parent_idx" ON "notion_page_cache" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "notion_page_cache_archived_idx" ON "notion_page_cache" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "notion_page_cache_database_idx" ON "notion_page_cache" USING btree ("is_database");--> statement-breakpoint
CREATE INDEX "notion_user_cache_source_idx" ON "notion_user_cache" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "notion_user_cache_email_idx" ON "notion_user_cache" USING btree ("email");--> statement-breakpoint
CREATE INDEX "notion_workspace_source_idx" ON "notion_workspace" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "task_org_idx" ON "task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_priority_idx" ON "task" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "task_assignee_idx" ON "task" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "task_due_date_idx" ON "task" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "task_source_type_idx" ON "task" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "task_created_at_idx" ON "task" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "task_source_conversation_idx" ON "task" USING btree ("source_conversation_id");--> statement-breakpoint
CREATE INDEX "task_source_commitment_idx" ON "task" USING btree ("source_commitment_id");--> statement-breakpoint
CREATE INDEX "task_source_decision_idx" ON "task" USING btree ("source_decision_id");--> statement-breakpoint
CREATE INDEX "task_activity_task_idx" ON "task_activity" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_activity_user_idx" ON "task_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_activity_type_idx" ON "task_activity" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "task_activity_created_idx" ON "task_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "task_label_org_idx" ON "task_label" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "task_label_junction_task_idx" ON "task_label_junction" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_label_junction_label_idx" ON "task_label_junction" USING btree ("label_id");