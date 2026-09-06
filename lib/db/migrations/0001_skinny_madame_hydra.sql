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
CREATE INDEX `refund_events_refund_idx` ON `refund_events` (`refund_id`);--> statement-breakpoint
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
ALTER TABLE `refund_requests` ADD `transaction_id` text NOT NULL REFERENCES transactions(id);--> statement-breakpoint
ALTER TABLE `refund_requests` ADD `channel` text NOT NULL;--> statement-breakpoint
CREATE INDEX `refund_requests_status_idx` ON `refund_requests` (`status`);