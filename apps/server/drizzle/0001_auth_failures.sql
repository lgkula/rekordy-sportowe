CREATE TABLE `auth_failures` (
	`key` varchar(100) NOT NULL,
	`failures` int NOT NULL,
	`reset_at_ms` bigint NOT NULL,
	CONSTRAINT `auth_failures_key` PRIMARY KEY(`key`)
);
