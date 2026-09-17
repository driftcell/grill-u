CREATE TYPE "public"."skill_status" AS ENUM('draft', 'compiler_verified', 'human_reviewed', 'calibrated');--> statement-breakpoint
CREATE TABLE "skill_edges" (
	"skill_id" text NOT NULL,
	"prerequisite_id" text NOT NULL,
	CONSTRAINT "skill_edges_skill_id_prerequisite_id_pk" PRIMARY KEY("skill_id","prerequisite_id")
);
--> statement-breakpoint
CREATE TABLE "skill_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"title_zh" text NOT NULL,
	"title_en" text NOT NULL,
	"summary" text NOT NULL,
	"misconceptions" text[] DEFAULT '{}' NOT NULL,
	"status" "skill_status" DEFAULT 'draft' NOT NULL,
	"rust_edition" text DEFAULT '2021' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_edges" ADD CONSTRAINT "skill_edges_skill_id_skill_nodes_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_edges" ADD CONSTRAINT "skill_edges_prerequisite_id_skill_nodes_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."skill_nodes"("id") ON DELETE cascade ON UPDATE no action;