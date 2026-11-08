CREATE TABLE `repo_formats` (
	`repo` text PRIMARY KEY NOT NULL,
	`format` text,
	`commit_sha` text,
	`checked_at` integer NOT NULL,
	`failed_at` integer,
	`stale` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_favorite_repos` (
	`user_id` text NOT NULL,
	`repo` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_repo_visits` (
	`user_id` text NOT NULL,
	`repo` text NOT NULL,
	`visited_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
