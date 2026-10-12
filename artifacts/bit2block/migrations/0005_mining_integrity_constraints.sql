-- Prevent duplicate block heights and duplicate user reward rows if a scheduler retries.
ALTER TABLE mining_blocks ALTER COLUMN total_hash_power TYPE numeric(18,2);
ALTER TABLE mining_blocks ALTER COLUMN global_hashrate TYPE numeric(18,2);
ALTER TABLE mining_stats ALTER COLUMN total_hash_power TYPE numeric(18,2);
-- Existing duplicates must be reconciled before applying this migration.
-- Historical BTC withdrawal requests deducted BTC before admin approval. Refund
-- legacy rejected requests exactly once, then normalize completed/rejected currency labels.
UPDATE users AS u
SET btc_balance = COALESCE(u.btc_balance, 0) + legacy.amount
FROM (
  SELECT user_id, SUM(amount) AS amount
  FROM withdrawals
  WHERE network = 'BTC' AND currency = 'USDT' AND status = 'rejected'
  GROUP BY user_id
) AS legacy
WHERE u.id = legacy.user_id;
-- Completed legacy BTC withdrawals also deducted B2B by the old approval path;
-- restore that accidental B2B debit before normalizing the history label.
UPDATE users AS u
SET b2b_balance = COALESCE(u.b2b_balance, 0) + legacy.amount
FROM (
  SELECT user_id, SUM(amount) AS amount
  FROM withdrawals
  WHERE network = 'BTC' AND currency = 'USDT' AND status = 'completed'
  GROUP BY user_id
) AS legacy
WHERE u.id = legacy.user_id;
UPDATE withdrawals SET currency = 'BTC'
WHERE network = 'BTC' AND currency = 'USDT' AND status IN ('completed', 'rejected');
CREATE UNIQUE INDEX IF NOT EXISTS mining_blocks_block_number_uq ON mining_blocks (block_number);
CREATE UNIQUE INDEX IF NOT EXISTS unclaimed_blocks_user_block_uq ON unclaimed_blocks (user_id, block_number);
CREATE UNIQUE INDEX IF NOT EXISTS mining_history_user_block_uq ON mining_history (user_id, block_number);
CREATE INDEX IF NOT EXISTS unclaimed_blocks_pending_user_idx ON unclaimed_blocks (user_id) WHERE claimed IS NOT TRUE;
