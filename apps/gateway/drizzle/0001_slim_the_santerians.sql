CREATE TABLE `frames` (
	`frame_id` text PRIMARY KEY NOT NULL,
	`parent_frame_id` text,
	`agent_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`history` text NOT NULL,
	`pending_approvals` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
DROP TABLE `conversations`;