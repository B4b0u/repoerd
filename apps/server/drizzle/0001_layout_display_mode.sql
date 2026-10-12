PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_layouts` (
	`user_id` text NOT NULL,
	`repo` text NOT NULL,
	`source_id` text NOT NULL,
	`mode` text DEFAULT 'ALL_FIELDS' NOT NULL,
	`table_name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo`, `source_id`, `mode`, `table_name`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_layouts`("user_id", "repo", "source_id", "mode", "table_name", "x", "y", "updated_at") SELECT "user_id", "repo", "source_id", 'ALL_FIELDS', "table_name", "x", "y", "updated_at" FROM `layouts`;--> statement-breakpoint
DROP TABLE `layouts`;--> statement-breakpoint
ALTER TABLE `__new_layouts` RENAME TO `layouts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;