CREATE TABLE `activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sport` enum('road_run','trail_run','xc_ski') NOT NULL,
	`name` varchar(200) NOT NULL,
	`start_time_utc` datetime,
	`local_date` date NOT NULL,
	`distance_m` decimal(9,1) NOT NULL,
	`duration_s` decimal(9,1),
	`elapsed_s` decimal(9,1),
	`elevation_gain_m` int,
	`is_race` boolean NOT NULL DEFAULT false,
	`is_hidden` boolean NOT NULL DEFAULT false,
	`event_id` int,
	`edition_label` varchar(100),
	`notes` text,
	`activity_url` varchar(500),
	`source` enum('manual','manual_simple','fit','strava_export','garmin_export','agent') NOT NULL,
	`external_id` varchar(100),
	`file_name` varchar(255),
	`file_sha256` char(64),
	`splits` json,
	`has_stream` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `activities_id` PRIMARY KEY(`id`),
	CONSTRAINT `activities_external_id_uq` UNIQUE(`external_id`),
	CONSTRAINT `activities_file_name_uq` UNIQUE(`file_name`),
	CONSTRAINT `activities_file_sha256_uq` UNIQUE(`file_sha256`)
);
--> statement-breakpoint
CREATE TABLE `activity_streams` (
	`activity_id` int NOT NULL,
	`data` mediumblob NOT NULL,
	CONSTRAINT `activity_streams_activity_id` PRIMARY KEY(`activity_id`)
);
--> statement-breakpoint
CREATE TABLE `efforts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`activity_id` int NOT NULL,
	`sport` enum('road_run','trail_run','xc_ski') NOT NULL,
	`distance_key` varchar(10) NOT NULL,
	`target_m` decimal(9,1) NOT NULL,
	`actual_distance_m` decimal(9,1) NOT NULL,
	`duration_s` decimal(9,1) NOT NULL,
	`pace_s_per_km` decimal(9,3) NOT NULL,
	`is_tolerance` boolean NOT NULL,
	`origin` enum('computed','manual') NOT NULL,
	`is_edited` boolean NOT NULL DEFAULT false,
	`is_deleted` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `efforts_id` PRIMARY KEY(`id`),
	CONSTRAINT `efforts_activity_distance_uq` UNIQUE(`activity_id`,`distance_key`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sport` enum('road_run','trail_run','xc_ski') NOT NULL,
	`name` varchar(200) NOT NULL,
	`display_distance_m` decimal(9,1),
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` enum('fit','strava_export','garmin_export','agent') NOT NULL,
	`auto_approve` boolean NOT NULL DEFAULT false,
	`summary` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `import_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int,
	`source` enum('fit','strava_export','garmin_export','agent') NOT NULL,
	`file_name` varchar(255),
	`file_sha256` char(64),
	`external_id` varchar(100),
	`status` enum('pending','approved','rejected','duplicate','error') NOT NULL DEFAULT 'pending',
	`parsed` json,
	`duplicate_of_activity_id` int,
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_streams` ADD CONSTRAINT `activity_streams_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `efforts` ADD CONSTRAINT `efforts_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_items` ADD CONSTRAINT `import_items_batch_id_import_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_items` ADD CONSTRAINT `import_items_duplicate_of_activity_id_activities_id_fk` FOREIGN KEY (`duplicate_of_activity_id`) REFERENCES `activities`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activities_sport_date_idx` ON `activities` (`sport`,`local_date`,`start_time_utc`);--> statement-breakpoint
CREATE INDEX `activities_date_idx` ON `activities` (`local_date`,`start_time_utc`);--> statement-breakpoint
CREATE INDEX `activities_start_idx` ON `activities` (`start_time_utc`);--> statement-breakpoint
CREATE INDEX `efforts_records_idx` ON `efforts` (`sport`,`distance_key`,`is_deleted`,`pace_s_per_km`);--> statement-breakpoint
CREATE INDEX `events_sport_order_idx` ON `events` (`sport`,`sort_order`);--> statement-breakpoint
CREATE INDEX `import_items_status_idx` ON `import_items` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_items_sha256_idx` ON `import_items` (`file_sha256`);--> statement-breakpoint
CREATE INDEX `import_items_external_id_idx` ON `import_items` (`external_id`);