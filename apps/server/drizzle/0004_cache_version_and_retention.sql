DROP TABLE `schema_detection_cache`;--> statement-breakpoint
CREATE TABLE `schema_detection_cache` (
	`repo` text NOT NULL,
	`commit_sha` text NOT NULL,
	`settings_key` text NOT NULL,
	`cache_version` integer NOT NULL,
	`sources` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `commit_sha`, `settings_key`, `cache_version`)
);
--> statement-breakpoint
CREATE INDEX `schema_detection_cache_created_at_idx` ON `schema_detection_cache` (`created_at`);--> statement-breakpoint
DROP TABLE `schema_cache`;--> statement-breakpoint
CREATE TABLE `schema_cache` (
	`repo` text NOT NULL,
	`commit_sha` text NOT NULL,
	`source_id` text NOT NULL,
	`files_key` text NOT NULL,
	`cache_version` integer NOT NULL,
	`schema` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `commit_sha`, `source_id`, `files_key`, `cache_version`)
);
--> statement-breakpoint
CREATE INDEX `schema_cache_created_at_idx` ON `schema_cache` (`created_at`);--> statement-breakpoint
ALTER TABLE `blob_cache` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `blob_cache` SET `created_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000;--> statement-breakpoint
CREATE INDEX `blob_cache_created_at_idx` ON `blob_cache` (`created_at`);
