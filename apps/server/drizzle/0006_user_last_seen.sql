ALTER TABLE `users` ADD `last_seen_at` integer;--> statement-breakpoint
UPDATE `users` SET `last_seen_at` = (SELECT max(`last_seen_at`) FROM `sessions` WHERE `sessions`.`user_id` = `users`.`id`);
--> statement-breakpoint
UPDATE `instance_config` SET `github_mode` = 'real' WHERE `github_mode` IS NULL AND `app_id` IS NOT NULL;
