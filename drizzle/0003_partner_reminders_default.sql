PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`partner_changes` integer DEFAULT 1 NOT NULL,
	`reminders` integer DEFAULT 1 NOT NULL,
	`include_partner` integer DEFAULT 1 NOT NULL,
	`minutes` integer DEFAULT 30 NOT NULL,
	`all_day_time` text DEFAULT '09:00' NOT NULL,
	`quiet_enabled` integer DEFAULT 0 NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '08:00' NOT NULL,
	`preview` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`enabled_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_notification_preferences`("user_id", "partner_changes", "reminders", "include_partner", "minutes", "all_day_time", "quiet_enabled", "quiet_start", "quiet_end", "preview", "revision", "enabled_at", "updated_at") SELECT "user_id", "partner_changes", "reminders", "include_partner", "minutes", "all_day_time", "quiet_enabled", "quiet_start", "quiet_end", "preview", "revision", "enabled_at", "updated_at" FROM `notification_preferences`;--> statement-breakpoint
DROP TABLE `notification_preferences`;--> statement-breakpoint
ALTER TABLE `__new_notification_preferences` RENAME TO `notification_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- Adopt the new default only for accounts that have never saved preferences.
-- A saved opt-out and the main reminders switch remain unchanged.
UPDATE `notification_preferences`
SET `include_partner` = 1, `revision` = `revision` + 1,
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `revision` = 1 AND `include_partner` = 0;
