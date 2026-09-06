CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_ref` text NOT NULL,
	`customer_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`channel` text NOT NULL,
	`description` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_ref_idx` ON `transactions` (`transaction_ref`);--> statement-breakpoint
CREATE INDEX `transactions_customer_idx` ON `transactions` (`customer_id`);--> statement-breakpoint
INSERT INTO `transactions` (`id`, `transaction_ref`, `customer_id`, `amount_cents`, `currency`, `channel`, `description`, `occurred_at`)
	SELECT 'txn_backfill_' || `id`, 'TXN-BACKFILL-' || `id`, `customer_id`, `amount_cents`, `currency`, 'card', 'Original payment backfilled when refunds gained transactions', `created_at`
	FROM `refund_requests`;--> statement-breakpoint
CREATE TABLE `__new_refund_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_ref` text NOT NULL,
	`customer_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`reason_code` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`requested_by_id` text NOT NULL,
	`first_approver_id` text,
	`second_approver_id` text,
	`rejection_reason` text,
	`created_at` integer NOT NULL,
	`modified_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`second_approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_refund_requests` (`id`, `refund_ref`, `customer_id`, `transaction_id`, `amount_cents`, `currency`, `reason_code`, `channel`, `status`, `requested_by_id`, `first_approver_id`, `second_approver_id`, `rejection_reason`, `created_at`, `modified_at`)
	SELECT `id`, `refund_ref`, `customer_id`, 'txn_backfill_' || `id`, `amount_cents`, `currency`, `reason_code`, 'card', `status`, `requested_by_id`, `first_approver_id`, `second_approver_id`, `rejection_reason`, `created_at`, `modified_at`
	FROM `refund_requests`;--> statement-breakpoint
DROP TABLE `refund_requests`;--> statement-breakpoint
ALTER TABLE `__new_refund_requests` RENAME TO `refund_requests`;--> statement-breakpoint
CREATE UNIQUE INDEX `refund_requests_ref_idx` ON `refund_requests` (`refund_ref`);--> statement-breakpoint
CREATE INDEX `refund_requests_customer_idx` ON `refund_requests` (`customer_id`);--> statement-breakpoint
CREATE INDEX `refund_requests_status_idx` ON `refund_requests` (`status`);--> statement-breakpoint
CREATE TABLE `refund_events` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`refund_id`) REFERENCES `refund_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_events_refund_idx` ON `refund_events` (`refund_id`);
