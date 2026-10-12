import { 
  users, 
  deposits, 
  withdrawals, 
  miningBlocks, 
  systemSettings,
  unclaimedBlocks,
  minerActivity,
  transfers,
  btcStakes,
  btcStakingRewards,
  btcPriceHistory,
  btcConversions,
  devices,
  deviceFingerprints,
  userDevices,
  miningHistory,
  referralCodes,
  referralRewards,
  depositAddresses,
  userAddressAssignments,
  type User, 
  type InsertUser, 
  type Deposit, 
  type InsertDeposit,
  type Withdrawal,
  type InsertWithdrawal,
  type MiningBlock,
  type SystemSetting,
  type UnclaimedBlock,
  type Transfer,
  type MinerActivity,
  type BtcStake,
  type BtcStakingReward,
  type BtcPriceHistory,
  type Device,
  type InsertDevice,
  type DeviceFingerprint,
  type InsertDeviceFingerprint,
  type UserDevice,
  type InsertUserDevice,
  type MiningHistory,
  type InsertMiningHistory,
  type ReferralCode,
  type InsertReferralCode,
  type ReferralReward,
  type InsertReferralReward,
  type DepositAddress,
  type InsertDepositAddress,
  type UserAddressAssignment,
  type InsertUserAddressAssignment,
  auditLogs,
  type AuditLog,
  type InsertAuditLog
} from "@shared/schema";
import Decimal from "decimal.js";
import { db } from "./db";
import { eq, desc, sql, and, gte, inArray, asc, or } from "drizzle-orm";
import { randomBytes } from "crypto";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);
const PRIMARY_ADMIN_SETTING_KEY = "primaryAdminUserId";
const PRIMARY_ADMIN_LOCK_NAMESPACE = 31852;

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByAccessKey(accessKey: string): Promise<User | undefined>;
  getUsersByReferralCode(referralCode: string): Promise<User[]>;
  findUserByOwnReferralCode(referralCode: string): Promise<User | null>;
  ensurePrimaryAdmin(): Promise<void>;
  createUser(user: InsertUser): Promise<User>;
  hasIpRegistered(ip: string): Promise<boolean>;
  updateUserBalance(userId: string, usdtBalance: string, hashPower: string, b2bBalance: string, unclaimedBalance: string): Promise<void>;
  updateUser(userId: string, updates: Partial<User>): Promise<void>;
  freezeUser(userId: string): Promise<void>;
  unfreezeUser(userId: string): Promise<void>;
  banUser(userId: string): Promise<void>;
  unbanUser(userId: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  getEligibleMiners(limit?: number, offset?: number): Promise<User[]>;
  updateUserBalances(userId: string, balances: { usdtBalance?: string; b2bBalance?: string; hashPower?: string }): Promise<void>;

  // Audit Log methods
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  getDailyWithdrawalTotal(userId: string): Promise<number>;
  
  // Global deposit address methods
  getGlobalDepositAddress(currency: 'USDT' | 'BTC'): Promise<string>;
  setGlobalDepositAddress(currency: 'USDT' | 'BTC', address: string): Promise<void>;
  
  // Deposit methods
  createDeposit(deposit: InsertDeposit & { userId: string }): Promise<Deposit>;
  getPendingDeposits(): Promise<(Deposit & { user: User })[]>;
  approveDeposit(depositId: string, adminNote?: string, actualAmount?: string): Promise<void>;
  rejectDeposit(depositId: string, adminNote?: string): Promise<void>;
  
  // Withdrawal methods
  createWithdrawal(withdrawal: InsertWithdrawal & { userId: string }): Promise<Withdrawal>;
  getPendingWithdrawals(): Promise<any[]>;
  approveWithdrawal(withdrawalId: string, txHash?: string): Promise<void>;
  rejectWithdrawal(withdrawalId: string): Promise<void>;
  
  // Mining methods
  getLatestBlock(): Promise<MiningBlock | undefined>;
  getRecentBlocks(limit?: number): Promise<MiningBlock[]>;
  getBlocksMinedToday(): Promise<number>;
  getTotalHashPower(): Promise<string>;
  getGlobalEligibleHashPower(): Promise<string>;
  getUserMiningStatus(userId: string): Promise<{ personalBlockHeight: number; lastClaimedBlock: number | null; miningActive: boolean; blocksUntilSuspension: number }>;
  checkAndSuspendInactiveMiners(): Promise<void>;
  createMiningHistory(userId: string, blockNumber: number, lockedHashrate: string, reward: string): Promise<MiningHistory>;
  getUserMiningHistory(userId: string, limit?: number): Promise<Array<MiningHistory & { blockHash: string | null; globalHashrate: string | null; blockReward: string | null }>>;
  
  // System settings
  getSystemSetting(key: string): Promise<SystemSetting | undefined>;
  setSystemSetting(key: string, value: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  
  // Stats
  getUserCount(): Promise<number>;
  getTotalDeposits(): Promise<string>;
  getTotalWithdrawals(): Promise<string>;
  getActiveMinerCount(): Promise<number>;
  
  // Unclaimed blocks
  createUnclaimedBlock(userId: string, blockNumber: number, txHash: string, reward: string): Promise<UnclaimedBlock>;
  getUnclaimedBlocks(userId: string): Promise<any[]>;
  claimBlock(blockId: string, userId: string): Promise<{ success: boolean; reward?: string; resumed?: boolean }>;
  claimAllBlocks(userId: string): Promise<{ count: number; totalReward: string; suspended?: boolean; resumed?: boolean }>;
  
  // Transfers
  createTransfer(fromUserId: string, toUsername: string, amount: string): Promise<any>;
  
  // Miner activity
  getMinersStatus(): Promise<any[]>;
  updateMinerActivity(userId: string, claimed: boolean): Promise<void>;
  
  // Transaction fetching methods
  getUserDeposits(userId: string): Promise<Deposit[]>;
  getUserWithdrawals(userId: string): Promise<Withdrawal[]>;
  getSentTransfers(userId: string): Promise<Transfer[]>;
  getReceivedTransfers(userId: string): Promise<Transfer[]>;
  getAllTransactions(): Promise<any[]>;
  getAllDeposits(): Promise<(Deposit & { user?: User })[]>;
  getAllWithdrawals(): Promise<(Withdrawal & { user?: User })[]>;
  
  // Cooldown methods
  getDepositCooldown(userId: string): Promise<{ canDeposit: boolean; hoursRemaining: number }>;
  getWithdrawalCooldown(userId: string): Promise<{ canWithdraw: boolean; hoursRemaining: number }>;
  
  // Supply tracking methods
  getTotalMinedSupply(): Promise<string>;
  getCirculatingSupply(): Promise<string>;
  getSupplyMetrics(): Promise<{
    totalMined: string;
    circulating: string;
    maxSupply: string;
    percentageMined: string;
    currentBlockReward: string;
    totalBlocks: number;
    halvingProgress: { current: number; nextHalving: number; blocksRemaining: number };
  }>;
  
  // Conversion tracking
  createBtcConversion(userId: string, fromCurrency: string, toCurrency: string, fromAmount: string, toAmount: string, fee: string, rate: string): Promise<any>;
  convertBtcUsdt(userId: string, fromCurrency: "BTC" | "USDT", toCurrency: "BTC" | "USDT", amount: string, btcPrice: string): Promise<{ convertedAmount: string; fee: string; rate: string }>;
  getUserBtcConversions(userId: string): Promise<any[]>;
  
  // BTC Staking operations
  createBtcStakeAndDebitBalance(userId: string, btcAmount: string, requiredHashrateGh: string, btcPrice: string, months: number, apr: number, useHashrate: boolean): Promise<any>;
  getUserBtcStakes(userId: string): Promise<any[]>;
  getActiveBtcStakes(): Promise<any[]>;
  processDailyBtcRewards(): Promise<void>;
  getCurrentBtcPrice(): Promise<string>;
  updateBtcPrice(price: string, source?: string): Promise<void>;
  getSystemHashratePrice(): Promise<string>; // Price of 1 GH/s in BTC
  getUserBtcBalance(userId: string): Promise<string>;
  updateUserBtcBalance(userId: string, btcBalance: string): Promise<void>;

  // Device Fingerprinting methods
  upsertDevice(deviceData: { 
    serverDeviceId: string; 
    lastIp?: string; 
    asn?: string; 
    fingerprints: InsertDeviceFingerprint 
  }): Promise<{ device: Device; canRegister: boolean }>;
  findMatchingDevice(fingerprints: Omit<InsertDeviceFingerprint, 'deviceId'>): Promise<Device | null>;
  linkUserToDevice(userId: string, deviceId: string): Promise<void>;
  blockDevice(deviceId: string): Promise<void>;
  allowlistDevice(deviceId: string, maxRegistrations?: number): Promise<void>;
  resetDeviceRegistrations(deviceId: string): Promise<void>;
  
  // Referral code methods
  generateReferralCodes(userId: string, count: number): Promise<ReferralCode[]>;
  generateReferralCode(userId: string): Promise<ReferralCode>;
  getUserReferralCodes(userId: string): Promise<ReferralCode[]>;
  getAllReferralCodes(): Promise<ReferralCode[]>;
  getReferralCodeByCode(code: string): Promise<ReferralCode | null>;
  markReferralCodeUsed(code: string, usedBy: string): Promise<void>;
  
  // Referral reward methods
  createReferralReward(reward: InsertReferralReward): Promise<ReferralReward>;
  getUserUnclaimedRewards(userId: string): Promise<ReferralReward[]>;
  getUserReferralSlots(userId: string): Promise<any[]>;
  claimReferralRewards(userId: string): Promise<{ usdtClaimed: string; hashClaimed: string; count: number }>;  
  getUserReferralStats(userId: string): Promise<{ totalCodes: number; usedCodes: number; totalUsdtEarned: string; totalHashEarned: string; pendingUsdtRewards: string; pendingHashRewards: string }>;  
  
  // Deposit Address Management methods
  createDepositAddress(address: string): Promise<void>;
  assignDepositAddress(userId: string, currency: 'USDT' | 'BTC', network?: string): Promise<{
    address: string;
    assignedAt: Date;
    expiresAt: Date;
    isNewAssignment: boolean;
  }>;
  getUserAddressAssignment(userId: string, currency: 'USDT' | 'BTC', network?: string): Promise<UserAddressAssignment | null>;
  getRandomAvailableAddress(userId: string): Promise<{ 
    address: string | null; 
    canGetNewAddress: boolean; 
    hoursUntilNewAddress: number; 
  }>;
  releaseAddress(userId: string): Promise<void>;
  getDepositAddresses(): Promise<DepositAddress[]>;
  getAllActiveDepositAddresses(): Promise<DepositAddress[]>;
  bulkCreateAddresses(addresses: string[]): Promise<void>;
  deleteAddress(id: string): Promise<void>;
  updateAddressStatus(id: string, isActive: boolean): Promise<void>;
  
  sessionStore: session.Store;
  
  // Method to fix existing deposits with wrong status
  fixDepositStatuses(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    // Use PostgreSQL session store for persistent sessions across restarts
    this.sessionStore = new PostgresSessionStore({
      pool: pool,
      tableName: "session",
    });
  }
  
  async fixDepositStatuses(): Promise<void> {
    // Fix any deposits with "approved" status - only update status to "completed"
    // Do NOT re-credit balances here: approveDeposit already credits balances when called.
    // Any deposit stuck in "approved" was already credited at approval time.
    const approvedDeposits = await db
      .select()
      .from(deposits)
      .where(eq(deposits.status, "approved" as any));
    
    for (const deposit of approvedDeposits) {
      // Only update status - balance was already credited during approveDeposit
      await db
        .update(deposits)
        .set({ 
          status: "completed",
          updatedAt: new Date()
        })
        .where(eq(deposits.id, deposit.id));
    }
    
    console.log(`Fixed ${approvedDeposits.length} deposits with incorrect status`);
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }
  

  async getUserByAccessKey(accessKey: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.accessKey, accessKey));
    return user || undefined;
  }

  async getUsersByReferralCode(referralCode: string): Promise<User[]> {
    const owner = (await this.findUserByOwnReferralCode(referralCode)) || (await this.getUserByUsername(referralCode));
    const codes = [referralCode];
    if (owner) {
      if (owner.username && !codes.includes(owner.username)) codes.push(owner.username);
      if (owner.referralCode && !codes.includes(owner.referralCode)) codes.push(owner.referralCode);
    }
    return await db.select().from(users).where(sql`${users.referredBy} IN (${sql.join(codes.map(c => sql`${c}`), sql`, `)})`);
  }

  async findUserByOwnReferralCode(referralCode: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.referralCode, referralCode)).limit(1);
    return result[0] || null;
  }

  async ensurePrimaryAdmin(): Promise<void> {
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${PRIMARY_ADMIN_LOCK_NAMESPACE}, 1)`);

      const [claim] = await tx
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, PRIMARY_ADMIN_SETTING_KEY))
        .limit(1)
        .for("update");

      let primaryAdminId = claim?.value;
      if (!primaryAdminId) {
        const [firstUser] = await tx
          .select({ id: users.id })
          .from(users)
          .orderBy(asc(users.createdAt), asc(users.id))
          .limit(1);

        if (!firstUser) return;
        primaryAdminId = firstUser.id;
        await tx
          .insert(systemSettings)
          .values({ key: PRIMARY_ADMIN_SETTING_KEY, value: primaryAdminId })
          .onConflictDoNothing();
      }

      await tx
        .update(users)
        .set({ isAdmin: false })
        .where(sql`${users.isAdmin} IS TRUE AND ${users.id} <> ${primaryAdminId}`);
      await tx
        .update(users)
        .set({ isAdmin: true })
        .where(eq(users.id, primaryAdminId));
    });
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${PRIMARY_ADMIN_LOCK_NAMESPACE}, 1)`);

      const [claim] = await tx
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, PRIMARY_ADMIN_SETTING_KEY))
        .limit(1)
        .for("update");
      let primaryAdminId = claim?.value;

      if (!primaryAdminId) {
        const [firstUser] = await tx
          .select({ id: users.id })
          .from(users)
          .orderBy(asc(users.createdAt), asc(users.id))
          .limit(1);

        if (firstUser) {
          primaryAdminId = firstUser.id;
          await tx
            .insert(systemSettings)
            .values({ key: PRIMARY_ADMIN_SETTING_KEY, value: primaryAdminId })
            .onConflictDoNothing();
          await tx
            .update(users)
            .set({ isAdmin: true })
            .where(eq(users.id, primaryAdminId));
        }
      }

      if (primaryAdminId) {
        await tx
          .update(users)
          .set({ isAdmin: false })
          .where(sql`${users.isAdmin} IS TRUE AND ${users.id} <> ${primaryAdminId}`);
        await tx
          .update(users)
          .set({ isAdmin: true })
          .where(eq(users.id, primaryAdminId));
      }

      const receivesFirstAdminRole = !primaryAdminId;
      const [user] = await tx
        .insert(users)
        .values({
          ...insertUser,
          isAdmin: receivesFirstAdminRole,
          // The free starter is owned from registration; mining activation only starts earning.
          hashPower: "0.10",
          baseHashPower: "0.10",
          freeStarterGranted: insertUser.freeStarterGranted ?? true,
        })
        .returning();

      if (receivesFirstAdminRole) {
        await tx
          .insert(systemSettings)
          .values({ key: PRIMARY_ADMIN_SETTING_KEY, value: user.id })
          .onConflictDoNothing();
      }

      return user;
    });
  }

  async hasIpRegistered(ip: string): Promise<boolean> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.registrationIp, ip))
      .limit(1);
    return result.length > 0;
  }

  async updateUserBalance(userId: string, usdtBalance: string, hashPower: string, b2bBalance: string, unclaimedBalance: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        usdtBalance, 
        hashPower, 
        b2bBalance, 
        unclaimedBalance 
      })
      .where(eq(users.id, userId));
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<void> {
    await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId));
  }

  async freezeUser(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ isFrozen: true })
      .where(eq(users.id, userId));
  }

  async unfreezeUser(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ isFrozen: false })
      .where(eq(users.id, userId));
  }

  async banUser(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ isBanned: true })
      .where(eq(users.id, userId));
  }

  async unbanUser(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ isBanned: false })
      .where(eq(users.id, userId));
  }

  async getGlobalDepositAddress(currency: 'USDT' | 'BTC'): Promise<string> {
    const key = `${currency}_DEPOSIT_ADDRESS`;
    const setting = await this.getSystemSetting(key);
    if (currency === 'BTC') {
      return setting?.value || 'bc1qy8zzqsarhp0s63txsfnn3q3nvuu0g83mv3hwrv';
    }
    return setting?.value || 'TBGxYmP3tFrbKvJRvQcF9cENKixQeJdfQc';
  }

  async setGlobalDepositAddress(currency: 'USDT' | 'BTC', address: string): Promise<void> {
    const key = `${currency}_DEPOSIT_ADDRESS`;
    await this.setSystemSetting(key, address);
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getEligibleMiners(limit = 50, offset = 0): Promise<User[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
    const safeOffset = Math.max(0, Math.trunc(offset) || 0);
    return db.select().from(users)
      .where(sql`${users.miningActive} = true AND COALESCE(${users.miningSuspended}, false) = false AND COALESCE(${users.isFrozen}, false) = false AND COALESCE(${users.isBanned}, false) = false AND COALESCE(${users.lockedHashPower}, 0) > 0`)
      .orderBy(desc(users.lockedHashPower))
      .limit(safeLimit)
      .offset(safeOffset);
  }

  async updateUserBalances(userId: string, balances: { usdtBalance?: string; b2bBalance?: string; hashPower?: string }): Promise<void> {
    await db.transaction(async (tx: any) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
      const updates: any = {};
      if (balances.usdtBalance !== undefined) {
        const amount = new Decimal(balances.usdtBalance);
        if (!amount.isFinite() || amount.lt(0) || amount.gt("99999999.99")) throw Object.assign(new Error("USDT balance must be between 0 and 99,999,999.99."), { status: 400 });
        updates.usdtBalance = amount.toFixed(2);
      }
      if (balances.b2bBalance !== undefined) {
        const amount = new Decimal(balances.b2bBalance);
        if (!amount.isFinite() || amount.lt(0) || amount.gt("9999999999.99999999")) throw Object.assign(new Error("B2B balance is outside the supported range."), { status: 400 });
        updates.b2bBalance = amount.toFixed(8);
      }
      if (balances.hashPower !== undefined) {
        const target = new Decimal(balances.hashPower);
        const referralBonus = new Decimal(user.referralHashBonus || "0");
        if (!target.isFinite() || target.lt(referralBonus) || target.gt("99999999.99")) {
          throw Object.assign(new Error("Hashrate must be at least the existing referral bonus and within supported capacity."), { status: 400 });
        }
        // Keep the canonical invariant: owned power = base power + referral bonus.
        updates.hashPower = target.toFixed(2);
        updates.baseHashPower = target.minus(referralBonus).toFixed(2);
        updates.nextBlockHashPower = target.toFixed(2);
      }
      if (Object.keys(updates).length > 0) await tx.update(users).set(updates).where(eq(users.id, userId));
    });
  }

  async createDeposit(deposit: InsertDeposit & { userId: string }): Promise<Deposit> {
    const [newDeposit] = await db
      .insert(deposits)
      .values(deposit)
      .returning();
    return newDeposit;
  }

  async getPendingDeposits(): Promise<(Deposit & { user: User })[]> {
    const result = await db
      .select()
      .from(deposits)
      .innerJoin(users, eq(deposits.userId, users.id))
      .where(eq(deposits.status, "pending"))
      .orderBy(desc(deposits.createdAt));
    
    return result.map((row: any) => ({
      ...row.deposits,
      user: row.users
    }));
  }

  async approveDeposit(depositId: string, adminNote?: string, actualAmount?: string): Promise<void> {
    await db.transaction(async (tx: any) => {
      const [deposit] = await tx.select().from(deposits).where(eq(deposits.id, depositId)).for("update");
      if (!deposit) throw new Error("Deposit not found");
      if (deposit.status !== "pending") throw new Error("Deposit has already been processed");
      // Older BTC requests were saved with the default USDT currency; normalize
      // those pending requests based on their network before crediting a balance.
      const currency = deposit.network === "BTC" && deposit.currency === "USDT" ? "BTC" : (deposit.currency || "USDT");
      if (currency !== "USDT" && currency !== "BTC") throw new Error(`Unsupported deposit currency: ${currency}`);
      const amount = new Decimal(actualAmount ?? deposit.amount);
      const maxDecimals = currency === "BTC" ? 8 : 2;
      const maxAmount = currency === "BTC" ? "9999999999.99999999" : "99999999.99";
      if (!amount.isFinite() || !amount.gt(0) || amount.decimalPlaces() > maxDecimals || amount.gt(maxAmount)) {
        throw new Error(`Verified ${currency} deposit must be positive and use at most ${maxDecimals} decimal places.`);
      }
      const [userSnapshot] = await tx.select().from(users).where(eq(users.id, deposit.userId)).limit(1);
      if (!userSnapshot) throw new Error("User not found");
      let referrerSnapshot: any = null;
      if (currency === "USDT" && userSnapshot.referredBy) {
        const [candidate] = await tx.select().from(users)
          .where(or(eq(users.referralCode, userSnapshot.referredBy), eq(users.username, userSnapshot.referredBy)))
          .limit(1);
        if (candidate && candidate.id !== userSnapshot.id) referrerSnapshot = candidate;
      }
      const lockIds = [...new Set([userSnapshot.id, ...(referrerSnapshot ? [referrerSnapshot.id] : [])])].sort();
      const lockedUsers = await tx.select().from(users).where(inArray(users.id, lockIds)).orderBy(asc(users.id)).for("update");
      const user = lockedUsers.find((row: any) => row.id === userSnapshot.id);
      const referrer = referrerSnapshot ? lockedUsers.find((row: any) => row.id === referrerSnapshot.id) : undefined;
      if (!user) throw new Error("User not found");

      if (currency === "USDT") {
        const newBalance = new Decimal(user.usdtBalance || "0").plus(amount);
        if (newBalance.gt("99999999.99")) throw new Error("USDT balance exceeds supported account capacity.");
        await tx.update(users).set({ usdtBalance: newBalance.toFixed(2) }).where(eq(users.id, user.id));
      } else {
        const newBalance = new Decimal(user.btcBalance || "0").plus(amount);
        if (newBalance.gt("9999999999.99999999")) throw new Error("BTC balance exceeds supported account capacity.");
        await tx.update(users).set({ btcBalance: newBalance.toFixed(8) }).where(eq(users.id, user.id));
      }

      // Referral commission is denominated in USDT, so it applies only to USDT deposits.
      if (currency === "USDT" && referrer && referrer.id !== user.id) {
        const commission = amount.mul("0.10").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const referrerBalance = new Decimal(referrer.usdtBalance || "0").plus(commission);
        const referrerEarnings = new Decimal(referrer.totalReferralEarnings || "0").plus(commission);
        if (referrerBalance.gt("99999999.99") || referrerEarnings.gt("99999999.99")) {
          throw new Error("Referral commission exceeds supported account capacity.");
        }
        await tx.update(users).set({
          usdtBalance: referrerBalance.toFixed(2),
          totalReferralEarnings: referrerEarnings.toFixed(2),
        }).where(eq(users.id, referrer.id));
        await tx.insert(referralRewards).values({
          referrerId: referrer.id,
          referredUserId: user.id,
          usdtReward: commission.toFixed(2),
          hashReward: "0.00",
          purchaseAmount: amount.toFixed(2),
          purchaseHashrate: "0.00",
          isClaimed: true,
          claimedAt: new Date(),
        });
      }

      await tx.update(deposits).set({
        status: "completed",
        currency,
        adminNote,
        amount: amount.toFixed(maxDecimals),
        updatedAt: new Date(),
      }).where(eq(deposits.id, depositId));
    });
  }

  async rejectDeposit(depositId: string, adminNote?: string): Promise<void> {
    const [updated] = await db.update(deposits)
      .set({ status: "rejected", adminNote, updatedAt: new Date() })
      .where(sql`${deposits.id} = ${depositId} AND ${deposits.status} = 'pending'`)
      .returning({ id: deposits.id });
    if (!updated) throw new Error("Deposit not found or already processed");
  }

  async createWithdrawal(withdrawal: InsertWithdrawal & { userId: string }): Promise<Withdrawal> {
    const [newWithdrawal] = await db
      .insert(withdrawals)
      .values({
        ...withdrawal,
        status: 'pending' // All withdrawals start as pending
      })
      .returning();
    return newWithdrawal;
  }

  async getPendingWithdrawals(): Promise<any[]> {
    const result = await db
      .select({
        id: withdrawals.id,
        userId: withdrawals.userId,
        amount: withdrawals.amount,
        address: withdrawals.address,
        network: withdrawals.network,
        status: withdrawals.status,
        txHash: withdrawals.txHash,
        createdAt: withdrawals.createdAt,
        user: users
      })
      .from(withdrawals)
      .innerJoin(users, eq(withdrawals.userId, users.id))
      .where(eq(withdrawals.status, "pending"))
      .orderBy(desc(withdrawals.createdAt));
    
    return result;
  }

  async approveWithdrawal(withdrawalId: string, txHash?: string): Promise<void> {
    await db.transaction(async (tx: any) => {
      const [withdrawal] = await tx.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
      if (!withdrawal) throw new Error("Withdrawal not found");
      if (withdrawal.status !== "pending") throw new Error("Withdrawal has already been processed");

      const [user] = await tx.select().from(users).where(eq(users.id, withdrawal.userId)).for("update");
      if (!user) throw new Error("User not found");
      if (user.isFrozen || user.isBanned) throw new Error("Frozen or banned accounts cannot complete withdrawals.");
      const amount = new Decimal(withdrawal.amount);
      if (!amount.isFinite() || !amount.gt(0)) throw new Error("Invalid withdrawal amount");

      if (withdrawal.network === "BTC" && withdrawal.currency !== "BTC") {
        // Legacy BTC requests deducted BTC at submission and were stored with the
        // default USDT currency. Do not deduct a second time; normalize the record.
        await tx.update(withdrawals).set({ currency: "BTC" }).where(eq(withdrawals.id, withdrawalId));
      } else if (withdrawal.currency === "USDT") {
        if (amount.decimalPlaces() > 2) throw new Error("USDT withdrawals support at most 2 decimal places.");
        const balance = new Decimal(user.usdtBalance || "0");
        if (balance.lt(amount)) throw new Error("Insufficient USDT balance");
        await tx.update(users).set({ usdtBalance: balance.minus(amount).toFixed(2) }).where(eq(users.id, user.id));
      } else if (withdrawal.currency === "BTC") {
        if (amount.decimalPlaces() > 8) throw new Error("BTC withdrawals support at most 8 decimal places.");
        const balance = new Decimal(user.btcBalance || "0");
        if (balance.lt(amount)) throw new Error("Insufficient BTC balance");
        await tx.update(users).set({ btcBalance: balance.minus(amount).toFixed(8) }).where(eq(users.id, user.id));
      } else if (withdrawal.currency === "B2B") {
        if (amount.decimalPlaces() > 8) throw new Error("B2B withdrawals support at most 8 decimal places.");
        const balance = new Decimal(user.b2bBalance || "0");
        if (balance.lt(amount)) throw new Error("Insufficient B2B balance");
        await tx.update(users).set({ b2bBalance: balance.minus(amount).toFixed(8) }).where(eq(users.id, user.id));
      } else {
        throw new Error(`Unsupported withdrawal currency: ${withdrawal.currency}`);
      }

      await tx.update(withdrawals).set({ status: "completed", txHash: txHash || null })
        .where(eq(withdrawals.id, withdrawalId));
    });
  }

  async rejectWithdrawal(withdrawalId: string): Promise<void> {
    await db.transaction(async (tx: any) => {
      const [withdrawal] = await tx.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
      if (!withdrawal || withdrawal.status !== "pending") throw new Error("Withdrawal not found or already processed");
      if (withdrawal.network === "BTC" && withdrawal.currency !== "BTC") {
        // Legacy BTC requests deducted BTC before admin review; refund if rejected.
        const [user] = await tx.select().from(users).where(eq(users.id, withdrawal.userId)).for("update");
        if (!user) throw new Error("User not found");
        const balance = new Decimal(user.btcBalance || "0").plus(withdrawal.amount);
        await tx.update(users).set({ btcBalance: balance.toFixed(8) }).where(eq(users.id, user.id));
        await tx.update(withdrawals).set({ status: "rejected", currency: "BTC" }).where(eq(withdrawals.id, withdrawalId));
      } else {
        await tx.update(withdrawals).set({ status: "rejected" }).where(eq(withdrawals.id, withdrawalId));
      }
    });
  }

  async getUserMiningStatus(userId: string): Promise<{ personalBlockHeight: number; lastClaimedBlock: number | null; miningActive: boolean; blocksUntilSuspension: number }> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return { personalBlockHeight: 0, lastClaimedBlock: null, miningActive: false, blocksUntilSuspension: 0 };

    const [countRow] = await db.select({ count: sql<number>`COUNT(*)::int` })
      .from(unclaimedBlocks)
      .where(sql`${unclaimedBlocks.userId} = ${userId} AND ${unclaimedBlocks.claimed} IS NOT TRUE`);
    const pendingCount = Number(countRow?.count || 0);
    const limitReached = pendingCount >= 24;
    const shouldSuspend = limitReached && user.miningSuspended !== true;
    if (pendingCount !== Number(user.unclaimedBlocksCount || 0) || shouldSuspend) {
      await db.update(users).set({
        unclaimedBlocksCount: pendingCount,
        ...(shouldSuspend ? { miningSuspended: true, miningActive: false, lockedHashPower: "0.00", suspensionAtBlock: user.suspensionAtBlock || (await this.getLatestBlock())?.blockNumber || null } : {}),
      }).where(eq(users.id, userId));
      if (shouldSuspend) {
        user.miningSuspended = true;
        user.miningActive = false;
      }
      user.unclaimedBlocksCount = pendingCount;
    }
    return {
      personalBlockHeight: user.personalBlockHeight || 0,
      lastClaimedBlock: user.lastClaimedBlock,
      miningActive: user.hasStartedMining === true && user.miningActive === true && user.miningSuspended !== true && !user.isFrozen && !user.isBanned,
      blocksUntilSuspension: Math.max(0, 24 - pendingCount),
    };
  }

  async checkAndSuspendInactiveMiners(): Promise<void> {
    // The 24-unclaimed-block limit is enforced at block creation. Reconcile old rows
    // and suspend users whose ledger count already reached the limit.
    const inactiveUsers = await db.select().from(users)
      .where(sql`${users.miningActive} = true AND ${users.unclaimedBlocksCount} >= 24`);
    for (const user of inactiveUsers) {
      await db.update(users).set({
        miningActive: false,
        miningSuspended: true,
      }).where(eq(users.id, user.id));
    }
  }
  
  async createMiningHistory(userId: string, blockNumber: number, lockedHashrate: string, reward: string): Promise<MiningHistory> {
    const [history] = await db.insert(miningHistory).values({
      userId,
      blockNumber,
      lockedHashrate,
      reward,
    }).returning();
    return history;
  }
  
  async getUserMiningHistory(userId: string, limit: number = 50): Promise<Array<MiningHistory & { blockHash: string | null; globalHashrate: string | null; blockReward: string | null }>> {
    return await db.select({
      id: miningHistory.id,
      userId: miningHistory.userId,
      blockNumber: miningHistory.blockNumber,
      lockedHashrate: miningHistory.lockedHashrate,
      reward: miningHistory.reward,
      claimedAt: miningHistory.claimedAt,
      blockHash: miningBlocks.blockHash,
      globalHashrate: miningBlocks.globalHashrate,
      blockReward: miningBlocks.reward,
    })
      .from(miningHistory)
      .leftJoin(miningBlocks, eq(miningHistory.blockNumber, miningBlocks.blockNumber))
      .where(eq(miningHistory.userId, userId))
      .orderBy(desc(miningHistory.claimedAt))
      .limit(Math.max(1, Math.min(100, Math.trunc(limit) || 50)));
  }
  
  async getBlocksMinedToday(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(miningBlocks)
      .where(sql`${miningBlocks.timestamp} >= date_trunc('day', now() AT TIME ZONE 'UTC')`);
    return Number(row?.count || 0);
  }


  async getRecentBlocks(limit = 5): Promise<MiningBlock[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 5));
    return db.select().from(miningBlocks).orderBy(desc(miningBlocks.blockNumber)).limit(safeLimit);
  }

  async getLatestBlock(): Promise<MiningBlock | undefined> {
    const [block] = await db
      .select()
      .from(miningBlocks)
      .orderBy(desc(miningBlocks.blockNumber))
      .limit(1);
    return block || undefined;
  }

  async getTotalHashPower(): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${users.hashPower}), 0)` })
      .from(users);
    return result?.total || "0";
  }

  // Canonical network hashrate: only power eligible for the next block counts.
  // The user-facing hashPower remains their owned power; lockedHashPower is the
  // actual block snapshot power used for proportional reward distribution.
  async getGlobalEligibleHashPower(): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${users.lockedHashPower}), 0)::text` })
      .from(users)
      .where(sql`${users.miningActive} = true AND COALESCE(${users.miningSuspended}, false) = false AND COALESCE(${users.isFrozen}, false) = false AND COALESCE(${users.isBanned}, false) = false`);
    return result?.total || "0";
  }

  async getSystemSetting(key: string): Promise<SystemSetting | undefined> {
    const [setting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key));
    return setting || undefined;
  }

  async setSystemSetting(key: string, value: string): Promise<void> {
    if (key === PRIMARY_ADMIN_SETTING_KEY) {
      throw new Error("The primary administrator claim is reserved.");
    }

    await db
      .insert(systemSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() }
      });
  }

  async getUserCount(): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(users);
    return Number(result?.count || 0);
  }

  async getTotalDeposits(): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${deposits.amount}), 0)` })
      .from(deposits)
      .where(eq(deposits.status, "completed"));
    return result?.total || "0";
  }

  async getTotalWithdrawals(): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), 0)::text` })
      .from(withdrawals)
      .where(sql`${withdrawals.status} IN ('approved', 'completed', 'paid')`);
    return result?.total || "0.00";
  }
  
  async createUnclaimedBlock(userId: string, blockNumber: number, txHash: string, reward: string): Promise<UnclaimedBlock> {
    // A block ledger row is the source of truth. Do not mutate user counters here;
    // generation updates the counter exactly once after creating the row.
    const [block] = await db.insert(unclaimedBlocks).values({
      userId, blockNumber, txHash, reward, expiresAt: null,
    }).returning();
    return block;
  }

  async getUnclaimedBlocks(userId: string): Promise<UnclaimedBlock[]> {
    // No expiry check - rewards are permanent
    return await db.select()
      .from(unclaimedBlocks)
      .where(sql`${unclaimedBlocks.userId} = ${userId} AND ${unclaimedBlocks.claimed} IS NOT TRUE`)
      .orderBy(desc(unclaimedBlocks.createdAt));
  }
  
  async claimBlock(blockId: string, userId: string): Promise<{ success: boolean; reward?: string; resumed?: boolean }> {
    const result = await db.transaction(async (tx: any) => {
      // Lock user first, matching the block engine's user -> unclaimed-block lock order.
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) return { success: false as const };
      const [block] = await tx.update(unclaimedBlocks)
        .set({ claimed: true, claimedAt: new Date() })
        .where(sql`${unclaimedBlocks.id} = ${blockId} AND ${unclaimedBlocks.userId} = ${userId} AND ${unclaimedBlocks.claimed} IS NOT TRUE`)
        .returning();
      if (!block) return { success: false as const };

      const [countRow] = await tx.select({ count: sql<number>`COUNT(*)::int` })
        .from(unclaimedBlocks)
        .where(sql`${unclaimedBlocks.userId} = ${userId} AND ${unclaimedBlocks.claimed} IS NOT TRUE`);
      const remaining = Number(countRow?.count || 0);
      // Only auto-resume an account suspended by the 24-pending-block rule.
      // A manual/admin pause must survive claiming its last reward.
      const resume = remaining === 0 && user.miningSuspended === true && user.suspensionAtBlock != null &&
        user.hasStartedMining === true && !user.isFrozen && !user.isBanned;
      const updates: any = {
        b2bBalance: sql`COALESCE(${users.b2bBalance}, 0) + ${block.reward}`,
        lastClaimedBlock: block.blockNumber,
        lastActivityTime: new Date(),
        unclaimedBlocksCount: remaining,
      };
      if (resume) {
        updates.miningSuspended = false;
        updates.miningActive = true;
        updates.lockedHashPower = user.hashPower || "0.00";
        updates.nextBlockHashPower = user.hashPower || "0.00";
        updates.suspensionAtBlock = null;
      }
      await tx.update(users).set(updates).where(eq(users.id, userId));
      return { success: true as const, reward: block.reward, resumed: resume };
    });
    if (!result.success) return { success: false };
    await this.updateMinerActivity(userId, true);
    return { success: true, reward: result.reward, resumed: result.resumed };
  }

  async claimAllBlocks(userId: string): Promise<{ count: number; totalReward: string; suspended?: boolean; resumed?: boolean }> {
    const result = await db.transaction(async (tx: any) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) return { count: 0, totalReward: "0.00000000", suspended: false, resume: false };
      const blocks = await tx.update(unclaimedBlocks)
        .set({ claimed: true, claimedAt: new Date() })
        .where(sql`${unclaimedBlocks.userId} = ${userId} AND ${unclaimedBlocks.claimed} IS NOT TRUE`)
        .returning();
      const legacyPending = String(user.unclaimedBalance || "0");
      if (blocks.length === 0 && !(Number(legacyPending) > 0)) return { count: 0, totalReward: "0.00000000", suspended: Boolean(user.miningSuspended), resume: false };

      // Decimal strings are summed as integer 1e-8 token units to avoid float drift.
      const totalUnits = blocks.reduce((sum: bigint, block: any) => {
        const [whole, fraction = ""] = String(block.reward).split(".");
        return sum + BigInt(whole || "0") * 100_000_000n + BigInt((fraction + "00000000").slice(0, 8));
      }, 0n) + (() => {
        const [whole, fraction = ""] = legacyPending.split(".");
        return BigInt(whole || "0") * 100_000_000n + BigInt((fraction + "00000000").slice(0, 8));
      })();
      const totalReward = `${totalUnits / 100_000_000n}.${(totalUnits % 100_000_000n).toString().padStart(8, "0")}`;
      const maxBlockNumber = blocks.length > 0 ? Math.max(...blocks.map((block: any) => block.blockNumber)) : (user.lastClaimedBlock || 0);
      const resumeFromLimit = user.miningSuspended === true && user.suspensionAtBlock != null &&
        user.hasStartedMining === true && !user.isFrozen && !user.isBanned;
      const remainsActive = resumeFromLimit || (user.miningActive === true && !user.isFrozen && !user.isBanned);
      const remainsSuspended = resumeFromLimit ? false : Boolean(user.miningSuspended);
      await tx.update(users).set({
        b2bBalance: sql`COALESCE(${users.b2bBalance}, 0) + ${totalReward}`,
        lastClaimedBlock: maxBlockNumber,
        lastActivityTime: new Date(),
        unclaimedBlocksCount: 0,
        unclaimedBalance: "0.00000000",
        miningSuspended: remainsSuspended,
        miningActive: remainsActive,
        lockedHashPower: remainsActive ? (user.hashPower || "0.00") : "0.00",
        nextBlockHashPower: remainsActive ? (user.hashPower || "0.00") : "0.00",
        ...(resumeFromLimit ? { suspensionAtBlock: null } : {}),
      } as any).where(eq(users.id, userId));
      return { count: blocks.length, totalReward, suspended: remainsSuspended, resume: resumeFromLimit };
    });
    if (result.count > 0) {
      await this.updateMinerActivity(userId, true);
      }
    return { count: result.count, totalReward: result.totalReward, suspended: result.suspended, resumed: result.resume };
  }

  // Removed expireOldBlocks method - rewards never expire
  
  async createTransfer(fromUserId: string, toUsername: string, amount: string): Promise<Transfer> {
    const transferAmount = new Decimal(amount);
    if (!transferAmount.isFinite() || !transferAmount.gt(0) || transferAmount.decimalPlaces() > 8) {
      throw new Error("Transfer amount must be positive and use at most 8 decimal places.");
    }

    return db.transaction(async (tx: any) => {
      const [recipientSnapshot] = await tx.select().from(users).where(eq(users.username, toUsername)).limit(1);
      if (!recipientSnapshot) throw new Error("Recipient not found");
      if (recipientSnapshot.id === fromUserId) throw new Error("You cannot transfer B2B to yourself.");

      // Deterministic lock order prevents deadlocks and double-spend races.
      const ids = [fromUserId, recipientSnapshot.id].sort();
      const lockedUsers = await tx.select().from(users).where(inArray(users.id, ids)).orderBy(asc(users.id)).for("update");
      const sender = lockedUsers.find((user: any) => user.id === fromUserId);
      const recipient = lockedUsers.find((user: any) => user.id === recipientSnapshot.id);
      if (!sender) throw new Error("Sender not found");
      if (!recipient) throw new Error("Recipient not found");
      if (sender.isFrozen || sender.isBanned) throw new Error("Frozen or banned accounts cannot transfer B2B.");
      if (recipient.isFrozen || recipient.isBanned) throw new Error("Transfers to frozen or banned accounts are disabled.");

      const senderBalance = new Decimal(sender.b2bBalance || "0");
      if (senderBalance.lt(transferAmount)) throw new Error("Insufficient balance");
      const recipientBalance = new Decimal(recipient.b2bBalance || "0");
      const newSenderBalance = senderBalance.minus(transferAmount).toFixed(8);
      const newRecipientBalance = recipientBalance.plus(transferAmount).toFixed(8);
      await tx.update(users).set({ b2bBalance: newSenderBalance }).where(eq(users.id, sender.id));
      await tx.update(users).set({ b2bBalance: newRecipientBalance }).where(eq(users.id, recipient.id));

      // Internal ledger reference, not an on-chain transaction hash.
      const txHash = "0x" + randomBytes(32).toString("hex");
      const [transfer] = await tx.insert(transfers).values({
        fromUserId: sender.id,
        toUserId: recipient.id,
        amount: transferAmount.toFixed(8),
        txHash,
      }).returning();
      return transfer;
    });
  }

  async updateMinerActivity(userId: string, claimed: boolean): Promise<void> {
    const [activity] = await db.select()
      .from(minerActivity)
      .where(eq(minerActivity.userId, userId));
    
    if (!activity) {
      await db.insert(minerActivity).values({
        userId,
        lastClaimTime: claimed ? new Date() : null,
        totalClaims: claimed ? 1 : 0,
        missedClaims: claimed ? 0 : 1,
        isActive: claimed
      });
    } else {
      const now = new Date();
      const lastClaim = activity.lastClaimTime ? new Date(activity.lastClaimTime) : null;
      const hoursSinceLastClaim = lastClaim ? (now.getTime() - lastClaim.getTime()) / (1000 * 60 * 60) : 999;
      
      await db.update(minerActivity)
        .set({
          lastClaimTime: claimed ? now : activity.lastClaimTime,
          totalClaims: claimed ? (activity.totalClaims || 0) + 1 : (activity.totalClaims || 0),
          missedClaims: claimed ? (activity.missedClaims || 0) : (activity.missedClaims || 0) + 1,
          isActive: hoursSinceLastClaim < 48,
          updatedAt: now
        })
        .where(eq(minerActivity.userId, userId));
    }
  }
  
  async getMinersStatus(): Promise<(MinerActivity & { user: User })[]> {
    const result = await db.select({
      minerActivity,
      user: users
    })
    .from(minerActivity)
    .leftJoin(users, eq(minerActivity.userId, users.id));
    
    return result.map((r: any) => ({
      ...r.minerActivity,
      user: r.user!
    }));
  }
  
  async getActiveMinerCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`COUNT(*)::int` })
      .from(users)
      .where(sql`${users.miningActive} = true AND COALESCE(${users.miningSuspended}, false) = false AND COALESCE(${users.isFrozen}, false) = false AND COALESCE(${users.isBanned}, false) = false AND COALESCE(${users.lockedHashPower}, 0) > 0`);
    return Number(result?.count || 0);
  }
  
  async getUserDeposits(userId: string): Promise<Deposit[]> {
    return await db
      .select()
      .from(deposits)
      .where(eq(deposits.userId, userId))
      .orderBy(desc(deposits.createdAt));
  }
  
  async getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
    return await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId))
      .orderBy(desc(withdrawals.createdAt));
  }
  
  async getAllDeposits(): Promise<(Deposit & { user?: User })[]> {
    const result = await db
      .select()
      .from(deposits)
      .leftJoin(users, eq(deposits.userId, users.id))
      .orderBy(desc(deposits.createdAt));
    
    return result.map((row: any) => ({
      ...row.deposits,
      user: row.users || undefined
    }));
  }
  
  async getAllWithdrawals(): Promise<(Withdrawal & { user?: User })[]> {
    const result = await db
      .select()
      .from(withdrawals)
      .leftJoin(users, eq(withdrawals.userId, users.id))
      .orderBy(desc(withdrawals.createdAt));
    
    return result.map((row: any) => ({
      ...row.withdrawals,
      user: row.users || undefined,
      currency: row.withdrawals.currency || (row.withdrawals.network === 'BTC' ? 'BTC' : 
                 row.withdrawals.network === 'B2B' ? 'B2B' : 'USDT'),
      type: 'withdrawal' as const
    }));
  }
  
  async getSentTransfers(userId: string): Promise<Transfer[]> {
    const result = await db
      .select({
        transfer: transfers,
        toUser: users
      })
      .from(transfers)
      .leftJoin(users, eq(transfers.toUserId, users.id))
      .where(eq(transfers.fromUserId, userId))
      .orderBy(desc(transfers.createdAt));
    
    return result.map((r: any) => ({
      ...r.transfer,
      toUsername: r.toUser?.username || 'Unknown'
    }));
  }
  
  async getReceivedTransfers(userId: string): Promise<Transfer[]> {
    const result = await db
      .select({
        transfer: transfers,
        fromUser: users
      })
      .from(transfers)
      .leftJoin(users, eq(transfers.fromUserId, users.id))
      .where(eq(transfers.toUserId, userId))
      .orderBy(desc(transfers.createdAt));
    
    return result.map((r: any) => ({
      ...r.transfer,
      fromUsername: r.fromUser?.username || 'Unknown'
    }));
  }
  
  // For database storage, we'll return no cooldown for now (could be extended later)
  async getDepositCooldown(userId: string): Promise<{ canDeposit: boolean; hoursRemaining: number }> {
    return { canDeposit: true, hoursRemaining: 0 };
  }
  
  async getWithdrawalCooldown(userId: string): Promise<{ canWithdraw: boolean; hoursRemaining: number }> {
    return { canWithdraw: true, hoursRemaining: 0 };
  }
  
  // Supply tracking methods implementation
  async getTotalMinedSupply(): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${miningBlocks.reward}), 0)::text` })
      .from(miningBlocks);
    return result.total;
  }
  
  async getCirculatingSupply(): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${users.b2bBalance}), 0)::text` })
      .from(users);
    return result.total;
  }
  
  async getSupplyMetrics(): Promise<{
    totalMined: string;
    circulating: string;
    maxSupply: string;
    percentageMined: string;
    currentBlockReward: string;
    totalBlocks: number;
    halvingProgress: { current: number; nextHalving: number; blocksRemaining: number };
  }> {
    try {
      const MAX_SUPPLY = 21000000; // 21M B2B max supply
      const HALVING_INTERVAL = 2160; // Blocks between halvings (3 months: 24 blocks/day × 90 days)
      
      // Get total mined supply
      const totalMined = await this.getTotalMinedSupply();
      
      // Get circulating supply
      const circulating = await this.getCirculatingSupply();
      
      // Get current block reward
      const blockRewardSetting = await this.getSystemSetting("blockReward");
      const currentBlockReward = blockRewardSetting ? blockRewardSetting.value : "3200";
      
      // The mining_blocks table is the sole authority for block height.
      const latestBlock = await this.getLatestBlock();
      const totalBlocks = latestBlock?.blockNumber || 0;
      
      // Calculate halving progress
      const currentHalvingPeriod = totalBlocks > 0 ? Math.floor((totalBlocks - 1) / HALVING_INTERVAL) : 0;
      const nextHalving = (currentHalvingPeriod + 1) * HALVING_INTERVAL + 1;
      const blocksRemaining = Math.max(0, nextHalving - totalBlocks);
      
      // Calculate percentage mined
      const percentageMined = ((parseFloat(totalMined) / MAX_SUPPLY) * 100).toFixed(2);
      
      return {
        totalMined,
        circulating,
        maxSupply: MAX_SUPPLY.toString(),
        percentageMined,
        currentBlockReward,
        totalBlocks,
        halvingProgress: {
          current: currentHalvingPeriod,
          nextHalving,
          blocksRemaining
        }
      };
    } catch (error) {
      console.error("Error getting supply metrics:", error);
      throw error;
    }
  }
  
  async createBtcConversion(userId: string, fromCurrency: string, toCurrency: string, fromAmount: string, toAmount: string, fee: string, rate: string): Promise<any> {
    const [conversion] = await db.insert(btcConversions).values({
      userId,
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      fee,
      rate,
    }).returning();
    return conversion;
  }

  async convertBtcUsdt(
    userId: string,
    fromCurrency: "BTC" | "USDT",
    toCurrency: "BTC" | "USDT",
    amountValue: string,
    btcPriceValue: string,
  ): Promise<{ convertedAmount: string; fee: string; rate: string }> {
    if (fromCurrency === toCurrency) throw new Error("Choose two different currencies.");
    const amount = new Decimal(amountValue);
    const btcPrice = new Decimal(btcPriceValue);
    if (!amount.isFinite() || !amount.gt(0) || !btcPrice.isFinite() || !btcPrice.gt(0)) {
      throw new Error("A valid amount and live BTC price are required.");
    }
    const amountDecimals = fromCurrency === "BTC" ? 8 : 2;
    if (amount.decimalPlaces() > amountDecimals) throw new Error(`${fromCurrency} amount supports at most ${amountDecimals} decimal places.`);

    return db.transaction(async (tx: any) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new Error("User not found");
      if (user.isFrozen || user.isBanned) throw new Error("Frozen or banned accounts cannot convert balances.");

      const feeRate = new Decimal("0.0001");
      let convertedAmount: Decimal;
      let fee: Decimal;
      if (fromCurrency === "BTC" && toCurrency === "USDT") {
        const btcBalance = new Decimal(user.btcBalance || "0");
        if (btcBalance.lt(amount)) throw new Error("Insufficient BTC balance");
        const grossUsdt = amount.mul(btcPrice);
        fee = grossUsdt.mul(feeRate).toDecimalPlaces(2, Decimal.ROUND_DOWN);
        convertedAmount = grossUsdt.minus(fee).toDecimalPlaces(2, Decimal.ROUND_DOWN);
        const newUsdtBalance = new Decimal(user.usdtBalance || "0").plus(convertedAmount);
        if (newUsdtBalance.gt("99999999.99")) throw new Error("USDT balance exceeds supported account capacity.");
        await tx.update(users).set({
          btcBalance: btcBalance.minus(amount).toFixed(8),
          usdtBalance: newUsdtBalance.toFixed(2),
        }).where(eq(users.id, user.id));
      } else {
        const usdtBalance = new Decimal(user.usdtBalance || "0");
        if (usdtBalance.lt(amount)) throw new Error("Insufficient USDT balance");
        const grossBtc = amount.div(btcPrice);
        fee = grossBtc.mul(feeRate).toDecimalPlaces(8, Decimal.ROUND_DOWN);
        convertedAmount = grossBtc.minus(fee).toDecimalPlaces(8, Decimal.ROUND_DOWN);
        const newBtcBalance = new Decimal(user.btcBalance || "0").plus(convertedAmount);
        if (newBtcBalance.gt("9999999999.99999999")) throw new Error("BTC balance exceeds supported account capacity.");
        await tx.update(users).set({
          usdtBalance: usdtBalance.minus(amount).toFixed(2),
          btcBalance: newBtcBalance.toFixed(8),
        }).where(eq(users.id, user.id));
      }

      await tx.insert(btcConversions).values({
        userId,
        fromCurrency,
        toCurrency,
        fromAmount: amount.toFixed(amountDecimals),
        toAmount: convertedAmount.toFixed(toCurrency === "BTC" ? 8 : 2),
        fee: fee.toFixed(toCurrency === "BTC" ? 8 : 2),
        rate: btcPrice.toFixed(8),
      });
      return {
        convertedAmount: convertedAmount.toFixed(toCurrency === "BTC" ? 8 : 2),
        fee: fee.toFixed(toCurrency === "BTC" ? 8 : 2),
        rate: btcPrice.toString(),
      };
    });
  }
  
  async getUserBtcConversions(userId: string): Promise<any[]> {
    return db.select().from(btcConversions).where(eq(btcConversions.userId, userId)).orderBy(desc(btcConversions.createdAt));
  }

  // BTC Staking methods
  async createBtcStakeAndDebitBalance(
    userId: string,
    btcAmountValue: string,
    requiredHashrateGh: string,
    btcPriceValue: string,
    months: number,
    apr: number,
    useHashrate: boolean,
  ): Promise<any> {
    const amount = new Decimal(btcAmountValue);
    const requiredHashrate = new Decimal(requiredHashrateGh);
    const price = new Decimal(btcPriceValue);
    if (!amount.isFinite() || amount.lt("0.1") || !requiredHashrate.isFinite() || requiredHashrate.lt(0) ||
        !price.isFinite() || price.lte(0) || !Number.isInteger(months) || months < 1 || months > 24 ||
        !Number.isFinite(apr) || apr < 0 || apr > 100) {
      throw Object.assign(new Error("Invalid BTC stake parameters."), { status: 400 });
    }

    return db.transaction(async (tx: any) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
      if (user.isFrozen || user.isBanned) throw Object.assign(new Error("Frozen or banned accounts cannot create stakes."), { status: 403 });
      const balance = new Decimal(user.btcBalance || "0");
      if (balance.lt(amount)) throw Object.assign(new Error("Insufficient BTC balance."), { status: 400 });
      if (useHashrate) {
        const availableGh = new Decimal(user.hashPower || "0").div(1000);
        if (availableGh.lt(requiredHashrate)) {
          throw Object.assign(new Error(`Insufficient hashrate. Need ${requiredHashrate.toFixed(6)} GH/s but you have ${availableGh.toFixed(6)} GH/s.`), { status: 400 });
        }
      }

      const dailyReward = amount.mul(apr).div(100).div(365).toDecimalPlaces(8, Decimal.ROUND_DOWN).toFixed(8);
      const unlockAt = new Date();
      unlockAt.setMonth(unlockAt.getMonth() + months);
      const [stake] = await tx.insert(btcStakes).values({
        userId,
        btcAmount: amount.toFixed(8),
        b2bHashrate: useHashrate ? requiredHashrate.toFixed(6) : "0.000000",
        btcPriceAtStake: price.toFixed(2),
        aprRate: apr.toFixed(2),
        dailyReward,
        unlockAt,
      }).returning();
      await tx.update(users).set({ btcBalance: balance.minus(amount).toFixed(8) }).where(eq(users.id, userId));
      return stake;
    });
  }

  async getUserBtcStakes(userId: string): Promise<any[]> {
    const stakes = await db
      .select()
      .from(btcStakes)
      .where(eq(btcStakes.userId, userId))
      .orderBy(desc(btcStakes.stakedAt));

    return stakes;
  }

  async getActiveBtcStakes(): Promise<any[]> {
    const stakes = await db
      .select()
      .from(btcStakes)
      .where(eq(btcStakes.status, 'active'));

    return stakes;
  }

  async processDailyBtcRewards(): Promise<void> {
    const currentBtcPrice = await this.getCurrentBtcPrice();
    const now = new Date();
    const utcDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // A transaction-scoped advisory lock prevents multiple app instances paying the
    // same daily batch concurrently. lastRewardAt makes same-day retries idempotent.
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(423242, 2)`);
      const activeStakes = await tx.select().from(btcStakes)
        .where(eq(btcStakes.status, "active"))
        .orderBy(asc(btcStakes.id))
        .for("update");

      for (const stake of activeStakes) {
        // Return principal exactly once after lock expiry, in the same transaction
        // that marks the stake completed. Never keep paying rewards after unlock.
        if (stake.unlockAt && new Date(stake.unlockAt).getTime() <= now.getTime()) {
          await tx.update(users)
            .set({ btcBalance: sql`COALESCE(${users.btcBalance}, 0) + ${stake.btcAmount}` })
            .where(eq(users.id, stake.userId));
          await tx.update(btcStakes)
            .set({ status: "completed" })
            .where(eq(btcStakes.id, stake.id));
          continue;
        }
        if (stake.lastRewardAt && new Date(stake.lastRewardAt).getTime() >= utcDayStart.getTime()) continue;
        const reward = new Decimal(stake.dailyReward || "0");
        if (!reward.isFinite() || !reward.gt(0)) continue;

        // Ledger row, user credit, and stake checkpoint commit or roll back together.
        await tx.insert(btcStakingRewards).values({
          stakeId: stake.id,
          userId: stake.userId,
          rewardAmount: reward.toFixed(8),
          btcPrice: currentBtcPrice,
        });
        await tx.update(users)
          .set({ btcBalance: sql`COALESCE(${users.btcBalance}, 0) + ${reward.toFixed(8)}` })
          .where(eq(users.id, stake.userId));
        await tx.update(btcStakes)
          .set({
            totalRewardsPaid: sql`COALESCE(${btcStakes.totalRewardsPaid}, 0) + ${reward.toFixed(8)}`,
            lastRewardAt: now,
          })
          .where(eq(btcStakes.id, stake.id));
      }
    });
  }

  async getCurrentBtcPrice(): Promise<string> {
    // Get latest BTC price from history
    const [latestPrice] = await db
      .select()
      .from(btcPriceHistory)
      .orderBy(desc(btcPriceHistory.timestamp))
      .limit(1);

    if (latestPrice) {
      return latestPrice.price;
    }

    // If no price history, fetch from API
    const price = await fetchRealBtcPrice();
    await this.updateBtcPrice(price, 'api');
    return price;
  }

  async updateBtcPrice(price: string, source: string = 'system'): Promise<void> {
    await db.insert(btcPriceHistory).values({
      price,
      source,
    });
  }

  async getSystemHashratePrice(): Promise<string> {
    // Calculate price of 1 GH/s based on BTC price
    const btcPrice = await this.getCurrentBtcPrice();
    // 1 BTC worth of hashrate = btcPrice / 1000 (assuming 1000 GH/s = 1 BTC equivalent)
    const pricePerGH = (parseFloat(btcPrice) / 1000).toFixed(8);
    return pricePerGH;
  }

  async getUserBtcBalance(userId: string): Promise<string> {
    const user = await this.getUser(userId);
    return user?.btcBalance || '0.00000000';
  }

  async updateUserBtcBalance(userId: string, btcBalance: string): Promise<void> {
    await db
      .update(users)
      .set({ btcBalance })
      .where(eq(users.id, userId));
  }

  // Device Fingerprinting methods
  async upsertDevice(deviceData: { 
    serverDeviceId: string; 
    lastIp?: string; 
    asn?: string; 
    fingerprints: InsertDeviceFingerprint 
  }): Promise<{ device: Device; canRegister: boolean }> {
    const { serverDeviceId, lastIp, asn, fingerprints } = deviceData;
    
    // Check if device already exists
    let [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.serverDeviceId, serverDeviceId));

    if (!device) {
      // Check for matching fingerprints first
      const matchingDevice = await this.findMatchingDevice(fingerprints);
      
      if (matchingDevice) {
        // Update existing device with new serverDeviceId
        await db
          .update(devices)
          .set({ 
            serverDeviceId, 
            lastSeen: new Date(),
            lastIp: lastIp || null,
            asn: asn || null
          })
          .where(eq(devices.id, matchingDevice.id));
        
        device = { ...matchingDevice, serverDeviceId, lastSeen: new Date(), lastIp: lastIp || null, asn: asn || null };
      } else {
        // Create new device
        [device] = await db
          .insert(devices)
          .values({
            serverDeviceId,
            lastIp: lastIp || null,
            asn: asn || null,
          })
          .returning();
      }

      // Add fingerprints
      await db
        .insert(deviceFingerprints)
        .values({
          ...fingerprints,
          deviceId: device.id,
        });
    } else {
      // Update existing device
      await db
        .update(devices)
        .set({ 
          lastSeen: new Date(),
          lastIp: lastIp || null,
          asn: asn || null
        })
        .where(eq(devices.id, device.id));
    }

    const canRegister = !device.blocked && device.registrations === 0;
    return { device, canRegister };
  }

  async findMatchingDevice(fingerprints: Omit<InsertDeviceFingerprint, 'deviceId'>): Promise<Device | null> {
    // Check for exact stable hash match (highest confidence)
    if (fingerprints.stableHash) {
      const exactMatch = await db
        .select({ device: devices })
        .from(deviceFingerprints)
        .innerJoin(devices, eq(deviceFingerprints.deviceId, devices.id))
        .where(eq(deviceFingerprints.stableHash, fingerprints.stableHash))
        .limit(1);
      
      if (exactMatch.length > 0) {
        return exactMatch[0].device;
      }
    }

    // Check for WebGL + Fonts combination (high confidence)
    if (fingerprints.webglHash && fingerprints.fontsHash) {
      const webglFontsMatch = await db
        .select({ device: devices })
        .from(deviceFingerprints)
        .innerJoin(devices, eq(deviceFingerprints.deviceId, devices.id))
        .where(sql`${deviceFingerprints.webglHash} = ${fingerprints.webglHash} AND ${deviceFingerprints.fontsHash} = ${fingerprints.fontsHash}`)
        .limit(1);
      
      if (webglFontsMatch.length > 0) {
        return webglFontsMatch[0].device;
      }
    }

    return null;
  }

  async linkUserToDevice(userId: string, deviceId: string): Promise<void> {
    // Check if link already exists
    const existing = await db
      .select()
      .from(userDevices)
      .where(sql`${userDevices.userId} = ${userId} AND ${userDevices.deviceId} = ${deviceId}`)
      .limit(1);

    if (existing.length === 0) {
      await db
        .insert(userDevices)
        .values({ userId, deviceId });
    }

    // Increment device registration count
    await db
      .update(devices)
      .set({ 
        registrations: sql`${devices.registrations} + 1`
      })
      .where(eq(devices.id, deviceId));
  }

  async blockDevice(deviceId: string): Promise<void> {
    await db
      .update(devices)
      .set({ blocked: true })
      .where(eq(devices.id, deviceId));
  }

  async allowlistDevice(deviceId: string, maxRegistrations: number = 2): Promise<void> {
    await db
      .update(devices)
      .set({ 
        blocked: false,
        registrations: 0 // Reset registrations for allowlisted device
      })
      .where(eq(devices.id, deviceId));
  }

  async resetDeviceRegistrations(deviceId: string): Promise<void> {
    await db
      .update(devices)
      .set({ 
        registrations: 0 // Reset registrations to allow new account creation
      })
      .where(eq(devices.serverDeviceId, deviceId));
  }

  // Referral code methods
  async generateReferralCodes(userId: string, count: number): Promise<ReferralCode[]> {
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new Error("Referral code count must be an integer between 1 and 100.");
    }
    return db.transaction(async (tx: any) => {
      const codes: ReferralCode[] = [];
      for (let i = 0; i < count; i++) {
        let created: ReferralCode | undefined;
        // Unique constraint plus conflict retry makes concurrent code creation safe.
        for (let attempt = 0; attempt < 8 && !created; attempt++) {
          const code = randomBytes(4).toString("hex").toUpperCase();
          const [row] = await tx.insert(referralCodes)
            .values({ code, ownerId: userId })
            .onConflictDoNothing({ target: referralCodes.code })
            .returning();
          created = row;
        }
        if (!created) throw new Error("Could not allocate a unique referral code. Please retry.");
        codes.push(created);
      }
      const [updatedUser] = await tx.update(users)
        .set({ totalReferralCodes: sql`COALESCE(${users.totalReferralCodes}, 0) + ${count}` })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!updatedUser) throw new Error("User not found while generating referral codes.");
      return codes;
    });
  }

  async getUserReferralCodes(userId: string): Promise<ReferralCode[]> {
    return await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.ownerId, userId))
      .orderBy(desc(referralCodes.createdAt));
  }

  async getReferralCodeByCode(code: string): Promise<ReferralCode | null> {
    const [referralCode] = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.code, code))
      .limit(1);
    return referralCode || null;
  }

  async markReferralCodeUsed(code: string, usedBy: string): Promise<void> {
    await db
      .update(referralCodes)
      .set({ 
        isUsed: true, 
        usedBy,
        usedAt: new Date()
      })
      .where(eq(referralCodes.code, code));
  }


  // Referral reward methods
  async createReferralReward(reward: InsertReferralReward): Promise<ReferralReward> {
    const [referralReward] = await db
      .insert(referralRewards)
      .values(reward)
      .returning();
    
    // Update unclaimed rewards for the referrer (new rewards default to unclaimed)
    const referrer = await this.getUser(reward.referrerId);
    if (referrer) {
      await db
        .update(users)
        .set({
          unclaimedReferralUsdt: (parseFloat(referrer.unclaimedReferralUsdt || '0') + parseFloat(reward.usdtReward)).toFixed(2),
          unclaimedReferralHash: (parseFloat(referrer.unclaimedReferralHash || '0') + parseFloat(reward.hashReward)).toFixed(2)
        })
        .where(eq(users.id, reward.referrerId));
    }
    
    return referralReward;
  }

  async getUserUnclaimedRewards(userId: string): Promise<ReferralReward[]> {
    return await db
      .select()
      .from(referralRewards)
      .where(sql`${referralRewards.referrerId} = ${userId} AND ${referralRewards.isClaimed} IS NOT TRUE`)
      .orderBy(desc(referralRewards.createdAt));
  }

  async getUserReferralSlots(userId: string): Promise<any[]> {
    const codes = await this.getUserReferralCodes(userId);
    const usedCodes = codes.filter(c => c.isUsed);
    
    const slots = [];
    for (const code of usedCodes) {
      if (!code.usedBy) continue;
      
      const referredUser = await this.getUser(code.usedBy);
      if (!referredUser) continue;
      
      const rewards = await db
        .select()
        .from(referralRewards)
        .where(sql`${referralRewards.referrerId} = ${userId} AND ${referralRewards.referredUserId} = ${code.usedBy}`)
        .orderBy(desc(referralRewards.createdAt));
      
      const pendingRewards = rewards.filter((r: any) => !r.isClaimed);
      const pendingUsdt = pendingRewards.reduce((sum: number, r: any) => sum + parseFloat(r.usdtReward), 0);
      const pendingHash = pendingRewards.reduce((sum: number, r: any) => sum + parseFloat(r.hashReward), 0);
      
      slots.push({
        code: code.code,
        username: referredUser.username,
        userId: referredUser.id,
        hashPower: referredUser.hashPower,
        isActive: referredUser.hasPaidPurchase || false,
        joinedAt: code.usedAt,
        pendingUsdtRewards: pendingUsdt.toFixed(2),
        pendingHashRewards: pendingHash.toFixed(2),
        totalRewards: rewards.length
      });
    }
    
    return slots;
  }

  async claimReferralRewards(userId: string): Promise<{ usdtClaimed: string; hashClaimed: string; count: number }> {
    return db.transaction(async (tx: any) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new Error("User not found");
      if (user.isFrozen || user.isBanned) throw new Error("Frozen or banned accounts cannot claim referral rewards.");

      // Claim rows and credit balances in one transaction; a concurrent request cannot pay them twice.
      const rewards = await tx.update(referralRewards)
        .set({ isClaimed: true, claimedAt: new Date() })
        .where(sql`${referralRewards.referrerId} = ${userId} AND ${referralRewards.isClaimed} IS NOT TRUE`)
        .returning();
      if (rewards.length === 0) return { usdtClaimed: "0.00", hashClaimed: "0.00", count: 0 };

      const totalUsdt = rewards.reduce((sum: Decimal, reward: any) => sum.plus(reward.usdtReward || "0"), new Decimal(0));
      const totalHash = rewards.reduce((sum: Decimal, reward: any) => sum.plus(reward.hashReward || "0"), new Decimal(0));
      const usdtBalance = new Decimal(user.usdtBalance || "0").plus(totalUsdt);
      const totalReferralEarnings = new Decimal(user.totalReferralEarnings || "0").plus(totalUsdt);
      const referralHashBonus = new Decimal(user.referralHashBonus || "0").plus(totalHash);
      const baseHashPower = new Decimal(user.baseHashPower || "0");
      const hashPower = baseHashPower.plus(referralHashBonus);
      if (usdtBalance.gt("99999999.99") || totalReferralEarnings.gt("99999999.99") || hashPower.gt("99999999.99")) {
        throw new Error("Claimed referral rewards exceed supported account capacity.");
      }
      const active = user.miningActive === true && user.miningSuspended !== true && user.isFrozen !== true && user.isBanned !== true;
      await tx.update(users).set({
        usdtBalance: usdtBalance.toFixed(2),
        hashPower: hashPower.toFixed(2),
        referralHashBonus: referralHashBonus.toFixed(2),
        totalReferralEarnings: totalReferralEarnings.toFixed(2),
        unclaimedReferralUsdt: "0.00",
        unclaimedReferralHash: "0.00",
        ...(active ? { nextBlockHashPower: hashPower.toFixed(2) } : {}),
      }).where(eq(users.id, userId));
      return { usdtClaimed: totalUsdt.toFixed(2), hashClaimed: totalHash.toFixed(2), count: rewards.length };
    });
  }

  async getUserReferralStats(userId: string): Promise<{ totalCodes: number; usedCodes: number; totalUsdtEarned: string; totalHashEarned: string; pendingUsdtRewards: string; pendingHashRewards: string }> {
    const user = await this.getUser(userId);
    if (!user) {
      return {
        totalCodes: 0,
        usedCodes: 0,
        totalUsdtEarned: '0',
        totalHashEarned: '0',
        pendingUsdtRewards: '0',
        pendingHashRewards: '0'
      };
    }
    
    const codes = await this.getUserReferralCodes(userId);
    const usedCodes = codes.filter(c => c.isUsed).length;
    
    const allRewards = await db
      .select()
      .from(referralRewards)
      .where(eq(referralRewards.referrerId, userId));
    
    const claimedRewards = allRewards.filter((r: any) => r.isClaimed);
    const totalUsdtEarned = claimedRewards.reduce((sum: number, r: any) => sum + parseFloat(r.usdtReward), 0);
    const totalHashEarned = claimedRewards.reduce((sum: number, r: any) => sum + parseFloat(r.hashReward), 0);
    
    return {
      totalCodes: user.totalReferralCodes || 0,
      usedCodes,
      totalUsdtEarned: totalUsdtEarned.toFixed(2),
      totalHashEarned: totalHashEarned.toFixed(2),
      pendingUsdtRewards: user.unclaimedReferralUsdt || '0',
      pendingHashRewards: user.unclaimedReferralHash || '0'
    };
  }


  // Implementation of missing admin methods
  async getSetting(key: string): Promise<string | null> {
    const setting = await this.getSystemSetting(key);
    return setting ? setting.value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.setSystemSetting(key, value);
  }

  async getAllTransactions(): Promise<any[]> {
    // Get all deposits
    const allDeposits = await db
      .select({
        id: deposits.id,
        type: sql<string>`'deposit'`,
        userId: deposits.userId,
        username: users.username,
        amount: deposits.amount,
        currency: deposits.currency,
        status: deposits.status,
        txHash: deposits.txHash,
        network: deposits.network,
        createdAt: deposits.createdAt
      })
      .from(deposits)
      .leftJoin(users, eq(deposits.userId, users.id))
      .orderBy(desc(deposits.createdAt));

    // Get all withdrawals
    const allWithdrawals = await db
      .select({
        id: withdrawals.id,
        type: sql<string>`'withdrawal'`,
        userId: withdrawals.userId,
        username: users.username,
        amount: withdrawals.amount,
        currency: sql<string>`CASE WHEN ${withdrawals.network} IN ('ERC20', 'BSC', 'TRC20') THEN 'USDT' ELSE 'B2B' END`,
        status: withdrawals.status,
        txHash: withdrawals.txHash,
        network: withdrawals.network,
        createdAt: withdrawals.createdAt
      })
      .from(withdrawals)
      .leftJoin(users, eq(withdrawals.userId, users.id))
      .orderBy(desc(withdrawals.createdAt));

    // Get all transfers
    const allTransfers = await db
      .select({
        id: transfers.id,
        type: sql<string>`'transfer'`,
        userId: transfers.fromUserId,
        username: users.username,
        amount: transfers.amount,
        currency: sql<string>`'B2B'`,
        status: sql<string>`'completed'`,
        txHash: sql<string>`NULL`,
        network: sql<string>`'internal'`,
        createdAt: transfers.createdAt
      })
      .from(transfers)
      .leftJoin(users, eq(transfers.fromUserId, users.id))
      .orderBy(desc(transfers.createdAt));

    // Combine all transactions and sort by date
    const allTransactions = [...allDeposits, ...allWithdrawals, ...allTransfers]
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

    return allTransactions;
  }

  async generateReferralCode(userId: string): Promise<ReferralCode> {
    // Generate a single referral code using the existing method
    const codes = await this.generateReferralCodes(userId, 1);
    return codes[0];
  }

  async getAllReferralCodes(): Promise<ReferralCode[]> {
    return await db
      .select()
      .from(referralCodes)
      .orderBy(desc(referralCodes.createdAt));
  }

  // Deposit Address Management implementations
  async createDepositAddress(address: string): Promise<void> {
    await db
      .insert(depositAddresses)
      .values({ address, isActive: true });
  }

  async assignDepositAddress(userId: string, currency: 'USDT' | 'BTC', network?: string): Promise<{
    address: string;
    assignedAt: Date;
    expiresAt: Date;
    isNewAssignment: boolean;
  }> {
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Check if user has an existing assignment within 24 hours for this currency+network
    const existingAssignment = await db
      .select()
      .from(userAddressAssignments)
      .where(
        and(
          eq(userAddressAssignments.userId, userId),
          eq(userAddressAssignments.currency, currency),
          network ? eq(userAddressAssignments.network, network) : sql`${userAddressAssignments.network} IS NULL`,
          gte(userAddressAssignments.expiresAt, now)
        )
      )
      .limit(1);

    if (existingAssignment.length > 0) {
      // Return existing assignment that's still valid
      const assignment = existingAssignment[0];
      return {
        address: assignment.address,
        assignedAt: assignment.assignedAt!,
        expiresAt: assignment.expiresAt,
        isNewAssignment: false
      };
    }

    // Get a random available address from the pool
    const availableAddresses = await db
      .select()
      .from(depositAddresses)
      .where(eq(depositAddresses.isActive, true));

    if (availableAddresses.length === 0) {
      throw new Error('No available deposit addresses in the pool');
    }

    // Select a random address
    const randomIndex = Math.floor(Math.random() * availableAddresses.length);
    const selectedAddress = availableAddresses[randomIndex];

    // Create new assignment
    const [newAssignment] = await db
      .insert(userAddressAssignments)
      .values({
        userId,
        currency,
        network,
        address: selectedAddress.address,
        expiresAt: twentyFourHoursFromNow
      })
      .returning();

    return {
      address: newAssignment.address,
      assignedAt: newAssignment.assignedAt!,
      expiresAt: newAssignment.expiresAt,
      isNewAssignment: true
    };
  }

  async getUserAddressAssignment(userId: string, currency: 'USDT' | 'BTC', network?: string): Promise<UserAddressAssignment | null> {
    const now = new Date();
    
    const result = await db
      .select()
      .from(userAddressAssignments)
      .where(
        and(
          eq(userAddressAssignments.userId, userId),
          eq(userAddressAssignments.currency, currency),
          network ? eq(userAddressAssignments.network, network) : sql`${userAddressAssignments.network} IS NULL`,
          gte(userAddressAssignments.expiresAt, now)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  async getRandomAvailableAddress(userId: string): Promise<{ 
    address: string | null; 
    canGetNewAddress: boolean; 
    hoursUntilNewAddress: number; 
  }> {
    // Simplified version - just return a random active address
    // No cooldown, no user assignment tracking
    
    const activeAddresses = await db
      .select()
      .from(depositAddresses)
      .where(eq(depositAddresses.isActive, true));
    
    if (activeAddresses.length === 0) {
      return {
        address: null,
        canGetNewAddress: true,
        hoursUntilNewAddress: 0
      };
    }
    
    // Pick a random address from the pool
    const randomIndex = Math.floor(Math.random() * activeAddresses.length);
    const selectedAddress = activeAddresses[randomIndex];
    
    return {
      address: selectedAddress.address,
      canGetNewAddress: true,
      hoursUntilNewAddress: 0
    };
  }

  async releaseAddress(userId: string): Promise<void> {
    // CRITICAL SECURITY FIX: This method is now a no-op
    // Addresses are permanently assigned and should NEVER be released
    // Keeping the method to avoid breaking existing code, but it does nothing
    
    // Log warning if this method is called (for debugging)
    console.warn(`Warning: releaseAddress() called for userId ${userId} but addresses are now permanently assigned`);
    return;
  }

  async getDepositAddresses(): Promise<DepositAddress[]> {
    return await db
      .select()
      .from(depositAddresses)
      .orderBy(desc(depositAddresses.createdAt));
  }

  async getAllActiveDepositAddresses(): Promise<DepositAddress[]> {
    return await db
      .select()
      .from(depositAddresses)
      .where(eq(depositAddresses.isActive, true))
      .orderBy(desc(depositAddresses.createdAt));
  }

  async bulkCreateAddresses(addresses: string[]): Promise<void> {
    if (addresses.length === 0) return;
    
    // SECURITY FIX: Filter out duplicates and validate addresses
    const uniqueAddresses = Array.from(new Set(addresses));
    const validAddresses = uniqueAddresses.filter(address => {
      // Validate address format (ERC20/BSC or TRON)
      const isValidERC20 = /^0x[a-fA-F0-9]{40}$/.test(address);
      const isValidTRON = /^T[A-Za-z1-9]{33}$/.test(address);
      return isValidERC20 || isValidTRON;
    });
    
    if (validAddresses.length === 0) {
      console.log('No valid addresses to insert');
      return;
    }
    
    const values = validAddresses.map(address => ({
      address,
      isActive: true
    }));
    
    // Skip duplicates silently (since address has unique constraint)
    const result = await db
      .insert(depositAddresses)
      .values(values)
      .onConflictDoNothing()
      .returning();
    
    console.log(`Bulk insert: ${result.length} new addresses added out of ${validAddresses.length} provided`);
  }

  async deleteAddress(id: string): Promise<void> {
    await db
      .delete(depositAddresses)
      .where(eq(depositAddresses.id, id));
  }

  async updateAddressStatus(id: string, isActive: boolean): Promise<void> {
    await db
      .update(depositAddresses)
      .set({ 
        isActive,
        updatedAt: new Date()
      })
      .where(eq(depositAddresses.id, id));
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [entry] = await db
      .insert(auditLogs)
      .values(log)
      .returning();
    return entry;
  }

  async getAuditLogs(limit = 100): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async getDailyWithdrawalTotal(userId: string): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const userWithdrawals = await db
      .select()
      .from(withdrawals)
      .where(and(
        eq(withdrawals.userId, userId),
        gte(withdrawals.createdAt, oneDayAgo)
      ));
    return userWithdrawals.reduce((sum: number, w: any) => {
      if (w.status !== 'rejected') {
        return sum + parseFloat(w.amount || '0');
      }
      return sum;
    }, 0);
  }
}

// Cache for BTC price to avoid rate limiting
let btcPriceCache: { price: string; timestamp: number } | null = null;
const CACHE_DURATION = 30000; // Cache for 30 seconds

// Helper function to fetch real BTC price
export async function fetchRealBtcPrice(): Promise<string> {
  try {
    // Check cache first
    if (btcPriceCache && Date.now() - btcPriceCache.timestamp < CACHE_DURATION) {
      return btcPriceCache.price;
    }

    // Fetch from CoinGecko's free API (no API key required)
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    
    if (!response.ok) {
      throw new Error('Failed to fetch BTC price');
    }
    
    const data = await response.json();
    const price = data.bitcoin?.usd;
    
    if (!price) {
      throw new Error('Invalid price data');
    }
    
    // Cache the price
    btcPriceCache = {
      price: price.toFixed(2),
      timestamp: Date.now()
    };
    
    return price.toFixed(2);
  } catch (error) {
    console.error('Error fetching BTC price:', error);
    throw new Error("Live BTC price is unavailable; refusing to use a fabricated price.", { cause: error });
  }
}

// Storage variables will be initialized during server startup

async function testDatabaseConnection(): Promise<boolean> {
  if (!process.env.DATABASE_URL || !pool) {
    return false;
  }
  try {
    // Test database connection with a simple query
    const result = await db.execute(sql`SELECT 1 as test`);
    console.log('✅ Database connection test successful');
    return true;
  } catch (error: any) {
    console.warn('Database connection test failed:', error.message);
    return false;
  }
}

// Initialize storage (will be set during server startup)
let storage: IStorage;

// Export the initialization function to be called during server startup
export async function initStorage() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; BIT2BLOCK cannot start without PostgreSQL.");
  }

  const dbAvailable = await testDatabaseConnection();
  if (!dbAvailable) {
    throw new Error("PostgreSQL is unavailable; BIT2BLOCK cannot start without persistent storage.");
  }

  storage = new DatabaseStorage();
  console.log("PostgreSQL storage initialized.");
  return storage;
}

export { storage };
