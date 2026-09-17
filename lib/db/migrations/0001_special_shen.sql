CREATE TYPE "public"."question_source" AS ENUM('ai_generated', 'human_authored');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'compiler_verified', 'human_reviewed', 'calibrated', 'retired');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('compile_outcome', 'exact_output', 'error_type', 'error_location', 'panic_prediction', 'minimal_fix', 'concept_reasoning');--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" text NOT NULL,
	"type" "question_type" NOT NULL,
	"code" text NOT NULL,
	"prompt" text NOT NULL,
	"answer" jsonb NOT NULL,
	"explanation" text,
	"source" "question_source" NOT NULL,
	"model" text,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"rust_edition" text DEFAULT '2021' NOT NULL,
	"channel" text DEFAULT 'stable' NOT NULL,
	"runner_result_id" uuid,
	"variant_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"action" text NOT NULL,
	"code" text NOT NULL,
	"edition" text NOT NULL,
	"channel" text NOT NULL,
	"success" boolean NOT NULL,
	"stdout" text NOT NULL,
	"stderr" text NOT NULL,
	"exit_detail" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_results_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_skill_id_skill_nodes_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_runner_result_id_runner_results_id_fk" FOREIGN KEY ("runner_result_id") REFERENCES "public"."runner_results"("id") ON DELETE no action ON UPDATE no action;