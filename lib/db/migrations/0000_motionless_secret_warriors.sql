CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subject_type` text NOT NULL,
	`email` text NOT NULL,
	`country` text NOT NULL,
	`date_of_birth` text,
	`registration_number` text,
	`kyc_status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`description` text NOT NULL,
	`environment` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flags_key_env_idx` ON `feature_flags` (`key`,`environment`);--> statement-breakpoint
CREATE TABLE `kyc_case_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`from_stage` text,
	`to_stage` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `kyc_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kyc_case_events_case_idx` ON `kyc_case_events` (`case_id`);--> statement-breakpoint
CREATE TABLE `kyc_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`case_ref` text NOT NULL,
	`customer_id` text NOT NULL,
	`stage` text NOT NULL,
	`risk_rating` text NOT NULL,
	`assigned_reviewer_id` text,
	`decision_reason` text,
	`opened_at` integer NOT NULL,
	`modified_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kyc_cases_case_ref_idx` ON `kyc_cases` (`case_ref`);--> statement-breakpoint
CREATE INDEX `kyc_cases_stage_idx` ON `kyc_cases` (`stage`);--> statement-breakpoint
CREATE TABLE `kyc_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`document_type` text NOT NULL,
	`status` text NOT NULL,
	`verified_at` integer,
	`verified_by_id` text,
	FOREIGN KEY (`case_id`) REFERENCES `kyc_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kyc_documents_case_idx` ON `kyc_documents` (`case_id`);--> statement-breakpoint
CREATE TABLE `kyc_risk_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`factor` text NOT NULL,
	`detail` text NOT NULL,
	`weight` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `kyc_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kyc_risk_factors_case_idx` ON `kyc_risk_factors` (`case_id`);--> statement-breakpoint
CREATE TABLE `refund_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_ref` text NOT NULL,
	`customer_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`reason_code` text NOT NULL,
	`status` text NOT NULL,
	`requested_by_id` text NOT NULL,
	`first_approver_id` text,
	`second_approver_id` text,
	`rejection_reason` text,
	`created_at` integer NOT NULL,
	`modified_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`second_approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_requests_ref_idx` ON `refund_requests` (`refund_ref`);--> statement-breakpoint
CREATE INDEX `refund_requests_customer_idx` ON `refund_requests` (`customer_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL
);
