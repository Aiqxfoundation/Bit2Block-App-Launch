-- Make the free 100 KH/s starter power a one-time grant at registration.
-- Existing users who already started mining keep their current balances; only mark the grant.
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_starter_granted boolean DEFAULT false;

-- Users who have not started mining yet have not received the starter power in the legacy flow.
-- Add it to both owned and base power, preserving any power they purchased before activation.
UPDATE users
SET base_hash_power = COALESCE(base_hash_power, 0) + 0.10,
    hash_power = COALESCE(hash_power, 0) + 0.10,
    free_starter_granted = true
WHERE COALESCE(has_started_mining, false) = false
  AND COALESCE(free_starter_granted, false) = false;

-- Previously activated accounts already received the starter amount through /api/start-mining.
UPDATE users
SET free_starter_granted = true
WHERE COALESCE(has_started_mining, false) = true
  AND COALESCE(free_starter_granted, false) = false;

ALTER TABLE users ALTER COLUMN free_starter_granted SET DEFAULT false;
