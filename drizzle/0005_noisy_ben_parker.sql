CREATE TABLE `ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assistant_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_handoffs_expiry` ON `assistant_handoffs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `assistant_handoffs_user` ON `assistant_handoffs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_usage_user_created` ON `assistant_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `assistant_usage_created` ON `assistant_usage` (`created_at`);