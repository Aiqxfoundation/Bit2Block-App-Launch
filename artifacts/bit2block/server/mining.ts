import { storage } from "./storage";
import { pool } from "./db";
import cron from "node-cron";
import Decimal from "decimal.js";
import { createHash } from "crypto";

/**
 * B2B MINING FAIRNESS MECHANISM
 * =============================
 * 
 * Our mining system ensures perfect fairness for all participants by:
 * 
 * 1. ATOMIC HASHRATE SNAPSHOT:
 *    - Each block snapshots eligible locked hashrate inside the same DB transaction
 *      that creates the block and distributes its reward.
 *    - Purchases and reactivation stage power for the next block snapshot.
 *    - Every share uses the same denominator recorded on that block.
 * 
 * 2. CANONICAL REWARD LEDGER:
 *    - Each user/block reward is stored in unclaimed_blocks.
 *    - Claims settle that ledger transactionally; no client or global-index calculation is authoritative.
 * 
 * 3. 24-BLOCK SUSPENSION RULE:
 *    - Mining automatically suspends when a user accumulates 24 unclaimed blocks
 *    - This ensures users claim regularly and prevents excessive accumulation
 *    - Once 24 pending block rewards exist, power is excluded from the next block.
 *    - Mining resumes only after all pending rewards are claimed.
 * 
 * 4. HASH RATE LOCKING:
 *    - Before each block generation, all active miners' hash rates are locked
 *    - These locked rates are used for reward distribution
 *    - Any changes to hash power only affect the NEXT block, not the current one
 */

let totalBlockHeight = 0; // Total blocks mined (never resets, continuous)
let currentBlockReward = 3200;
let isProcessingBlock = false;
let miningSetup: Promise<void> | null = null;

export function setupMining(): Promise<void> {
  if (miningSetup) return miningSetup;
  miningSetup = initializeSettings().then(async () => {
    // Pending rewards must remain claimable; startup/redeploy must never credit them
    // automatically or reset a user's suspension state.

    // Check every minute. If the process was down at the scheduled hour, the next
    // tick catches up instead of silently skipping that block window.
    cron.schedule("* * * * *", async () => {
      if (isProcessingBlock) return;
      isProcessingBlock = true;
      try {
        const latest = await storage.getLatestBlock();
        const lastTime = latest?.timestamp ? new Date(latest.timestamp).getTime() : 0;
        if (!lastTime || Date.now() - lastTime >= 60 * 60 * 1000) {
          await generateAndDistributeBlock();
        }
      } catch (error) {
        console.error("Error in automatic block generation:", error);
      } finally {
        isProcessingBlock = false;
      }
    }, { timezone: "UTC" });

    // Run hourly so expired stakes are unlocked promptly. The storage transaction
    // pays at most once per UTC day and safely serializes multiple app instances.
    cron.schedule("0 * * * *", async () => {
      try {
        await distributeBtcStakingRewards();
      } catch (error) {
        console.error("Error settling BTC staking rewards:", error);
      }
    }, { timezone: "UTC" });

    cron.schedule("*/30 * * * *", async () => {
      try {
        await storage.checkAndSuspendInactiveMiners();
      } catch (error) {
        console.error("Error checking inactive miners:", error);
      }
    }, { timezone: "UTC" });

    console.log("Mining system initialized - one database-backed block is scheduled per hour (UTC)");
  }).catch(error => {
    miningSetup = null;
    throw error;
  });
  return miningSetup;
}

async function initializeSettings() {
  let retries = 3;
  
  while (retries > 0) {
    try {
      // Load block reward
      const blockRewardSetting = await storage.getSystemSetting("blockReward");
      if (blockRewardSetting) {
        currentBlockReward = parseFloat(blockRewardSetting.value);
      } else {
        await storage.setSystemSetting("blockReward", currentBlockReward.toString());
      }
      
      // mining_blocks is the sole authority for block height. Reconcile legacy
      // settings to the persisted chain tip instead of allowing stale settings to skip heights.
      const latestBlock = await storage.getLatestBlock();
      totalBlockHeight = latestBlock?.blockNumber || 0;
      await storage.setSystemSetting("totalBlockHeight", String(totalBlockHeight));
      const mined = new Decimal(await storage.getTotalMinedSupply());
      const nextHeight = totalBlockHeight + 1;
      let nextReward = new Decimal(3200).div(new Decimal(2).pow(Math.floor((nextHeight - 1) / 2160)));
      const remaining = new Decimal(21000000).minus(mined);
      if (remaining.lte(0)) nextReward = new Decimal(0);
      else if (nextReward.gt(remaining)) nextReward = remaining;
      currentBlockReward = Number(nextReward.toDecimalPlaces(8, Decimal.ROUND_DOWN).toString());
      await storage.setSystemSetting("blockReward", nextReward.toDecimalPlaces(8, Decimal.ROUND_DOWN).toFixed(8));

      console.log(`Mining initialized: Block height ${totalBlockHeight}, next reward ${currentBlockReward} B2B`);
      return; // Success, exit retry loop
      
    } catch (error: any) {
      retries--;
      if (error?.message?.includes('endpoint has been disabled') || error?.code === 'XX000') {
        // Database reactivating, retry silently
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
      }
      
      console.error("Error initializing mining settings:", error);
    }
  }
  throw new Error("Unable to initialize mining settings from PostgreSQL.");
}

async function generateAndDistributeBlock() {
  const client = await pool!.connect();
  let lockAcquired = false;
  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock($1, $2) AS locked", [423242, 1]);
    lockAcquired = lockResult.rows[0]?.locked === true;
    if (!lockAcquired) return;

    await client.query("BEGIN");
    await client.query(
      "SELECT key FROM system_settings WHERE key = ANY($1::text[]) FOR UPDATE",
      [["totalBlockHeight", "blockReward"]],
    );
    const latestResult = await client.query("SELECT block_number, block_hash, timestamp FROM mining_blocks ORDER BY block_number DESC LIMIT 1");
    const latest = latestResult.rows[0];
    const supplyResult = await client.query("SELECT COALESCE(SUM(reward), 0)::text AS total FROM mining_blocks");
    const totalMined = new Decimal(supplyResult.rows[0]?.total || "0");
    const MAX_SUPPLY = new Decimal("21000000");
    if (totalMined.gte(MAX_SUPPLY)) {
      await client.query("COMMIT");
      console.log("Maximum B2B supply reached; no additional rewards will be issued.");
      return;
    }

    // Never trust a stale counter setting to skip or duplicate a persisted block height.
    totalBlockHeight = Number(latest?.block_number || 0);
    const nextHeight = totalBlockHeight + 1;
    const halvingPeriod = Math.floor((nextHeight - 1) / 2160);
    let reward = new Decimal(3200).div(new Decimal(2).pow(halvingPeriod));
    const remainingSupply = MAX_SUPPLY.minus(totalMined);
    if (reward.gt(remainingSupply)) reward = remainingSupply;
    reward = reward.toDecimalPlaces(8, Decimal.ROUND_DOWN);
    if (!reward.gt(0)) {
      await client.query("COMMIT");
      return;
    }

    // Lock only the columns needed for this snapshot, and read pending counts from
    // the reward ledger rather than trusting cached user counters.
    const userResult = await client.query(
      `SELECT id, mining_active, mining_suspended, is_frozen, is_banned,
              next_block_hash_power, hash_power, locked_hash_power, unclaimed_blocks_count, suspension_at_block
       FROM users ORDER BY id FOR UPDATE`,
    );
    const users = userResult.rows;
    const pendingCountResult = await client.query(
      "SELECT user_id, COUNT(*)::int AS count FROM unclaimed_blocks WHERE claimed IS NOT TRUE GROUP BY user_id",
    );
    const pendingCountByUser = new Map<string, number>(pendingCountResult.rows.map((row: any) => [String(row.user_id), Number(row.count || 0)] as [string, number]));
    const snapshotIds: string[] = [];
    const snapshotLockedPowers: string[] = [];
    const snapshotPendingCounts: number[] = [];
    const snapshotLimitFlags: boolean[] = [];
    for (const user of users) {
      const pendingCount = pendingCountByUser.get(user.id) || 0;
      const limitReached = pendingCount >= 24;
      const eligible = user.mining_active === true && user.mining_suspended !== true &&
        user.is_frozen !== true && user.is_banned !== true && !limitReached;
      const pendingPower = new Decimal(user.next_block_hash_power || "0");
      const power = pendingPower.gt(0) ? pendingPower : new Decimal(user.hash_power || "0");
      const lockedPower = eligible && power.gt(0) ? power : new Decimal(0);
      user.locked_hash_power = lockedPower.toFixed(2);
      user.unclaimed_blocks_count = pendingCount;
      if (limitReached) {
        user.mining_active = false;
        user.mining_suspended = true;
      }
      snapshotIds.push(user.id);
      snapshotLockedPowers.push(user.locked_hash_power);
      snapshotPendingCounts.push(pendingCount);
      snapshotLimitFlags.push(limitReached);
    }
    if (snapshotIds.length > 0) {
      await client.query(
        `UPDATE users AS u
         SET locked_hash_power = v.locked_power::numeric,
             next_block_hash_power = COALESCE(u.hash_power, 0),
             unclaimed_blocks_count = v.pending_count,
             mining_suspended = CASE WHEN v.limit_reached THEN true ELSE COALESCE(u.mining_suspended, false) END,
             mining_active = CASE WHEN v.limit_reached THEN false ELSE COALESCE(u.mining_active, false) END,
             suspension_at_block = CASE WHEN v.limit_reached AND u.suspension_at_block IS NULL THEN $5 ELSE u.suspension_at_block END
         FROM UNNEST($1::uuid[], $2::numeric[], $3::int[], $4::boolean[]) AS v(id, locked_power, pending_count, limit_reached)
         WHERE u.id = v.id`,
        [snapshotIds, snapshotLockedPowers, snapshotPendingCounts, snapshotLimitFlags, nextHeight],
      );
    }
    const eligibleUsers = users.filter((u: any) =>
      u.mining_active === true && u.mining_suspended !== true && u.is_frozen !== true &&
      u.is_banned !== true && (pendingCountByUser.get(u.id) || 0) < 24 && new Decimal(u.locked_hash_power || "0").gt(0),
    );
    const globalHashrate = eligibleUsers.reduce((sum: Decimal, u: any) => sum.plus(u.locked_hash_power || "0"), new Decimal(0));
    // Blocks may continue for a consistent height, but no reward is minted when
    // nobody is eligible to receive it. This keeps supply tied to allocated rewards.
    if (!globalHashrate.gt(0)) reward = new Decimal(0);

    const now = new Date();
    const previousHash = latest?.block_hash || "0x" + "0".repeat(64);
    const payload = `${nextHeight}:${previousHash}:${now.getTime()}:${globalHashrate.toFixed(2)}:${reward.toFixed(8)}`;
    const blockHash = "0x" + createHash("sha256").update(payload).digest("hex");
    const blockStart = new Date(now);
    blockStart.setUTCMinutes(0, 0, 0);
    const blockEnd = new Date(blockStart.getTime() + 60 * 60 * 1000);
    const blockInsert = await client.query(
      `INSERT INTO mining_blocks (block_number, reward, total_hash_power, global_hashrate, block_hash, previous_hash, block_start_time, block_end_time, timestamp)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nextHeight, reward.toFixed(8), globalHashrate.toFixed(2), blockHash, previousHash, blockStart, blockEnd, now],
    );

    // Allocate exact 8-decimal token units in memory, then bulk-write the ledger.
    // This avoids several SQL round-trips per miner on every block.
    if (globalHashrate.gt(0) && eligibleUsers.length > 0) {
      const rewardUnits = BigInt(reward.mul(100_000_000).toFixed(0));
      let allocated = 0n;
      const allocations: Array<{ id: string; power: string; reward: string; pendingCount: number; suspend: boolean; ledgerReference: string }> = [];
      for (let i = 0; i < eligibleUsers.length; i++) {
        const user = eligibleUsers[i];
        const power = new Decimal(user.locked_hash_power || "0");
        const units = i === eligibleUsers.length - 1
          ? rewardUnits - allocated
          : BigInt(new Decimal(rewardUnits.toString()).mul(power).div(globalHashrate).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0));
        allocated += units;
        if (units <= 0n) continue;
        const userReward = new Decimal(units.toString()).div(100_000_000).toFixed(8);
        const pendingCount = (pendingCountByUser.get(user.id) || 0) + 1;
        allocations.push({
          id: user.id,
          power: String(user.locked_hash_power || "0.00"),
          reward: userReward,
          pendingCount,
          suspend: pendingCount >= 24,
          ledgerReference: "0x" + createHash("sha256").update(`${blockHash}:${user.id}:${nextHeight}`).digest("hex"),
        });
      }
      if (allocations.length > 0) {
        const ids = allocations.map(row => row.id);
        const rewards = allocations.map(row => row.reward);
        const powers = allocations.map(row => row.power);
        const references = allocations.map(row => row.ledgerReference);
        const pendingCounts = allocations.map(row => row.pendingCount);
        const suspendFlags = allocations.map(row => row.suspend);
        await client.query(
          `INSERT INTO unclaimed_blocks (user_id, block_number, tx_hash, reward, expires_at, claimed, created_at)
           SELECT v.user_id, $2, v.ledger_reference, v.reward::numeric, NULL, false, $5
           FROM UNNEST($1::uuid[], $3::text[], $4::numeric[]) AS v(user_id, ledger_reference, reward)`,
          [ids, nextHeight, references, rewards, now],
        );
        await client.query(
          `INSERT INTO mining_history (user_id, block_number, locked_hashrate, reward, claimed_at)
           SELECT v.user_id, $2, v.locked_hashrate::numeric, v.reward::numeric, $5
           FROM UNNEST($1::uuid[], $3::numeric[], $4::numeric[]) AS v(user_id, locked_hashrate, reward)`,
          [ids, nextHeight, powers, rewards, now],
        );
        await client.query(
          `UPDATE users AS u
           SET personal_block_height = COALESCE(u.personal_block_height, 0) + 1,
               last_active_block = $2,
               unclaimed_blocks_count = v.pending_count,
               mining_suspended = CASE WHEN v.suspend THEN true ELSE COALESCE(u.mining_suspended, false) END,
               mining_active = CASE WHEN v.suspend THEN false ELSE COALESCE(u.mining_active, false) END,
               locked_hash_power = CASE WHEN v.suspend THEN 0 ELSE u.locked_hash_power END,
               suspension_at_block = CASE WHEN v.suspend THEN $2 ELSE u.suspension_at_block END
           FROM UNNEST($1::uuid[], $3::int[], $4::boolean[]) AS v(user_id, pending_count, suspend)
           WHERE u.id = v.user_id`,
          [ids, nextHeight, pendingCounts, suspendFlags],
        );
      }
    }

    await client.query(
      `INSERT INTO system_settings (key,value,updated_at) VALUES ('totalBlockHeight',$1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
      [String(nextHeight), now],
    );
    const nextHalvingPeriod = Math.floor(nextHeight / 2160);
    let nextScheduledReward = new Decimal(3200).div(new Decimal(2).pow(nextHalvingPeriod));
    const remainingAfterThisBlock = MAX_SUPPLY.minus(totalMined).minus(reward);
    if (remainingAfterThisBlock.lte(0)) nextScheduledReward = new Decimal(0);
    else if (nextScheduledReward.gt(remainingAfterThisBlock)) nextScheduledReward = remainingAfterThisBlock;
    await client.query(
      `INSERT INTO system_settings (key,value,updated_at) VALUES ('blockReward',$1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
      [nextScheduledReward.toDecimalPlaces(8, Decimal.ROUND_DOWN).toFixed(8), now],
    );
    await client.query("COMMIT");

    totalBlockHeight = nextHeight;
    currentBlockReward = Number(nextScheduledReward.toString());
    console.log(`Block ${nextHeight} committed: reward=${reward.toFixed(8)} B2B, eligibleMiners=${eligibleUsers.length}, blockHashrate=${globalHashrate.toFixed(2)}.`);
    return blockInsert.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    console.error("Mining block transaction rolled back:", error);
    throw error;
  } finally {
    if (lockAcquired) {
      try { await client.query("SELECT pg_advisory_unlock($1, $2)", [423242, 1]); }
      finally { client.release(); }
    } else {
      client.release();
    }
  }
}

async function distributeBtcStakingRewards() {
  try {
    // Process daily BTC staking rewards
    await storage.processDailyBtcRewards();
    console.log("Daily BTC staking rewards distributed successfully");
  } catch (error) {
    console.error("Error distributing BTC staking rewards:", error);
  }
}

// Export for testing and admin triggering purposes
export async function forceGenerateBlock() {
  if (!isProcessingBlock) {
    isProcessingBlock = true;
    try {
      return await generateAndDistributeBlock();
    } catch (error) {
      console.error("Error in forced block generation:", error);
      throw error;
    } finally {
      isProcessingBlock = false;
    }
  } else {
    throw new Error("Block generation already in progress");
  }
}