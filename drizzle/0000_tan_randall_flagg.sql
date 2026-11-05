CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`all_day` integer NOT NULL,
	`owner_scope` text NOT NULL,
	`category` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`repeat_rule` text DEFAULT 'none' NOT NULL,
	`repeat_until` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_household_start` ON `events` (`household_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`a_name` text NOT NULL,
	`b_name` text NOT NULL,
	`anniversary` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`used_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_code_hash_unique` ON `invitations` (`code_hash`);--> statement-breakpoint
CREATE INDEX `invitations_household` ON `invitations` (`household_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`slot` text NOT NULL,
	`email` text NOT NULL,
	`joined_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_household_slot` ON `members` (`household_id`,`slot`);