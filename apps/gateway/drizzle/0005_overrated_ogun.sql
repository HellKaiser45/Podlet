CREATE TABLE `llm_usage` (
	`call_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`frame_id` text NOT NULL,
	`parent_frame_id` text,
	`agent_id` text NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`protocol` text NOT NULL,
	`outcome` text NOT NULL,
	`finish_reason` text NOT NULL,
	`usage_requested` integer NOT NULL,
	`usage_reported` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`no_cache_tokens` integer,
	`reasoning_tokens` integer,
	`text_tokens` integer,
	`raw_usage` text,
	`raw_truncated` integer DEFAULT false NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `llm_usage_run` ON `llm_usage` (`run_id`);--> statement-breakpoint
CREATE INDEX `llm_usage_run_frame` ON `llm_usage` (`run_id`,`frame_id`);