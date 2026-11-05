CREATE TABLE `auth_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_subject` ON `auth_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_user` ON `auth_identities` (`provider`,`user_id`);