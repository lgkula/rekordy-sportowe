CREATE TABLE `jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(50) NOT NULL,
	`status` enum('running','done') NOT NULL DEFAULT 'running',
	`active_key` varchar(50),
	`total` int NOT NULL DEFAULT 0,
	`processed` int NOT NULL DEFAULT 0,
	`cursor_id` int NOT NULL DEFAULT 0,
	`lease_until_ms` bigint,
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`finished_at` timestamp NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_active_key_uq` UNIQUE(`active_key`)
);
--> statement-breakpoint
CREATE INDEX `jobs_type_created_idx` ON `jobs` (`type`,`created_at`);