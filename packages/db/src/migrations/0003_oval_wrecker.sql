CREATE TYPE "public"."conversation_relation_type" AS ENUM('calendar_email', 'slack_email', 'calendar_slack', 'meeting_calendar', 'follow_up', 'reference', 'duplicate');--> statement-breakpoint
CREATE TABLE "related_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"related_conversation_id" text NOT NULL,
	"relation_type" "conversation_relation_type" NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"match_reason" text,
	"is_auto_detected" boolean DEFAULT true NOT NULL,
	"is_dismissed" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp,
	"dismissed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "related_conv_pair_unique" UNIQUE("conversation_id","related_conversation_id","relation_type")
);
--> statement-breakpoint
ALTER TABLE "related_conversation" ADD CONSTRAINT "related_conversation_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "related_conversation" ADD CONSTRAINT "related_conversation_related_conversation_id_conversation_id_fk" FOREIGN KEY ("related_conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "related_conv_conv_idx" ON "related_conversation" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "related_conv_related_idx" ON "related_conversation" USING btree ("related_conversation_id");--> statement-breakpoint
CREATE INDEX "related_conv_type_idx" ON "related_conversation" USING btree ("relation_type");--> statement-breakpoint
CREATE INDEX "related_conv_confidence_idx" ON "related_conversation" USING btree ("confidence");