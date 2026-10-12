CREATE TABLE `instance_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_url` text,
	`app_id` integer,
	`app_slug` text,
	`app_name` text,
	`app_html_url` text,
	`app_owner_login` text,
	`client_id` text,
	`client_secret` text,
	`private_key` text,
	`allowed_orgs` text DEFAULT '[]' NOT NULL,
	`setup_code_hash` text,
	`setup_grant_hash` text,
	`setup_grant_expires_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `access_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `access_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `refresh_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `refresh_token_expires_at` integer;