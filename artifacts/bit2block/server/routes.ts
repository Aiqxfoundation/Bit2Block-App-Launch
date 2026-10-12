import { Router } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { setupAuth, generateUniqueAccessKey, hashAccessKey, verifyAccessKey, serializeUserForClient } from "./auth";
import { setupMining, forceGenerateBlock } from "./mining";
import { setupAutomatedBackups, generateSystemBackup, listBackups, getBackupContent } from "./backup";
import type { Request, Response, NextFunction, Express } from "express";
import { insertDepositSchema, insertWithdrawalSchema, insertDeviceFingerprintSchema, users, referralRewards, unclaimedBlocks } from "@shared/schema";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import Decimal from "decimal.js";
import { db } from "./db";
import { eq, sql, or, inArray, asc, and } from "drizzle-orm";
import { randomBytes, scrypt } from "crypto";
import { promisify } from "util";
import { 
  generateBase32Secret, 
  getTotpUri, 
  verifyTotpToken, 
  isValidTxHash, 
  normalizeTxHash 
} from "./security";

const asyncScrypt = promisify(scrypt);

async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await asyncScrypt(pin, salt, 32) as Buffer;
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  try {
    const [saltHex, hashHex] = hashedPin.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const hash = await asyncScrypt(pin, salt, 32) as Buffer;
    return hash.toString('hex') === hashHex;
  } catch {
    return false;
  }
}

export async function registerRoutes(app: Express) {
  // Setup authentication first
  setupAuth(app);
  
  // Enable Node.js mining engine
  await setupMining();
  
  // Enable automated daily database backups
  setupAutomatedBackups();
  
  // Create HTTP server
  const server = createServer(app);
  
  // WebSocket server for live mining updates
  const wss = new WebSocketServer({ noServer: true });
  const activeWsClients = new Map<WebSocket, string>();

  // Handle WebSocket upgrade requests
  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        activeWsClients.set(ws, '');

        ws.send(JSON.stringify({
          type: 'connection',
          timestamp: new Date().toISOString(),
          data: { status: 'connected' }
        }));

        ws.on('message', async (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'auth' && parsed.userId) {
              activeWsClients.set(ws, parsed.userId);
              const user = await storage.getUser(parsed.userId);
              if (user) {
                const miningStatus = await storage.getUserMiningStatus(parsed.userId);
                const pendingBlocks = await storage.getUnclaimedBlocks(parsed.userId);
                const unclaimedRewards = pendingBlocks.reduce((sum, block) => sum.plus(block.reward || "0"), new Decimal(0)).toFixed(8);
                ws.send(JSON.stringify({
                  type: 'user_mining_update',
                  timestamp: new Date().toISOString(),
                  data: {
                    userId: user.id,
                    personalBlockHeight: user.personalBlockHeight || 0,
                    unclaimedRewards,
                    hashPower: user.hashPower || "0",
                    blocksParticipated: user.personalBlockHeight || 0,
                    lastReward: "0",
                    miningActive: miningStatus.miningActive,
                    blocksUntilSuspension: miningStatus.blocksUntilSuspension,
                    unclaimedBlocksCount: user.unclaimedBlocksCount || 0,
                    miningSuspended: user.miningSuspended || false
                  }
                }));
              }
            }
          } catch (e) {
            // Ignore malformed messages
          }
        });

        ws.on('close', () => {
          activeWsClients.delete(ws);
        });

        ws.on('error', () => {
          activeWsClients.delete(ws);
        });
      });
    }
  });

  // Periodic broadcast of block updates every 15 seconds
  setInterval(async () => {
    try {
      const latestBlock = await storage.getLatestBlock();
      const totalHash = await storage.getGlobalEligibleHashPower();
      const activeCount = await storage.getActiveMinerCount();
      const blockHeight = latestBlock?.blockNumber || 0;
      const totalReward = latestBlock?.reward ?? "0";
      
      const message = JSON.stringify({
        type: 'block_update',
        timestamp: new Date().toISOString(),
        data: {
          blockHeight,
          totalReward,
          totalHashPower: totalHash,
          activeMiners: activeCount,
          nextBlockTime: new Date(latestBlock?.timestamp ? new Date(latestBlock.timestamp).getTime() + 3600000 : Date.now() + 60000).toISOString(),
          globalHashrate: totalHash
        }
      });

      for (const client of Array.from(activeWsClients.keys())) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    } catch {
      // ignore broadcast errors
    }
  }, 15000);
  
  // Device fingerprinting endpoints
  app.post("/api/device/check", async (req, res, next) => {
    try {
      const deviceCheckSchema = z.object({
        serverDeviceId: z.string().min(1),
        fingerprints: insertDeviceFingerprintSchema.omit({ deviceId: true })
      });
      
      const { serverDeviceId, fingerprints } = deviceCheckSchema.parse(req.body);
      
      // Get client IP and basic network info
      const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.toString().split(',')[0];
      
      // Check device and determine if it can register
      const result = await storage.upsertDevice({
        serverDeviceId,
        lastIp: clientIp,
        fingerprints: {
          ...fingerprints,
          deviceId: '' // Will be set by storage
        }
      });
      
      res.json({
        deviceId: result.device.id,
        canRegister: result.canRegister,
        registrations: result.device.registrations,
        blocked: result.device.blocked,
        riskScore: result.device.riskScore
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid device data format",
          errors: error.errors 
        });
      }
      next(error);
    }
  });

  app.post("/api/device/link", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const linkSchema = z.object({
        deviceId: z.string().min(1)
      });
      
      const { deviceId } = linkSchema.parse(req.body);
      
      // Link user to device (called after successful registration)
      await storage.linkUserToDevice(req.user!.id, deviceId);
      
      res.json({ success: true });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid device ID format" 
        });
      }
      next(error);
    }
  });

  // Admin device management endpoints
  app.post("/api/admin/device/:deviceId/block", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { deviceId } = req.params;
      await storage.blockDevice(deviceId);
      
      res.json({ success: true, message: "Device has been blocked" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/device/:deviceId/allowlist", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allowlistSchema = z.object({
        maxRegistrations: z.number().min(1).max(10).optional().default(2)
      });
      
      const { maxRegistrations } = allowlistSchema.parse(req.body);
      const { deviceId } = req.params;
      
      await storage.allowlistDevice(deviceId, maxRegistrations);
      
      res.json({ 
        success: true, 
        message: `Device has been allowlisted with ${maxRegistrations} max registrations` 
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid allowlist parameters" 
        });
      }
      next(error);
    }
  });
  
  // Get user endpoint with hash zeroing for suspended/frozen users

  // Get wallet balances with proper decimal precision
  app.get("/api/wallet/balances", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const userId = req.user!.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get pending transactions
      const deposits = await storage.getUserDeposits(userId);
      const withdrawals = await storage.getUserWithdrawals(userId);
      const unclaimedBlocks = await storage.getUnclaimedBlocks(userId);

      // Calculate pending amounts using Decimal for precision
      let pendingUsdtDeposits = new Decimal(0);
      let pendingBtcDeposits = new Decimal(0);
      let pendingUsdtWithdrawals = new Decimal(0);
      let pendingBtcWithdrawals = new Decimal(0);
      let pendingB2bWithdrawals = new Decimal(0);
      let unclaimedB2b = new Decimal(0);

      // Calculate pending deposits - filter by currency server-side
      for (const deposit of deposits) {
        if (deposit.status === 'pending') {
          if (deposit.currency === 'BTC') {
            pendingBtcDeposits = pendingBtcDeposits.plus(deposit.amount || 0);
          } else if (deposit.currency === 'USDT') {
            pendingUsdtDeposits = pendingUsdtDeposits.plus(deposit.amount || 0);
          }
        }
      }

      // Calculate pending withdrawals - filter by currency server-side
      for (const withdrawal of withdrawals) {
        if (withdrawal.status === 'pending') {
          if (withdrawal.currency === 'BTC') {
            pendingBtcWithdrawals = pendingBtcWithdrawals.plus(withdrawal.amount || 0);
          } else if (withdrawal.currency === 'B2B') {
            pendingB2bWithdrawals = pendingB2bWithdrawals.plus(withdrawal.amount || 0);
          } else if (withdrawal.currency === 'USDT') {
            pendingUsdtWithdrawals = pendingUsdtWithdrawals.plus(withdrawal.amount || 0);
          }
        }
      }

      // Calculate unclaimed B2B rewards
      for (const block of unclaimedBlocks) {
        unclaimedB2b = unclaimedB2b.plus(block.reward || 0);
      }

      // Calculate available balances (balance - pending withdrawals) using Decimal
      const usdtBalance = new Decimal(user.usdtBalance || "0");
      const btcBalance = new Decimal(user.btcBalance || "0");
      const b2bBalance = new Decimal(user.b2bBalance || "0");
      
      // Available balance is total balance minus pending withdrawals
      const availableUsdt = Decimal.max(0, usdtBalance.minus(pendingUsdtWithdrawals));
      const availableBtc = Decimal.max(0, btcBalance.minus(pendingBtcWithdrawals));
      const availableB2b = Decimal.max(0, b2bBalance.minus(pendingB2bWithdrawals));

      // Convert to strings only at final output to preserve precision
      // Return flat object structure that client expects
      res.json({
        btcBalance: user.btcBalance || "0",
        usdtBalance: user.usdtBalance || "0",
        b2bBalance: user.b2bBalance || "0"
      });
    } catch (error) {
      next(error);
    }
  });

  // Get deposit cooldown status
  app.get("/api/deposits/cooldown", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const cooldown = await storage.getDepositCooldown(req.user!.id);
      res.json(cooldown);
    } catch (error) {
      next(error);
    }
  });

  // Get withdrawal cooldown status
  app.get("/api/withdrawals/cooldown", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const cooldown = await storage.getWithdrawalCooldown(req.user!.id);
      res.json(cooldown);
    } catch (error) {
      next(error);
    }
  });

  // Get all users (admin only)
  app.get("/api/users", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const users = await storage.getAllUsers();
      res.json(users.map(serializeUserForClient));
    } catch (error) {
      next(error);
    }
  });
  
  // Admin endpoint to force-generate blocks for testing
  app.post("/api/admin/force-generate-blocks", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { count = 1 } = req.body;
      const blocksToGenerate = Math.min(Math.max(1, parseInt(count) || 1), 50);

      for (let i = 0; i < blocksToGenerate; i++) {
        await forceGenerateBlock();
        if (i < blocksToGenerate - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      res.json({ success: true, message: `Generated ${blocksToGenerate} block(s) successfully` });
    } catch (error) {
      next(error);
    }
  });

  // Admin endpoint to fix deposit statuses
  app.post("/api/admin/fix-deposit-statuses", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Run the fix for existing deposits with incorrect status
      await storage.fixDepositStatuses();
      
      res.json({ 
        success: true, 
        message: "Deposit statuses have been fixed. Any deposits with 'approved' status have been updated to 'completed' and balances adjusted." 
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Admin dashboard stats
  app.get("/api/admin/stats", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const [userCount, totalDeposits, totalWithdrawals, totalHashPower] = await Promise.all([
        storage.getUserCount(),
        storage.getTotalDeposits(),
        storage.getTotalWithdrawals(),
        storage.getTotalHashPower()
      ]);

      res.json({
        userCount,
        totalDeposits,
        totalWithdrawals,
        totalHashPower
      });
    } catch (error) {
      next(error);
    }
  });

  // Get all users with details for admin
  app.get("/api/admin/users", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const users = await storage.getAllUsers();
      res.json(users.map(serializeUserForClient));
    } catch (error) {
      next(error);
    }
  });

  // Get active miners (actively mining users)
  app.get("/api/admin/miners/active", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const users = await storage.getAllUsers();
      // Filter for active miners: hashPower > 0, hasStartedMining = true, not banned, not frozen
      const activeMiners = users.filter(user => {
        const hashPower = parseFloat(user.hashPower || "0");
        return hashPower > 0 &&
               user.hasStartedMining === true &&
               user.miningActive === true &&
               user.miningSuspended !== true &&
               user.isBanned !== true &&
               user.isFrozen !== true;
      });

      res.json(activeMiners.map(serializeUserForClient));
    } catch (error) {
      next(error);
    }
  });

  // Get inactive miners (have hash power but not mining)
  app.get("/api/admin/miners/inactive", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const users = await storage.getAllUsers();
      // Filter for inactive miners: hashPower > 0 BUT (hasStartedMining = false OR frozen = true)
      const inactiveMiners = users.filter(user => {
        const hashPower = parseFloat(user.hashPower || "0");
        return hashPower > 0 &&
               (user.hasStartedMining !== true || user.miningActive !== true || user.miningSuspended === true || user.isFrozen === true) &&
               user.isBanned !== true; // Exclude banned users from inactive list
      });

      res.json(inactiveMiners.map(serializeUserForClient));
    } catch (error) {
      next(error);
    }
  });

  // Get default miners (only have base 100 KH/s)
  app.get("/api/admin/miners/default", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const users = await storage.getAllUsers();
      // Internal unit is MH/s: the free starter power is 0.10 MH/s = 100 KH/s.
      const defaultMiners = users.filter(user => {
        const hashPower = Number(user.hashPower || 0);
        const baseHashPower = Number(user.baseHashPower || 0);
        const referralBonus = Number(user.referralHashBonus || 0);
        return Math.abs(hashPower - 0.1) < 0.000001 &&
               Math.abs(baseHashPower - 0.1) < 0.000001 &&
               Math.abs(referralBonus) < 0.000001;
      });

      res.json(defaultMiners.map(serializeUserForClient));
    } catch (error) {
      next(error);
    }
  });

  // Get all transactions for admin
  app.get("/api/admin/transactions", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const transactions = await storage.getAllTransactions();
      
      // Add userId field to each transaction for easier filtering
      const enhancedTransactions = transactions.map(t => ({
        ...t,
        userId: t.userId || (t.type === 'deposit' || t.type === 'withdrawal' ? t.userId : 
                t.type === 'transfer_out' ? t.fromUser : 
                t.type === 'transfer_in' ? t.toUser : null)
      }));
      
      res.json(enhancedTransactions);
    } catch (error) {
      next(error);
    }
  });

  // Get all referral codes for admin - REMOVED
  // The admin referrals feature has been removed from the admin dashboard
  /*
  app.get("/api/admin/referral-codes", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const codes = await storage.getAllReferralCodes();
      res.json(codes);
    } catch (error) {
      next(error);
    }
  });

  // Alias for referral codes - admin/referrals
  app.get("/api/admin/referrals", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const codes = await storage.getAllReferralCodes();
      res.json(codes);
    } catch (error) {
      next(error);
    }
  });
  */

  // Generate referral code for a user - DISABLED
  // This endpoint has been disabled as per request to prevent new referral code generation
  /*
  app.post("/api/admin/generate-referral-code", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ message: "Username required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const code = await storage.generateReferralCode(user.id);
      res.json(code);
    } catch (error) {
      next(error);
    }
  });
  */

  // Get system settings for admin
  app.get("/api/admin/system-settings", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const settings = {
        hashratePrice: await storage.getSetting("hashratePrice") || "1.00",
        miningPaused: await storage.getSetting("miningPaused") === "true",
        blockReward: await storage.getSetting("blockReward") || "50"
      };
      
      res.json(settings);
    } catch (error) {
      next(error);
    }
  });

  // Update hashrate price
  app.post("/api/admin/update-hashrate-price", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { price } = req.body;
      if (!price || isNaN(parseFloat(price))) {
        return res.status(400).json({ message: "Valid price required" });
      }

      await storage.setSetting("hashratePrice", price.toString());
      res.json({ success: true, price });
    } catch (error) {
      next(error);
    }
  });

  // Also support PUT method
  app.put("/api/admin/update-hashrate-price", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { price } = req.body;
      if (!price || isNaN(parseFloat(price))) {
        return res.status(400).json({ message: "Valid price required" });
      }

      await storage.setSetting("hashratePrice", price.toString());
      res.json({ success: true, price });
    } catch (error) {
      next(error);
    }
  });

  // Toggle global mining pause/resume
  app.post("/api/admin/toggle-global-mining", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { pause } = req.body;
      await storage.setSetting("miningPaused", pause ? "true" : "false");
      res.json({ success: true, paused: pause });
    } catch (error) {
      next(error);
    }
  });

  // Also support PUT method
  app.put("/api/admin/toggle-global-mining", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { pause } = req.body;
      await storage.setSetting("miningPaused", pause ? "true" : "false");
      res.json({ success: true, paused: pause });
    } catch (error) {
      next(error);
    }
  });

  // Suspend/Resume user mining
  app.patch("/api/admin/users/:userId/suspend-mining", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userId } = req.params;
      await storage.updateUser(userId, { miningActive: false });
      res.json({ success: true, message: "User mining suspended" });
    } catch (error) {
      next(error);
    }
  });

  // Support PUT method
  app.put("/api/admin/users/:userId/suspend-mining", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userId } = req.params;
      await storage.updateUser(userId, { miningActive: false });
      res.json({ success: true, message: "User mining suspended" });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/users/:userId/resume-mining", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userId } = req.params;
      await storage.updateUser(userId, { miningActive: true, miningSuspended: false, unclaimedBlocksCount: 0 });
      res.json({ success: true, message: "User mining resumed" });
    } catch (error) {
      next(error);
    }
  });

  // Support PUT method
  app.put("/api/admin/users/:userId/resume-mining", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userId } = req.params;
      await storage.updateUser(userId, { miningActive: true, miningSuspended: false, unclaimedBlocksCount: 0 });
      res.json({ success: true, message: "User mining resumed" });
    } catch (error) {
      next(error);
    }
  });

  // Deposit endpoints
  app.post("/api/deposits", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const depositData = insertDepositSchema.parse(req.body);
      const deposit = await storage.createDeposit({
        ...depositData,
        userId: req.user!.id
      });

      res.status(201).json(deposit);
    } catch (error: any) {
      if (error?.message?.includes('wait')) {
        return res.status(429).json({ message: error.message });
      }
      if (error?.code === '23505' || error?.message?.includes('deposits_tx_hash_unique') || error?.message?.includes('unique constraint')) {
        return res.status(400).json({ message: "This transaction hash has already been submitted. Please check your transaction and try again with a different hash." });
      }
      next(error);
    }
  });

  // Automated deposit detection / verification simulation (USDT TRC20, ERC20, BSC)
  app.post("/api/deposits/auto-check", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { txHash, network } = req.body;
      if (!txHash) {
        return res.status(400).json({ message: "Transaction hash is required" });
      }

      const isValid = isValidTxHash(txHash, network || "TRC20");
      if (!isValid) {
        return res.status(400).json({ 
          valid: false, 
          message: `Invalid ${network || 'TRC20'} transaction hash format` 
        });
      }

      // Strict duplicate check across all existing deposits
      const allDeposits = await storage.getAllDeposits();
      const cleanInput = txHash.trim().toLowerCase();
      const duplicate = allDeposits.find(d => d.txHash && d.txHash.toLowerCase() === cleanInput);
      if (duplicate) {
        return res.status(400).json({ 
          valid: false, 
          duplicate: true, 
          message: "This transaction hash has already been registered." 
        });
      }

      return res.status(503).json({
        valid: false,
        verified: false,
        code: "CHAIN_VERIFIER_NOT_CONFIGURED",
        network: network || "TRC20",
        message: "On-chain verification is unavailable. No deposit has been confirmed or credited."
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/deposits", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const deposits = await storage.getAllDeposits();
      res.json(deposits.map(({ user, ...deposit }) => ({
        ...deposit,
        user: user ? serializeUserForClient(user) : undefined,
      })));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/withdrawals", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const withdrawals = await storage.getAllWithdrawals();
      res.json(withdrawals.map(({ user, ...withdrawal }) => ({
        ...withdrawal,
        user: user ? serializeUserForClient(user) : undefined,
      })));
    } catch (error) {
      next(error);
    }
  });

  // Also support the route the frontend is using
  app.get("/api/deposits/pending", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const deposits = await storage.getPendingDeposits();
      res.json(deposits.map(({ user, ...deposit }) => ({
        ...deposit,
        user: serializeUserForClient(user),
      })));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/deposits/:id/approve", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      return res.status(503).json({
        code: "CHAIN_VERIFIER_NOT_CONFIGURED",
        message: "Deposit approval is disabled until the transaction can be verified against its network and recipient."
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/deposits/:id/reject", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { adminNote } = req.body;
      await storage.rejectDeposit(req.params.id, adminNote);

      await storage.createAuditLog({
        adminId: req.user!.id,
        adminUsername: req.user!.username,
        action: "REJECT_DEPOSIT",
        targetType: "deposit",
        targetId: req.params.id,
        details: `Rejected deposit: note ${adminNote || 'none'}`,
        ipAddress: req.ip || null
      });

      res.json({ message: "Deposit rejected" });
    } catch (error) {
      next(error);
    }
  });

  // Purchase power and the canonical referral reward are one atomic DB operation.
  app.post("/api/purchase-power", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const { amount } = z.object({ amount: z.number().int().min(1).finite() }).parse(req.body);
      const result = await db.transaction(async (tx: any) => {
        // Read referral identity, then lock purchaser/referrer rows in stable ID order.
        // This matches the block engine's ORDER BY id FOR UPDATE and avoids deadlocks.
        const [snapshot] = await tx.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
        if (!snapshot) throw Object.assign(new Error("User not found"), { status: 404 });
        let referrerSnapshot: any = null;
        if (snapshot.referredBy) {
          const [candidate] = await tx.select().from(users)
            .where(or(eq(users.referralCode, snapshot.referredBy), eq(users.username, snapshot.referredBy)))
            .limit(1);
          if (candidate && candidate.id !== snapshot.id) referrerSnapshot = candidate;
        }
        const lockIds = [...new Set([snapshot.id, ...(referrerSnapshot ? [referrerSnapshot.id] : [])])].sort();
        const lockedUsers = await tx.select().from(users).where(inArray(users.id, lockIds)).orderBy(asc(users.id)).for("update");
        const user = lockedUsers.find((row: any) => row.id === snapshot.id);
        const referrer = referrerSnapshot ? lockedUsers.find((row: any) => row.id === referrerSnapshot.id) : undefined;
        if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
        if (user.isFrozen || user.isBanned) throw Object.assign(new Error("Frozen or banned accounts cannot purchase hashrate."), { status: 403 });
        const balance = Number(user.usdtBalance || 0);
        if (balance + 1e-9 < amount) throw Object.assign(new Error("Insufficient USDT balance"), { status: 400 });

        const purchasedPower = Number((amount * 0.1).toFixed(2)); // 1 USDT = 100 KH/s = 0.1 internal MH/s
        const newBase = Number((Number(user.baseHashPower || 0) + purchasedPower).toFixed(2));
        const newHash = Number((newBase + Number(user.referralHashBonus || 0)).toFixed(2));
        if (newBase > 99_999_999.99 || newHash > 99_999_999.99) {
          throw Object.assign(new Error("Purchase exceeds the supported hashrate capacity."), { status: 400 });
        }
        const active = user.miningActive === true && user.miningSuspended !== true && user.isFrozen !== true && user.isBanned !== true;
        await tx.update(users).set({
          usdtBalance: (balance - amount).toFixed(2),
          baseHashPower: newBase.toFixed(2),
          hashPower: newHash.toFixed(2),
          ...(active ? { nextBlockHashPower: newHash.toFixed(2) } : {}),
          hasPaidPurchase: true,
        }).where(eq(users.id, user.id));

        let referralCredited = false;
        if (referrer && referrer.id !== user.id) {
            const usdtReward = Number((amount * 0.1).toFixed(2));
            const hashReward = Number((purchasedPower * 0.1).toFixed(2));
            const referrerHash = Number((Number(referrer.hashPower || 0) + hashReward).toFixed(2));
            const referrerBonus = Number((Number(referrer.referralHashBonus || 0) + hashReward).toFixed(2));
            const referrerUsdt = Number((Number(referrer.usdtBalance || 0) + usdtReward).toFixed(2));
            const referrerEarnings = Number((Number(referrer.totalReferralEarnings || 0) + usdtReward).toFixed(2));
            if (referrerHash > 99_999_999.99 || referrerUsdt > 99_999_999.99 || referrerEarnings > 99_999_999.99) throw Object.assign(new Error("Referral reward exceeds the supported account capacity."), { status: 400 });
            const referrerActive = referrer.miningActive === true && referrer.miningSuspended !== true && referrer.isFrozen !== true && referrer.isBanned !== true;
            await tx.update(users).set({
              usdtBalance: referrerUsdt.toFixed(2),
              totalReferralEarnings: referrerEarnings.toFixed(2),
              hashPower: referrerHash.toFixed(2),
              referralHashBonus: referrerBonus.toFixed(2),
              ...(referrerActive ? { nextBlockHashPower: referrerHash.toFixed(2) } : {}),
            }).where(eq(users.id, referrer.id));
            await tx.insert(referralRewards).values({
              referrerId: referrer.id,
              referredUserId: user.id,
              usdtReward: usdtReward.toFixed(2),
              hashReward: hashReward.toFixed(2),
              purchaseAmount: amount.toFixed(2),
              purchaseHashrate: purchasedPower.toFixed(2),
              isClaimed: true,
              claimedAt: new Date(),
            });
            referralCredited = true;
        }
        return { newHashPower: newHash.toFixed(2), referralCredited };
      });
      return res.json({ message: "Hash power purchased successfully", hashPower: result.newHashPower, referralCredited: result.referralCredited });
    } catch (error: any) {
      if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  });

  // Claim mining rewards with strict participation rules
  app.post("/api/claim-rewards", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      if (req.user!.isFrozen || req.user!.isBanned) {
        return res.status(403).json({ message: "Your account is frozen or banned. Rewards are suspended." });
      }
      const result = await storage.claimAllBlocks(req.user!.id);
      if (Number(result.totalReward) <= 0) return res.status(400).json({ message: "No rewards to claim" });
      const updated = await storage.getUser(req.user!.id);
      return res.json({ message: "Rewards claimed successfully", claimedAmount: result.totalReward, newBalance: updated?.b2bBalance || "0", count: result.count, suspended: result.suspended });
    } catch (error) { next(error); }
  });

  // First activation grants the free starter power exactly once.
  app.post("/api/start-mining", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const result = await db.transaction(async (tx: any) => {
        const [user] = await tx.select().from(users).where(eq(users.id, req.user!.id)).for("update");
        if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
        if (user.isFrozen || user.isBanned) throw Object.assign(new Error("Your account is frozen or banned. Mining is suspended."), { status: 403 });
        if (user.hasStartedMining) throw Object.assign(new Error("Mining already started"), { status: 400 });
        const existingBase = Number(user.baseHashPower || 0);
        const grantStarter = user.freeStarterGranted !== true;
        const base = Number((Math.max(existingBase, Number(user.hashPower || 0) - Number(user.referralHashBonus || 0)) + (grantStarter ? 0.1 : 0)).toFixed(2));
        const total = Number((base + Number(user.referralHashBonus || 0)).toFixed(2));
        await tx.update(users).set({
          baseHashPower: base.toFixed(2),
          hashPower: total.toFixed(2),
          lockedHashPower: total.toFixed(2),
          nextBlockHashPower: total.toFixed(2),
          miningActive: true,
          miningSuspended: false,
          hasStartedMining: true,
          freeStarterGranted: true,
        }).where(eq(users.id, user.id));
        return { hashPower: total.toFixed(2) };
      });
      return res.json({ message: "Mining started successfully. Your free 100 KH/s starter power is now active.", freeHashPower: "100 KH/s", hashPower: result.hashPower });
    } catch (error: any) {
      if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  });

  // Paginated list of eligible miners; aggregate stats are calculated in SQL to avoid O(n²) scans.
  app.get("/api/all-miners", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || "50"), 10) || 50));
      const offset = Math.max(0, Number.parseInt(String(req.query.offset || "0"), 10) || 0);
      const [latestBlock, activeCount, totalHashPower, miners] = await Promise.all([
        storage.getLatestBlock(),
        storage.getActiveMinerCount(),
        storage.getGlobalEligibleHashPower(),
        storage.getEligibleMiners(limit, offset),
      ]);
      const minerIds = miners.map(miner => miner.id);
      const referralIdentifiers = [...new Set(miners.flatMap(miner => [miner.referralCode, miner.username]).filter(Boolean) as string[])];
      const [referralRows, pendingRows] = minerIds.length > 0 ? await Promise.all([
        referralIdentifiers.length > 0
          ? db.select({ referredBy: users.referredBy, count: sql<number>`COUNT(*)::int` })
              .from(users).where(inArray(users.referredBy, referralIdentifiers)).groupBy(users.referredBy)
          : Promise.resolve([]),
        db.select({ userId: unclaimedBlocks.userId, total: sql<string>`COALESCE(SUM(${unclaimedBlocks.reward}), 0)::text` })
          .from(unclaimedBlocks).where(and(sql`${unclaimedBlocks.claimed} IS NOT TRUE`, inArray(unclaimedBlocks.userId, minerIds)))
          .groupBy(unclaimedBlocks.userId),
      ]) : [[], []];
      const referralCounts = new Map<string, number>(referralRows.map((row: any) => [String(row.referredBy), Number(row.count || 0)] as [string, number]));
      const pendingRewards = new Map<string, string>(pendingRows.map((row: any) => [String(row.userId), String(row.total || "0")] as [string, string]));
      const minersWithEarnings = miners.map(miner => {
        const codeCount = referralCounts.get(String(miner.referralCode || "")) || 0;
        const usernameCount = referralCounts.get(String(miner.username || "")) || 0;
        const referralCount = miner.referralCode === miner.username ? codeCount : codeCount + usernameCount;
        const totalEarned = new Decimal(miner.b2bBalance || "0")
          .plus(miner.unclaimedBalance || "0")
          .plus(pendingRewards.get(miner.id) || "0");
        return {
          id: miner.id,
          username: miner.username,
          hashPower: Number(miner.hashPower || 0),
          eligibleHashPower: Number(miner.lockedHashPower || 0),
          b2bBalance: miner.b2bBalance,
          usdtBalance: miner.usdtBalance,
          lastActiveBlock: miner.lastActiveBlock,
          referredBy: miner.referredBy,
          totalEarned: totalEarned.toFixed(8),
          referralCount,
        };
      });
      return res.json({
        miners: minersWithEarnings,
        totalHashPower,
        totalActiveMiners: activeCount,
        currentBlock: latestBlock?.blockNumber || 0,
        limit,
        offset,
      });
    } catch (error) { next(error); }
  });

  // Admin endpoint for all withdrawals
  app.get("/api/admin/withdrawals", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const withdrawals = await storage.getAllWithdrawals();
      res.json(withdrawals.map(({ user, ...withdrawal }) => ({
        ...withdrawal,
        user: user ? serializeUserForClient(user) : undefined,
      })));
    } catch (error) {
      next(error);
    }
  });
  
  // Withdrawal endpoints
  app.post("/api/withdrawals", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const freshUser = await storage.getUser(req.user!.id);
      if (!freshUser) {
        return res.status(401).json({ message: "User not found" });
      }

      // Check mandatory security PIN
      if (!freshUser.securityPin) {
        return res.status(400).json({ 
          requirePinSetup: true, 
          message: "A Security PIN is mandatory for withdrawals. Please set up your 6-digit PIN in Account settings first." 
        });
      }

      const { securityPin, twoFactorCode } = req.body;
      if (!securityPin) {
        return res.status(400).json({ message: "Security PIN is required to authorize withdrawals" });
      }

      const isPinValid = await verifyPin(securityPin, freshUser.securityPin);
      if (!isPinValid) {
        return res.status(400).json({ message: "Incorrect Security PIN. Please try again." });
      }

      // Check 2FA if user enabled it
      if (freshUser.twoFactorEnabled && freshUser.twoFactorSecret) {
        if (!twoFactorCode) {
          return res.status(400).json({ 
            require2FA: true, 
            message: "Two-factor authentication code is required to process withdrawals" 
          });
        }
        const isTotpValid = verifyTotpToken(twoFactorCode, freshUser.twoFactorSecret);
        if (!isTotpValid) {
          return res.status(400).json({ message: "Invalid 6-digit authenticator code" });
        }
      }

      // Check daily withdrawal limit
      const requestedAmount = parseFloat(req.body.amount || "0");
      const dailyLimit = parseFloat(freshUser.dailyWithdrawalLimit || "1000");
      const alreadyWithdrawnToday = await storage.getDailyWithdrawalTotal(freshUser.id);

      if (alreadyWithdrawnToday + requestedAmount > dailyLimit) {
        const remainingToday = Math.max(0, dailyLimit - alreadyWithdrawnToday);
        return res.status(400).json({ 
          message: `Daily withdrawal limit exceeded (${dailyLimit.toFixed(2)} USDT limit). You have ${remainingToday.toFixed(2)} USDT remaining today.` 
        });
      }

      const withdrawalData = insertWithdrawalSchema.parse(req.body);
      const withdrawal = await storage.createWithdrawal({
        ...withdrawalData,
        userId: req.user!.id
      });

      res.status(201).json(withdrawal);
    } catch (error: any) {
      if (error?.message?.includes('wait')) {
        return res.status(429).json({ message: error.message });
      }
      next(error);
    }
  });

  // Also support the route the frontend is using
  app.get("/api/withdrawals/pending", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const withdrawals = await storage.getPendingWithdrawals();
      res.json(withdrawals.map(({ user, ...withdrawal }) => ({
        ...withdrawal,
        user: serializeUserForClient(user),
      })));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/withdrawals/:id/approve", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      return res.status(503).json({
        code: "CHAIN_VERIFIER_NOT_CONFIGURED",
        message: "Withdrawal approval is disabled until the payout transaction can be verified on its network."
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/withdrawals/:id/reject", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.rejectWithdrawal(req.params.id);

      await storage.createAuditLog({
        adminId: req.user!.id,
        adminUsername: req.user!.username,
        action: "REJECT_WITHDRAWAL",
        targetType: "withdrawal",
        targetId: req.params.id,
        details: "Rejected withdrawal request",
        ipAddress: req.ip || null
      });

      res.json({ message: "Withdrawal rejected" });
    } catch (error) {
      next(error);
    }
  });

  // Update user balances manually (admin only)
  app.patch("/api/users/:userId/balances", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { usdtBalance, b2bBalance, hashPower } = req.body;
      
      // Validate and only update fields with actual numeric values (skip empty strings and null)
      const validatedBalances: any = {};
      
      if (usdtBalance !== undefined && usdtBalance !== "" && usdtBalance !== null) {
        validatedBalances.usdtBalance = usdtBalance;
        if (isNaN(parseFloat(validatedBalances.usdtBalance))) {
          return res.status(400).json({ message: "Invalid USDT balance value" });
        }
      }
      
      if (b2bBalance !== undefined && b2bBalance !== "" && b2bBalance !== null) {
        validatedBalances.b2bBalance = b2bBalance;
        if (isNaN(parseFloat(validatedBalances.b2bBalance))) {
          return res.status(400).json({ message: "Invalid B2B balance value" });
        }
      }
      
      if (hashPower !== undefined && hashPower !== "" && hashPower !== null) {
        validatedBalances.hashPower = hashPower;
        if (isNaN(parseFloat(validatedBalances.hashPower))) {
          return res.status(400).json({ message: "Invalid hash power value" });
        }
      }
      
      await storage.updateUserBalances(req.params.userId, validatedBalances);

      await storage.createAuditLog({
        adminId: req.user!.id,
        adminUsername: req.user!.username,
        action: "ADJUST_BALANCE",
        targetType: "user",
        targetId: req.params.userId,
        details: `Adjusted balances: ${JSON.stringify(validatedBalances)}`,
        ipAddress: req.ip || null
      });
      
      res.json({ message: "User balances updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Alias for admin user balance update
  app.patch("/api/admin/users/:userId/balances", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { usdt, btc, b2b, hashPower } = req.body;
      
      // Validate and only update fields with actual numeric values (skip empty strings and null)
      const validatedBalances: any = {};
      
      if (usdt !== undefined && usdt !== "" && usdt !== null) {
        validatedBalances.usdtBalance = usdt;
        if (isNaN(parseFloat(validatedBalances.usdtBalance))) {
          return res.status(400).json({ message: "Invalid USDT balance value" });
        }
      }
      
      if (btc !== undefined && btc !== "" && btc !== null) {
        // Handle BTC balance update
        const btcValue = btc;
        if (isNaN(parseFloat(btcValue))) {
          return res.status(400).json({ message: "Invalid BTC balance value" });
        }
        await storage.updateUserBtcBalance(req.params.userId, btcValue);
      }
      
      if (b2b !== undefined && b2b !== "" && b2b !== null) {
        validatedBalances.b2bBalance = b2b;
        if (isNaN(parseFloat(validatedBalances.b2bBalance))) {
          return res.status(400).json({ message: "Invalid B2B balance value" });
        }
      }
      
      if (hashPower !== undefined && hashPower !== "" && hashPower !== null) {
        validatedBalances.hashPower = hashPower;
        if (isNaN(parseFloat(validatedBalances.hashPower))) {
          return res.status(400).json({ message: "Invalid hash power value" });
        }
      }
      
      // Only update if there are balances to update
      if (Object.keys(validatedBalances).length > 0) {
        await storage.updateUserBalances(req.params.userId, validatedBalances);
      }
      
      res.json({ message: "User balances updated successfully" });
    } catch (error) {
      next(error);
    }
  });
  
  // Also support PUT method for balance update
  app.put("/api/admin/users/:userId/balances", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { usdt, btc, b2b, hashPower } = req.body;
      
      // Validate and only update fields with actual numeric values (skip empty strings and null)
      const validatedBalances: any = {};
      
      if (usdt !== undefined && usdt !== "" && usdt !== null) {
        validatedBalances.usdtBalance = usdt;
        if (isNaN(parseFloat(validatedBalances.usdtBalance))) {
          return res.status(400).json({ message: "Invalid USDT balance value" });
        }
      }
      
      if (btc !== undefined && btc !== "" && btc !== null) {
        // Handle BTC balance update
        const btcValue = btc;
        if (isNaN(parseFloat(btcValue))) {
          return res.status(400).json({ message: "Invalid BTC balance value" });
        }
        await storage.updateUserBtcBalance(req.params.userId, btcValue);
      }
      
      if (b2b !== undefined && b2b !== "" && b2b !== null) {
        validatedBalances.b2bBalance = b2b;
        if (isNaN(parseFloat(validatedBalances.b2bBalance))) {
          return res.status(400).json({ message: "Invalid B2B balance value" });
        }
      }
      
      if (hashPower !== undefined && hashPower !== "" && hashPower !== null) {
        validatedBalances.hashPower = hashPower;
        if (isNaN(parseFloat(validatedBalances.hashPower))) {
          return res.status(400).json({ message: "Invalid hash power value" });
        }
      }
      
      // Only update if there are balances to update
      if (Object.keys(validatedBalances).length > 0) {
        await storage.updateUserBalances(req.params.userId, validatedBalances);
      }
      
      res.json({ message: "User balances updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  // System settings
  app.get("/api/settings/:key", async (req, res, next) => {
    try {
      const setting = await storage.getSystemSetting(req.params.key);
      res.json(setting);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { key, value } = z.object({
        key: z.string(),
        value: z.string()
      }).parse(req.body);

      await storage.setSystemSetting(key, value);
      res.json({ message: "Setting updated" });
    } catch (error) {
      next(error);
    }
  });

  // User management
  app.patch("/api/users/:id/freeze", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.freezeUser(req.params.id);
      res.json({ message: "User frozen" });
    } catch (error) {
      next(error);
    }
  });

  // Support PUT method
  app.put("/api/users/:id/freeze", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.freezeUser(req.params.id);
      res.json({ message: "User frozen" });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:id/unfreeze", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.unfreezeUser(req.params.id);
      res.json({ message: "User unfrozen" });
    } catch (error) {
      next(error);
    }
  });

  // Support PUT method
  app.put("/api/users/:id/unfreeze", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.unfreezeUser(req.params.id);
      res.json({ message: "User unfrozen" });
    } catch (error) {
      next(error);
    }
  });

  // Ban/unban user endpoints
  app.patch("/api/users/:userId/ban", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.banUser(req.params.userId);
      res.json({ message: "User banned successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Support PUT method
  app.put("/api/users/:userId/ban", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.banUser(req.params.userId);
      res.json({ message: "User banned successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:userId/unban", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.unbanUser(req.params.userId);
      res.json({ message: "User unbanned successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Support PUT method
  app.put("/api/users/:userId/unban", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await storage.unbanUser(req.params.userId);
      res.json({ message: "User unbanned successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Get global deposit addresses (public endpoint for all users)
  app.get("/api/deposit-addresses", async (req, res, next) => {
    try {
      const usdtAddress = await storage.getGlobalDepositAddress('USDT');
      const btcAddress = await storage.getGlobalDepositAddress('BTC');
      
      res.json({ usdt: usdtAddress, btc: btcAddress });
    } catch (error) {
      next(error);
    }
  });

  // DEPRECATED: This endpoint is now secured and should not expose the entire address pool
  // Use POST /api/deposit-addresses/assign instead
  app.get("/api/deposit-addresses/all", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // SECURITY: Don't expose the entire address pool to clients
      // Instead, return an error directing them to use the new endpoint
      return res.status(403).json({ 
        message: "This endpoint is deprecated for security reasons. Use POST /api/deposit-addresses/assign instead" 
      });
    } catch (error) {
      next(error);
    }
  });

  // Assign a deposit address to a user with 24-hour cooldown
  app.post("/api/deposit-addresses/assign", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignSchema = z.object({
        currency: z.enum(['USDT', 'BTC']),
        network: z.string().optional() // 'ERC20', 'BSC' for USDT, null/undefined for BTC
      });

      const { currency, network } = assignSchema.parse(req.body);
      const userId = req.user!.id;

      // Validate network for currency
      if (currency === 'USDT' && network && !['ERC20', 'BSC'].includes(network)) {
        return res.status(400).json({ 
          message: "Invalid network for USDT. Must be 'ERC20' or 'BSC'" 
        });
      }

      if (currency === 'BTC' && network) {
        return res.status(400).json({ 
          message: "BTC does not support network selection" 
        });
      }

      // Assign or retrieve existing address with cooldown
      const assignment = await storage.assignDepositAddress(userId, currency, network);

      res.json({
        address: assignment.address,
        assignedAt: assignment.assignedAt.toISOString(),
        expiresAt: assignment.expiresAt.toISOString(),
        isNewAssignment: assignment.isNewAssignment,
        currency,
        network
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid request format",
          errors: error.errors 
        });
      }
      next(error);
    }
  });
  
  // Deposit Address Management endpoints
  
  // Get user's deposit address with 24-hour cooldown mechanism
  // Users can only get a new address once every 24 hours
  app.get("/api/deposit-address/get-random", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // This method now implements 24-hour cooldown:
      // - If user has an address assigned within last 24 hours, returns same address with cooldown info
      // - If cooldown expired or no recent assignment, releases old addresses and assigns new one
      // - Uses atomic operations to prevent race conditions
      const result = await storage.getRandomAvailableAddress(req.user!.id);
      
      if (!result.address) {
        return res.status(404).json({ 
          message: "No available deposit addresses. Please contact administrator." 
        });
      }

      // Success - return the address with cooldown status
      res.json({
        address: result.address,
        canGetNewAddress: result.canGetNewAddress,
        hoursUntilNewAddress: result.hoursUntilNewAddress
      });
    } catch (error) {
      // Log critical errors for debugging
      console.error('Error in deposit address assignment:', error);
      next(error);
    }
  });

  // Admin: Get all deposit addresses
  app.get("/api/admin/deposit-addresses", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const addresses = await storage.getDepositAddresses();
      res.json(addresses);
    } catch (error) {
      next(error);
    }
  });

  // Admin: Add single or bulk addresses
  app.post("/api/admin/deposit-addresses", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const addressSchema = z.object({
        address: z.string().regex(/^(0x[a-fA-F0-9]{40}|T[A-Za-z1-9]{33})$/, "Invalid address format"),
        addresses: z.array(z.string().regex(/^(0x[a-fA-F0-9]{40}|T[A-Za-z1-9]{33})$/)).optional()
      }).partial();

      const data = addressSchema.parse(req.body);

      if (data.addresses && data.addresses.length > 0) {
        // Bulk create
        await storage.bulkCreateAddresses(data.addresses);
        res.json({ 
          success: true, 
          message: `${data.addresses.length} addresses added successfully` 
        });
      } else if (data.address) {
        // Single create
        await storage.createDepositAddress(data.address);
        res.json({ 
          success: true, 
          message: "Address added successfully" 
        });
      } else {
        return res.status(400).json({ 
          message: "Either 'address' or 'addresses' must be provided" 
        });
      }
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid address format. Must be valid ERC20/BSC (0x...) or TRON (T...) address",
          errors: error.errors 
        });
      }
      next(error);
    }
  });

  // Admin: Delete an address
  app.delete("/api/admin/deposit-addresses/:id", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { id } = req.params;
      await storage.deleteAddress(id);
      
      res.json({ 
        success: true, 
        message: "Address deleted successfully" 
      });
    } catch (error) {
      next(error);
    }
  });

  // Admin: Update address status
  app.patch("/api/admin/deposit-addresses/:id", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const statusSchema = z.object({
        isActive: z.boolean()
      });

      const { id } = req.params;
      const { isActive } = statusSchema.parse(req.body);
      
      await storage.updateAddressStatus(id, isActive);
      
      res.json({ 
        success: true, 
        message: `Address ${isActive ? 'activated' : 'deactivated'} successfully` 
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid status. Must be a boolean value.",
          errors: error.errors 
        });
      }
      next(error);
    }
  });

  // Admin: Bulk action on addresses (activate/deactivate)
  app.post("/api/admin/deposit-addresses/bulk-action", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const bulkActionSchema = z.object({
        action: z.enum(["activate", "deactivate"]),
        addressIds: z.array(z.string()).min(1, "At least one address ID required")
      });

      const data = bulkActionSchema.parse(req.body);
      const isActive = data.action === "activate";
      
      // Update each address status
      let updated = 0;
      for (const addressId of data.addressIds) {
        try {
          await storage.updateAddressStatus(addressId, isActive);
          updated++;
        } catch (err) {
          console.error(`Failed to update address ${addressId}:`, err);
        }
      }
      
      res.json({ 
        success: true,
        updated,
        message: `Successfully ${data.action}d ${updated} out of ${data.addressIds.length} addresses` 
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid request body",
          errors: error.errors 
        });
      }
      next(error);
    }
  });

  // Admin-only endpoint to manage global deposit addresses (for backwards compatibility)
  app.post("/api/admin/deposit-address", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { currency, address } = z.object({
        currency: z.enum(['USDT', 'BTC']),
        address: z.string()
      }).parse(req.body);

      await storage.setGlobalDepositAddress(currency, address);
      res.json({ message: `${currency} deposit address updated successfully` });
    } catch (error) {
      next(error);
    }
  });
  
  // Get supply metrics
  app.get("/api/supply-metrics", async (req, res, next) => {
    try {
      const metrics = await storage.getSupplyMetrics();
      const totalHashPower = await storage.getGlobalEligibleHashPower();
      res.json({ ...metrics, totalHashrate: parseFloat(totalHashPower) });
    } catch (error) {
      next(error);
    }
  });
  
  // Get global mining stats
  app.get("/api/global-stats", async (req, res, next) => {
    try {
      const totalHashPower = await storage.getGlobalEligibleHashPower();
      const latestBlock = await storage.getLatestBlock();
      const activeMiners = await storage.getActiveMinerCount();
      const supplyMetrics = await storage.getSupplyMetrics();
      const userCount = await storage.getUserCount();
      const totalDeposits = await storage.getTotalDeposits();
      const totalWithdrawals = await storage.getTotalWithdrawals();
      const currentBlock = latestBlock?.blockNumber || 0;
      const totalBlocks = currentBlock;
      const blocksToday = await storage.getBlocksMinedToday();
      const numHash = parseFloat(totalHashPower) || 0;
      const numCirculation = parseFloat(supplyMetrics.circulating) || 0;
      const numMined = parseFloat(supplyMetrics.totalMined) || 0;
      const maxSupply = 21000000;
      const supplyProgress = Math.min(100, (numMined / maxSupply) * 100);

      // Internal unit: 1 hashPower = 1 MH/s; 0.1 = 100 KH/s.
      const formatHashString = (hp: number): string => {
        if (hp >= 1_000_000_000) return `${(hp / 1_000_000_000).toFixed(2)} PH/s`;
        if (hp >= 1_000_000) return `${(hp / 1_000_000).toFixed(2)} TH/s`;
        if (hp >= 1_000) return `${(hp / 1_000).toFixed(2)} GH/s`;
        if (hp >= 1) return `${hp.toFixed(2)} MH/s`;
        if (hp > 0) return `${(hp * 1_000).toFixed(2)} KH/s`;
        return "0 KH/s";
      };

      res.json({
        totalHashrate: numHash,
        totalHashPower: numHash,
        hashRateDisplay: formatHashString(numHash),
        blockHeight: currentBlock,
        totalBlockHeight: totalBlocks,
        activeMiners,
        activeMinerCount: activeMiners,
        userCount,
        totalDeposits: totalDeposits || "0.00",
        totalWithdrawals: totalWithdrawals || "0.00",
        blockReward: parseFloat(supplyMetrics.currentBlockReward),
        currentBlockReward: parseFloat(supplyMetrics.currentBlockReward),
        totalCirculation: numCirculation,
        circulatingSupply: numCirculation,
        totalMinedSupply: parseFloat(supplyMetrics.totalMined) || 0,
        circulation: numCirculation,
        maxSupply: 21000000,
        supplyProgress: parseFloat(supplyProgress.toFixed(4)),
        nextHalving: supplyMetrics.halvingProgress.nextHalving,
        blocksUntilHalving: supplyMetrics.halvingProgress.blocksRemaining,
        halvingProgress: Number((((currentBlock % 2160) / 2160) * 100).toFixed(4)),
        networkDifficulty: null,
        blockTime: "60m",
        blocksToday,
        lastBlockTime: latestBlock?.timestamp || null
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Get unclaimed blocks for current user
  app.get("/api/unclaimed-blocks", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const blocks = await storage.getUnclaimedBlocks(req.user!.id);
      res.json(blocks);
    } catch (error) {
      next(error);
    }
  });
  
  // Claim a single block
  app.post("/api/claim-block/:blockId", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Frozen and banned accounts cannot claim until restored by an administrator.
      if (req.user!.isFrozen || req.user!.isBanned) {
        return res.status(403).json({ message: "Your account is frozen or banned. Mining and rewards are suspended." });
      }
      
      const result = await storage.claimBlock(req.params.blockId, req.user!.id);
      
      if (!result.success) {
        return res.status(400).json({ message: "Block not found or already claimed" });
      }
      
      if (result.resumed) {
        res.json({
          message: `All pending rewards are claimed. Mining has resumed for the next block.`,
          reward: result.reward,
          resumed: true
        });
      } else {
        res.json({ message: `Successfully claimed ${result.reward} B2B`, reward: result.reward });
      }
    } catch (error) {
      next(error);
    }
  });
  
  // Claim all blocks
  app.post("/api/claim-all-blocks", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check if user is frozen
      if (req.user!.isFrozen || req.user!.isBanned) {
        return res.status(403).json({ message: "Your account is frozen or banned. Mining and rewards are suspended." });
      }
      
      const result = await storage.claimAllBlocks(req.user!.id);
      
      if (result.count === 0 && Number(result.totalReward) <= 0) {
        return res.status(400).json({ message: "No rewards to claim" });
      }
      
      // Get current block number
      const latestBlock = await storage.getLatestBlock();
      const currentBlock = latestBlock?.blockNumber || 0;

      // Update user's last active block
      await storage.updateUser(req.user!.id, {
        lastActiveBlock: currentBlock
      });

      if (result.resumed) {
        res.json({
          message: `All pending rewards claimed. Mining has resumed for the next block. ${result.count} blocks claimed for ${result.totalReward} B2B`,
          count: result.count,
          totalReward: result.totalReward,
          resumed: true
        });
      } else {
        res.json({ 
          message: `Successfully claimed ${result.count} blocks for ${result.totalReward} B2B`,
          count: result.count,
          totalReward: result.totalReward
        });
      }
    } catch (error) {
      next(error);
    }
  });
  
  // Compatibility alias: every claim endpoint settles the same transactional ledger.
  app.post("/api/mining/claim-all", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Authentication required" });
      if (req.user!.isFrozen || req.user!.isBanned) return res.status(403).json({ message: "Rewards are suspended for this account." });
      const result = await storage.claimAllBlocks(req.user!.id);
      if (Number(result.totalReward) <= 0) return res.status(400).json({ message: "No unclaimed rewards available", claimedAmount: "0", newBalance: req.user!.b2bBalance || "0" });
      const updatedUser = await storage.getUser(req.user!.id);
      return res.json({ message: `Successfully claimed ${result.totalReward} B2B`, claimedAmount: result.totalReward, newBalance: updatedUser?.b2bBalance || "0", wasMiningSuspended: Boolean(result.suspended), miningResumed: Boolean(result.resumed), count: result.count });
    } catch (error) { next(error); }
  });

  // Get user mining status
  app.get("/api/mining/status", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const status = await storage.getUserMiningStatus(req.user!.id);
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      const latestBlock = await storage.getLatestBlock();
      // The scheduler generates the next block one hour after the last committed block.
      const now = Date.now();
      const lastBlockAt = latestBlock?.timestamp ? new Date(latestBlock.timestamp).getTime() : null;
      const timeUntilNextBlock = lastBlockAt === null ? 0 : Math.max(0, Math.ceil((lastBlockAt + 60 * 60 * 1000 - now) / 1000));
      
      res.json({
        ...status,
        hashPower: user.hashPower || '0.00',
        lockedHashPower: user.lockedHashPower || '0.00',
        nextBlockHashPower: user.nextBlockHashPower || user.hashPower || '0.00',
        timeUntilNextBlock,
        currentBlockNumber: latestBlock?.blockNumber || 0
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Get mining info
  app.get("/api/mining/info", async (req, res, next) => {
    try {
      const blockRewardSetting = await storage.getSystemSetting("blockReward");
      const latestBlock = await storage.getLatestBlock();
      const totalBlockHeight = latestBlock?.blockNumber || 0;
      const blockReward = blockRewardSetting ? parseFloat(blockRewardSetting.value) : 3200;
      const totalMinedSupply = await storage.getTotalMinedSupply();
      const totalHashPower = await storage.getGlobalEligibleHashPower();
      
      // Calculate next halving
      const HALVING_INTERVAL = 2160;
      const currentHalvingPeriod = totalBlockHeight > 0 ? Math.floor((totalBlockHeight - 1) / HALVING_INTERVAL) : 0;
      const nextHalvingBlock = (currentHalvingPeriod + 1) * HALVING_INTERVAL + 1;
      const blocksUntilHalving = Math.max(0, nextHalvingBlock - totalBlockHeight);
      
      // The scheduler generates the next block one hour after the last committed block.
      const now = Date.now();
      const lastBlockAt = latestBlock?.timestamp ? new Date(latestBlock.timestamp).getTime() : null;
      const timeUntilNextBlock = lastBlockAt === null ? 0 : Math.max(0, Math.ceil((lastBlockAt + 60 * 60 * 1000 - now) / 1000));
      
      // User-specific data if logged in
      let userMiningStatus = null;
      let userMiningHistory = null;
      
      if (req.isAuthenticated()) {
        userMiningStatus = await storage.getUserMiningStatus(req.user!.id);
        userMiningHistory = await storage.getUserMiningHistory(req.user!.id, 10);
      }
      
      res.json({
        blockHeight: totalBlockHeight,
        blockReward: blockReward.toFixed(8),
        totalHashPower,
        totalMinedSupply,
        globalHashrate: totalHashPower,
        latestBlockHash: latestBlock?.blockHash || null,
        latestBlockTime: latestBlock?.timestamp || null,
        blocksUntilHalving,
        nextHalvingBlock,
        timeUntilNextBlock,
        userMiningStatus,
        userMiningHistory,
        blockTime: 3600, // 1 hour in seconds
        blocksPerDay: 24,
        maxSupply: 21000000
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Recent persisted blocks only; never synthesize block history in the client.
  app.get("/api/mining/blocks", async (_req, res, next) => {
    try { res.json(await storage.getRecentBlocks(5)); }
    catch (error) { next(error); }
  });

  // Get user mining history
  app.get("/api/mining/history", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const history = await storage.getUserMiningHistory(req.user!.id, 50);
      res.json(history);
    } catch (error) {
      next(error);
    }
  });
  
  // Fetch unclaimed blocks for mining
  app.get("/api/mining/unclaimed-blocks", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const blocks = await storage.getUnclaimedBlocks(req.user!.id);
      res.json(blocks || []);
    } catch (error) {
      next(error);
    }
  });
  
  // Admin endpoint to view miner statuses
  app.get("/api/admin/miners", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const miners = await storage.getMinersStatus();
      res.json(miners.map(({ user, ...miner }) => ({
        ...miner,
        user: serializeUserForClient(user),
      })));
    } catch (error) {
      next(error);
    }
  });
  
  // Get user transactions
  app.get("/api/transactions", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const userId = req.user!.id;
      const [deposits, withdrawals, sentTransfers, receivedTransfers] = await Promise.all([
        storage.getUserDeposits(userId),
        storage.getUserWithdrawals(userId),
        storage.getSentTransfers(userId),
        storage.getReceivedTransfers(userId)
      ]);
      
      res.json({
        deposits,
        withdrawals,
        sentTransfers,
        receivedTransfers
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Get cooldown status
  app.get("/api/cooldowns", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const userId = req.user!.id;
      const [depositCooldown, withdrawalCooldown] = await Promise.all([
        storage.getDepositCooldown(userId),
        storage.getWithdrawalCooldown(userId)
      ]);
      
      res.json({
        deposit: depositCooldown,
        withdrawal: withdrawalCooldown
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Change PIN
  app.post("/api/change-pin", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { currentPin, newPin } = z.object({
        currentPin: z.string().optional(),
        newPin: z.string().length(6).regex(/^\d{6}$/, "PIN must be exactly 6 digits")
      }).parse(req.body);

      const freshUser = await storage.getUser(req.user!.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });

      // If PIN already set, verify current PIN before allowing change
      if (freshUser.securityPin) {
        if (!currentPin) {
          return res.status(400).json({ message: "Current PIN is required to change an existing PIN" });
        }
        const isValid = await verifyPin(currentPin, freshUser.securityPin);
        if (!isValid) {
          return res.status(400).json({ message: "Current PIN is incorrect" });
        }
      }

      const hashedNewPin = await hashPin(newPin);
      await storage.updateUser(req.user!.id, { securityPin: hashedNewPin });

      res.json({ message: "PIN changed successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Verify PIN
  app.post("/api/verify-pin", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { pin } = z.object({ pin: z.string().length(6) }).parse(req.body);

      const freshUser = await storage.getUser(req.user!.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });

      if (!freshUser.securityPin) {
        return res.json({ valid: true, pinSet: false });
      }

      const isValid = await verifyPin(pin, freshUser.securityPin);
      res.json({ valid: isValid, pinSet: true });
    } catch (error) {
      next(error);
    }
  });

  // 2FA Management Endpoints (RFC 6238 TOTP)
  app.get("/api/2fa/status", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const freshUser = await storage.getUser(req.user!.id);
      res.json({
        enabled: Boolean(freshUser?.twoFactorEnabled),
        hasSecret: Boolean(freshUser?.twoFactorSecret)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/2fa/generate", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const secret = generateBase32Secret(20);
      const uri = getTotpUri(req.user!.username, secret);
      res.json({ secret, uri });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/2fa/enable", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { secret, token } = req.body;
      if (!secret || !token) {
        return res.status(400).json({ message: "Secret key and 6-digit verification code are required" });
      }

      const isValid = verifyTotpToken(token, secret);
      if (!isValid) {
        return res.status(400).json({ message: "Invalid verification code. Please check your authenticator app and try again." });
      }

      await storage.updateUser(req.user!.id, {
        twoFactorEnabled: true,
        twoFactorSecret: secret
      });

      if (req.user!.isAdmin) {
        await storage.createAuditLog({
          adminId: req.user!.id,
          adminUsername: req.user!.username,
          action: "ENABLE_2FA",
          targetType: "user",
          targetId: req.user!.id,
          details: "Admin enabled Two-Factor Authentication",
          ipAddress: req.ip || null
        });
      }

      res.json({ success: true, message: "Two-factor authentication enabled successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/2fa/disable", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { token, pin } = req.body;
      const freshUser = await storage.getUser(req.user!.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });

      let verified = false;
      if (token && freshUser.twoFactorSecret) {
        verified = verifyTotpToken(token, freshUser.twoFactorSecret);
      } else if (pin && freshUser.securityPin) {
        verified = await verifyPin(pin, freshUser.securityPin);
      }

      if (!verified) {
        return res.status(400).json({ message: "Verification failed. Provide a valid 2FA code or security PIN." });
      }

      await storage.updateUser(req.user!.id, {
        twoFactorEnabled: false,
        twoFactorSecret: null
      });

      if (req.user!.isAdmin) {
        await storage.createAuditLog({
          adminId: req.user!.id,
          adminUsername: req.user!.username,
          action: "DISABLE_2FA",
          targetType: "user",
          targetId: req.user!.id,
          details: "Admin disabled Two-Factor Authentication",
          ipAddress: req.ip || null
        });
      }

      res.json({ success: true, message: "Two-factor authentication disabled" });
    } catch (error) {
      next(error);
    }
  });

  // Admin Audit Logs API
  app.get("/api/admin/audit-logs", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    } catch (error) {
      next(error);
    }
  });

  // Admin Mine Block On-Demand API
  app.post("/api/admin/mining/mine-block", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const block = await forceGenerateBlock();

      await storage.createAuditLog({
        adminId: req.user!.id,
        adminUsername: req.user!.username,
        action: "MINE_BLOCK",
        targetType: "system",
        targetId: block ? String(block.blockNumber) : "manual",
        details: `Manually triggered block #${block?.blockNumber || 'unknown'} generation`,
        ipAddress: req.ip || null
      });

      res.json({ success: true, message: "Block mined successfully!", block });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to generate block" });
    }
  });

  // Admin Database Backups Management API
  app.get("/api/admin/backups", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const backups = listBackups();
      res.json(backups);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/backups/create", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const backup = await generateSystemBackup(`manual-by-${req.user!.username}`);
      await storage.createAuditLog({
        adminId: req.user!.id,
        adminUsername: req.user!.username,
        action: "DATABASE_BACKUP",
        targetType: "system",
        targetId: backup.filename,
        details: `Triggered manual database backup: ${backup.filename} (${(backup.size / 1024).toFixed(1)} KB)`,
        ipAddress: req.ip || null
      });
      res.json({ success: true, message: "Database backup created successfully", backup });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Backup generation failed" });
    }
  });

  app.get("/api/admin/backups/:filename", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const content = getBackupContent(req.params.filename);
      res.json(content);
    } catch (error: any) {
      res.status(404).json({ message: error.message || "Backup file not found" });
    }
  });

  // Secret Admin Master Private Key Rotation API
  app.post("/api/admin/change-private-key", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { newAccessKey, currentAccessKey, targetUsername } = req.body;
      
      let targetUser = req.user!;
      if (targetUsername && targetUsername !== req.user!.username) {
        const found = await storage.getUserByUsername(targetUsername);
        if (!found || !found.isAdmin) {
          return res.status(404).json({ message: "Target admin user not found" });
        }
        targetUser = found;
      }

      // If current key provided, verify it
      if (currentAccessKey && targetUser.id === req.user!.id) {
        const isValid = await verifyAccessKey(currentAccessKey, targetUser.accessKey);
        if (!isValid) {
          return res.status(400).json({ message: "Current private key verification failed" });
        }
      }

      // Generate key if not supplied or if requested 'GENERATE'
      let finalKey = (newAccessKey || '').trim();
      if (!finalKey || finalKey.toUpperCase() === 'GENERATE') {
        finalKey = generateUniqueAccessKey();
      }

      if (finalKey.length < 8) {
        return res.status(400).json({ message: "Private key must be at least 8 characters" });
      }

      // Hash key with scrypt
      const hashedKey = await hashAccessKey(finalKey);

      // Update in storage
      await storage.updateUser(targetUser.id, { accessKey: hashedKey });
      
      if (req.user!.id === targetUser.id) {
        req.user!.accessKey = hashedKey;
      }

      // Audit log
      await storage.createAuditLog({
        adminId: req.user!.id,
        adminUsername: req.user!.username,
        action: "ROTATE_ADMIN_PRIVATE_KEY",
        targetType: "user",
        targetId: targetUser.id,
        details: `Rotated private key for admin account '${targetUser.username}'`,
        ipAddress: req.ip || null
      });

      res.json({
        success: true,
        message: "Admin private key updated successfully",
        username: targetUser.username,
        newAccessKey: finalKey,
        updatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update admin private key" });
    }
  });

  // Admin key status info
  app.get("/api/admin/key-info", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user!.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      res.json({
        username: req.user!.username,
        isAdmin: true,
        hasKeyConfigured: !!req.user!.accessKey,
        keyFormat: "B2B-XXXXX-XXXXX-XXXXX-XXXXX",
        lastLoginIp: req.ip || null
      });
    } catch (error) {
      next(error);
    }
  });

  // Get referral data with detailed tracking
  app.get("/api/referrals", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = req.user!;
      const referralCode = user.referralCode || user.username.toUpperCase().slice(0, 8);
      const referredUsers = await storage.getUsersByReferralCode(referralCode);
      
      const totalReferrals = referredUsers.length;
      const activeReferrals = referredUsers.filter(u => parseFloat(u.baseHashPower || u.hashPower || "0") > 0).length;
      const totalEarnings = user.totalReferralEarnings || "0.00";
      const totalHashBonus = user.referralHashBonus || "0.00";

      const referrals = referredUsers.map(u => ({
        id: u.id,
        username: u.username,
        joinedAt: u.createdAt,
        status: parseFloat(u.baseHashPower || u.hashPower || "0") > 0 ? 'mining' : 'inactive',
        hashPower: u.baseHashPower || u.hashPower || "0",
        earned: "0.00"
      }));

      const referralData = {
        username: user.username,
        referralCode: referralCode,
        totalReferrals: totalReferrals,
        tier1Count: totalReferrals,
        tier2Count: 0,
        activeReferrals: activeReferrals,
        totalEarnings: totalEarnings,
        tier1Earnings: totalEarnings,
        tier2Earnings: "0.00",
        pendingCommissions: user.unclaimedReferralUsdt || "0.00",
        referralHashBonus: totalHashBonus,
        referrals: referrals
      };

      res.json(referralData);
    } catch (error) {
      next(error);
    }
  });
  
  // Transfer B2B
  app.post("/api/transfer", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const freshUser = await storage.getUser(req.user!.id);
      if (!freshUser) {
        return res.status(401).json({ message: "User not found" });
      }

      if (freshUser.securityPin) {
        const { securityPin } = req.body;
        if (!securityPin) {
          return res.status(400).json({ message: "Security PIN is required to transfer B2B" });
        }
        const isPinValid = await verifyPin(securityPin, freshUser.securityPin);
        if (!isPinValid) {
          return res.status(400).json({ message: "Incorrect Security PIN" });
        }
      }
      
      const { toUsername, amount } = z.object({
        toUsername: z.string(),
        amount: z.string()
      }).parse(req.body);
      
      const transfer = await storage.createTransfer(req.user!.id, toUsername, amount);
      res.json({ message: "Transfer successful", transfer });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // BTC Staking endpoints
  
  // Get current BTC price and hashrate price
  app.get("/api/btc/prices", async (req, res, next) => {
    try {
      const btcPrice = await storage.getCurrentBtcPrice();
      const hashratePrice = await storage.getSystemHashratePrice();
      
      res.json({
        btcPrice,
        hashratePrice,
        requiredHashratePerBTC: btcPrice, // 1 BTC requires btcPrice amount of GH/s (since 1 GH/s = 1 USD)
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // Create BTC stake
  app.post("/api/btc/stake", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { btcAmount, months, apr, useHashrate } = z.object({
        btcAmount: z.string().refine(val => Number.isFinite(Number(val)) && Number(val) >= 0.1, "Minimum stake is 0.1 BTC"),
        months: z.number().int().min(1).max(24).optional().default(12),
        apr: z.number().min(0).max(100).optional().default(20),
        useHashrate: z.boolean().optional().default(true),
      }).parse(req.body);

      const user = req.user!;
      const btcBalance = parseFloat(user.btcBalance || "0");
      const userHashPowerMh = parseFloat(user.hashPower || "0");
      const userHashPowerGh = userHashPowerMh / 1000; // 1,000 MH/s = 1 GH/s
      const btcPrice = await storage.getCurrentBtcPrice();
      const amount = Number(btcAmount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "Invalid BTC amount" });
      if (!Number.isFinite(btcBalance) || btcBalance < amount) {
        return res.status(400).json({ message: "Insufficient BTC balance" });
      }

      // Hashrate requirement is expressed in GH/s, while the user table stores MH/s.
      const requiredHashrate = useHashrate ? amount * Number(btcPrice) : 0;
      if (useHashrate && userHashPowerGh < requiredHashrate) {
        return res.status(400).json({
          message: `Insufficient hashrate. Need ${requiredHashrate.toFixed(6)} GH/s but you have ${userHashPowerGh.toFixed(6)} GH/s`
        });
      }

      // Stake creation and BTC debit are one row-locked database transaction.
      // The storage method rechecks balance and hashrate using the locked current user row.
      const stake = await storage.createBtcStakeAndDebitBalance(
        user.id,
        btcAmount,
        requiredHashrate.toString(),
        btcPrice,
        months,
        apr,
        useHashrate,
      );
      
      // DON'T deduct hashrate - mining continues to work normally!
      // The staked hashrate is tracked in the stake record but doesn't affect mining
      // Mining rewards continue based on full hashPower

      res.json({
        message: "BTC stake created successfully",
        stake,
        lockDuration: `${months} month${months !== 1 ? 's' : ''}`,
        aprRate: `${apr}%`,
        requiredHashrate: requiredHashrate.toFixed(6),
        hashrateUsed: useHashrate,
        dailyReward: stake.dailyReward
      });
    } catch (error: any) {
      if (error?.status && [400, 403, 404].includes(error.status)) {
        return res.status(error.status).json({ message: error.message });
      }
      next(error);
    }
  });

  // Get user's BTC stakes
  app.get("/api/btc/stakes", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const stakes = await storage.getUserBtcStakes(req.user!.id);
      const btcPrice = await storage.getCurrentBtcPrice();

      res.json({
        stakes,
        currentBtcPrice: btcPrice,
        totalStaked: stakes.reduce((sum, s) => sum + parseFloat(s.btcAmount), 0).toFixed(8),
        totalDailyRewards: stakes.filter(s => s.status === 'active')
          .reduce((sum, s) => sum + parseFloat(s.dailyReward), 0).toFixed(8)
      });
    } catch (error) {
      next(error);
    }
  });

  // Get user's BTC balance
  app.get("/api/btc/balance", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const btcBalance = await storage.getUserBtcBalance(req.user!.id);
      res.json({ btcBalance });
    } catch (error) {
      next(error);
    }
  });

  // BTC deposit
  app.post("/api/btc/deposit", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { txHash, amount } = z.object({
        txHash: z.string(),
        amount: z.string().refine(val => parseFloat(val) >= 0.0001, "Minimum deposit is 0.0001 BTC")
      }).parse(req.body);
      
      const deposit = await storage.createDeposit({
        txHash,
        amount,
        network: "BTC",
        currency: "BTC",
        userId: req.user!.id
      });
      
      res.json({ message: "BTC deposit submitted for approval", deposit });
    } catch (error: any) {
      if (error?.message?.includes('duplicate key')) {
        return res.status(400).json({ message: "Transaction hash already submitted" });
      }
      next(error);
    }
  });

  // BTC withdrawal
  app.post("/api/btc/withdraw", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { amount, address } = z.object({
        amount: z.string().refine(val => {
          const amt = parseFloat(val);
          return amt >= 0.001 && amt <= 10;
        }, "Amount must be between 0.001 and 10 BTC"),
        address: z.string()
      }).parse(req.body);
      
      const user = req.user!;
      const btcBalance = parseFloat(user.btcBalance || "0");
      
      if (btcBalance < parseFloat(amount)) {
        return res.status(400).json({ message: "Insufficient BTC balance" });
      }
      
      const withdrawal = await storage.createWithdrawal({
        amount,
        address,
        network: "BTC",
        currency: "BTC",
        userId: user.id
      });
      
      // Balance is deducted atomically when an admin approves the withdrawal.
      res.json({ message: "BTC withdrawal request submitted", withdrawal });
    } catch (error) {
      next(error);
    }
  });

  // Get conversion history
  app.get("/api/conversions", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const btcConversions = await storage.getUserBtcConversions(req.user!.id);
    
    // Sort conversions by date
    const allConversions = btcConversions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    res.json(allConversions);
  });

  // BTC/USDT Conversion endpoint
  app.post("/api/convert", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
      const { fromCurrency, toCurrency, amount } = z.object({
        fromCurrency: z.enum(["BTC", "USDT"]),
        toCurrency: z.enum(["BTC", "USDT"]),
        amount: z.string().refine(value => Number.isFinite(Number(value)) && Number(value) > 0, "Amount must be positive"),
      }).parse(req.body);
      if (fromCurrency === toCurrency) return res.status(400).json({ message: "Choose two different currencies." });
      const btcPrice = await storage.getCurrentBtcPrice();
      const result = await storage.convertBtcUsdt(req.user!.id, fromCurrency, toCurrency, amount, btcPrice);
      const updatedUser = await storage.getUser(req.user!.id);
      return res.json({ message: "Conversion successful", from: fromCurrency, to: toCurrency, amount, ...result, balances: {
        btcBalance: updatedUser?.btcBalance || "0.00000000",
        usdtBalance: updatedUser?.usdtBalance || "0.00",
      } });
    } catch (error: any) {
      if (error?.message?.includes("Frozen or banned")) return res.status(403).json({ message: error.message });
      if (error?.message?.includes("User not found")) return res.status(404).json({ message: error.message });
      if (error?.message?.includes("Insufficient") || error?.message?.includes("capacity") || error?.message?.includes("decimal places") || error?.message?.includes("valid amount") || error?.message?.includes("different currencies")) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  // Referral Code Endpoints
  
  // Get user's referral codes
  app.get("/api/referral/codes", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const codes = await storage.getUserReferralCodes(req.user!.id);
      res.json(codes);
    } catch (error) {
      next(error);
    }
  });

  // Get referral slots (referred users and their status)
  app.get("/api/referral/slots", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const slots = await storage.getUserReferralSlots(req.user!.id);
      res.json(slots);
    } catch (error) {
      next(error);
    }
  });

  // Claim referral rewards
  app.post("/api/referral/claim", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const result = await storage.claimReferralRewards(req.user!.id);
      
      if (result.count === 0) {
        return res.status(400).json({ message: "No rewards to claim" });
      }

      res.json({
        message: "Referral rewards claimed successfully",
        usdtClaimed: result.usdtClaimed,
        hashClaimed: result.hashClaimed,
        rewardsClaimed: result.count
      });
    } catch (error) {
      next(error);
    }
  });

  // Get referral statistics
  app.get("/api/referral/stats", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const stats = await storage.getUserReferralStats(req.user!.id);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });
  
  return server;
}