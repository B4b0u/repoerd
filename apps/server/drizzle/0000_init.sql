CREATE TABLE `blob_cache` (
	`sha` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `layouts` (
	`user_id` text NOT NULL,
	`repo` text NOT NULL,
	`source_id` text NOT NULL,
	`table_name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo`, `source_id`, `table_name`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schema_cache` (
	`repo` text NOT NULL,
	`commit_sha` text NOT NULL,
	`source_id` text NOT NULL,
	`schema` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `commit_sha`, `source_id`)
);
--> statement-breakpoint
CREATE TABLE `schema_detection_cache` (
	`repo` text NOT NULL,
	`commit_sha` text NOT NULL,
	`sources` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `commit_sha`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`created_at` integer NOT NULL
);
