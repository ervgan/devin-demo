-- Flag edits are admin-only, so databases seeded before the admin role existed
-- would have nobody able to change a value. Skipped on an empty database, which
-- is populated by seeding instead.
INSERT INTO `users` (`id`, `name`, `email`, `role`, `created_at`)
SELECT 'usr_nadia', 'Nadia Faraj', 'nadia.faraj@example.com', 'admin', 1783155600000
WHERE EXISTS (SELECT 1 FROM `users`)
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = 'usr_nadia');
