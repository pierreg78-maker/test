CREATE TABLE `archive_job_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(64) NOT NULL,
	`imageId` varchar(32) NOT NULL,
	`originalUrl` text NOT NULL,
	`previewUrl` text,
	`detailUrl` text NOT NULL,
	`status` enum('queued','downloading','complete','failed') NOT NULL DEFAULT 'queued',
	`fileName` varchar(255),
	`byteSize` bigint,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `archive_job_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `archive_jobs` (
	`id` varchar(64) NOT NULL,
	`sourceUrl` text NOT NULL,
	`status` enum('queued','downloading','archiving','complete','failed') NOT NULL DEFAULT 'queued',
	`totalCount` int NOT NULL,
	`completedCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`archiveUrl` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `archive_jobs_id` PRIMARY KEY(`id`)
);
