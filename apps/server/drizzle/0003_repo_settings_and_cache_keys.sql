DROP TABLE `schema_detection_cache`;--> statement-breakpoint
CREATE TABLE `schema_detection_cache` (
	`repo` text NOT NULL,
	`commit_sha` text NOT NULL,
	`settings_key` text NOT NULL,
	`sources` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `commit_sha`, `settings_key`)
);
--> statement-breakpoint
DROP TABLE `schema_cache`;--> statement-breakpoint
CREATE TABLE `schema_cache` (
	`repo` text NOT NULL,
	`commit_sha` text NOT NULL,
	`source_id` text NOT NULL,
	`files_key` text NOT NULL,
	`schema` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `commit_sha`, `source_id`, `files_key`)
);
--> statement-breakpoint
CREATE TABLE `repo_settings` (
	`repo` text PRIMARY KEY NOT NULL,
	`sources` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
ALTER TABLE `instance_config` ADD `app_owner_type` text;
