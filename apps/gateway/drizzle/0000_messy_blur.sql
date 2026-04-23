CREATE TABLE `agents` (
	`name` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`system_prompt` text NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`tools` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_unique` ON `agents` (`name`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`agent_name` text NOT NULL,
	`conversation_id` text PRIMARY KEY NOT NULL,
	`history` text,
	`updated_at` integer,
	FOREIGN KEY (`agent_name`) REFERENCES `agents`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_conversation_id_unique` ON `conversations` (`conversation_id`);