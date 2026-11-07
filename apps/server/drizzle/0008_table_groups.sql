CREATE TABLE `table_group_assignments` (
	`repo` text NOT NULL,
	`source_id` text NOT NULL,
	`table_name` text NOT NULL,
	`group_id` text,
	PRIMARY KEY(`repo`, `source_id`, `table_name`)
);
--> statement-breakpoint
CREATE TABLE `table_group_configs` (
	`repo` text NOT NULL,
	`source_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`repo`, `source_id`)
);
--> statement-breakpoint
CREATE TABLE `table_groups` (
	`repo` text NOT NULL,
	`source_id` text NOT NULL,
	`group_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`origins` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`repo`, `source_id`, `group_id`)
);
