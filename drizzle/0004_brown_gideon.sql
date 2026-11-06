CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`category` text NOT NULL,
	`page` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reporter_name` text NOT NULL,
	`reporter_email` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`internal_note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_reporter_created` ON `feedback` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_created_id` ON `feedback` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `feedback_status_created` ON `feedback` (`status`,`created_at`,`id`);