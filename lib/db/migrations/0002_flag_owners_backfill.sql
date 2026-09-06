-- Databases seeded before owners existed keep 'Unassigned'; give the known flags
-- their owning team and add refunds.require_kyc_approval where it is missing.
-- Guarded with NOT EXISTS rather than an upsert so this is plain portable SQL,
-- and skipped entirely on an empty table so seeding still owns fresh databases.
UPDATE `feature_flags` SET `owner` = 'Compliance' WHERE `owner` = 'Unassigned' AND `key` LIKE 'kyc.%';--> statement-breakpoint
UPDATE `feature_flags` SET `owner` = 'Payments' WHERE `owner` = 'Unassigned' AND `key` LIKE 'refunds.%';--> statement-breakpoint
UPDATE `feature_flags` SET `owner` = 'Platform' WHERE `owner` = 'Unassigned' AND `key` LIKE 'platform.%';--> statement-breakpoint
INSERT INTO `feature_flags` (`id`, `key`, `description`, `owner`, `environment`, `enabled`, `updated_at`)
SELECT 'flg_require_kyc_approval_dev', 'refunds.require_kyc_approval', 'Require an approved KYC case on the customer before a refund is approved.', 'Compliance', 'dev', 0, 1785661200000
WHERE EXISTS (SELECT 1 FROM `feature_flags`)
  AND NOT EXISTS (SELECT 1 FROM `feature_flags` WHERE `key` = 'refunds.require_kyc_approval' AND `environment` = 'dev');--> statement-breakpoint
INSERT INTO `feature_flags` (`id`, `key`, `description`, `owner`, `environment`, `enabled`, `updated_at`)
SELECT 'flg_require_kyc_approval_staging', 'refunds.require_kyc_approval', 'Require an approved KYC case on the customer before a refund is approved.', 'Compliance', 'staging', 0, 1785661200000
WHERE EXISTS (SELECT 1 FROM `feature_flags`)
  AND NOT EXISTS (SELECT 1 FROM `feature_flags` WHERE `key` = 'refunds.require_kyc_approval' AND `environment` = 'staging');--> statement-breakpoint
INSERT INTO `feature_flags` (`id`, `key`, `description`, `owner`, `environment`, `enabled`, `updated_at`)
SELECT 'flg_require_kyc_approval_prod', 'refunds.require_kyc_approval', 'Require an approved KYC case on the customer before a refund is approved.', 'Compliance', 'prod', 0, 1785661200000
WHERE EXISTS (SELECT 1 FROM `feature_flags`)
  AND NOT EXISTS (SELECT 1 FROM `feature_flags` WHERE `key` = 'refunds.require_kyc_approval' AND `environment` = 'prod');--> statement-breakpoint
UPDATE `feature_flags` SET `owner` = 'Compliance' WHERE `key` = 'refunds.require_kyc_approval';
