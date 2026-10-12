import { useState, useEffect, useMemo, memo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { useMiningWebSocket } from "@/hooks/useWebSocket";
import { BlockParticipationList } from "@/components/BlockParticipationList";
import { formatHashPower } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff } from "lucide-react";
import { 
  Activity, 
  BarChart3, 
  Cpu, 
  Hash, 
  Zap, 
  TrendingUp, 
  Target, 
  Timer, 
  Award, 
  Coins, 
  Percent,
  Settings,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Gauge,
  Rocket,
  Loader2,
  AlertTriangle,
  Clock,
  Bitcoin
} from "lucide-react";

interface SupplyMetrics {
  totalMined: string;
  circulating: string;
  maxSupply: string;
  percentageMined: string;
  currentBlockReward: string;
  totalBlocks: number;
  totalHashrate?: number;
  halvingProgress: {
    current: number;
    nextHalving: number;
    blocksRemaining: number;
  };
}

interface MiningInfo {
  blockHeight: number;
  [key: string]: any; // Allow other properties that might exist
}

export default function MiningDashboard() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [blockTimer, setBlockTimer] = useState(3600); // 1 hour in seconds
  const [hashDisplay, setHashDisplay] = useState<string>('No block generated yet');
  const [miningActive, setMiningActive] = useState(true);
  const [blockProgress, setBlockProgress] = useState(0);
  const [activeTab, setActiveTab] = useState('mining'); // Tab state
  const [coins, setCoins] = useState<number[]>([]);
  const [isBlockAnimating, setIsBlockAnimating] = useState(false);
  
  // WebSocket connection
  const { isConnected, lastBlock, userStats: wsUserStats } = useMiningWebSocket(user?.id);
  
  // Display modes are visual presets only; they never alter server hashrate or rewards.
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(false);
  const [selectedMiningMode, setSelectedMiningMode] = useState<keyof typeof miningModes>('balanced');

  // Mining Modes Configuration
  const miningModes = {
    eco: {
      name: 'Eco Mode',
      icon: Timer,
      color: 'text-chart-2',
      description: 'Calm visual preset' 
    },
    balanced: {
      name: 'Balanced',
      icon: Gauge,
      color: 'text-chart-1',
      description: 'Standard visual preset' 
    },
    performance: {
      name: 'High Performance',
      icon: Rocket,
      color: 'text-chart-4',
      description: 'High-energy visual preset' 
    }
  };
  
  // Fetch supply metrics
  const { data: supplyMetrics } = useQuery<SupplyMetrics>({
    queryKey: ['/api/supply-metrics'],
    staleTime: 5000,
    gcTime: 60000,
    refetchInterval: 10000
  });
  
  // Fetch mining status (includes personal block height, suspension status, etc.)
  const { data: miningStatus } = useQuery<{
    miningActive: boolean;
    lockedHashPower: string;
    hashPower: string;
    currentBlockNumber: number;
    timeUntilNextBlock: number;
    blocksUntilSuspension: number;
  }>({
    queryKey: ['/api/mining/status'],
    enabled: !!user,
    refetchInterval: 10000 // Refetch every 10 seconds
  });
  
  // Fetch mining info
  const { data: miningInfo } = useQuery<MiningInfo>({
    queryKey: ['/api/mining/info'],
    refetchInterval: 30000 // Refetch every 30 seconds
  });
  
  // Display persisted block rewards; wallet balance changes only when pending rewards are claimed.
  const { data: miningHistory, isLoading: miningHistoryLoading } = useQuery<any[]>({
    queryKey: ['/api/mining/history'],
    enabled: !!user,
    refetchInterval: 30000
  });
  const { data: unclaimedBlocks = [] } = useQuery<any[]>({
    queryKey: ['/api/mining/unclaimed-blocks'],
    enabled: !!user,
    refetchInterval: 15000,
  });
  const pendingBlockNumbers = useMemo(() => new Set((unclaimedBlocks || []).map((block: any) => Number(block.blockNumber))), [unclaimedBlocks]);
  const miningSuspended = Boolean(user?.miningSuspended) || Boolean(
    miningStatus && user?.hasStartedMining && !miningStatus.miningActive && Number(user?.hashPower || 0) > 0
  );
  const recentRecordedRewards = useMemo(() => (miningHistory || []).reduce((sum: number, row: any) => sum + Number(row.reward || 0), 0), [miningHistory]);
  const rewardsLast24Hours = useMemo(() => (miningHistory || []).reduce((sum: number, row: any) => {
    const timestamp = row.claimedAt ? new Date(row.claimedAt).getTime() : 0;
    return timestamp >= Date.now() - 24 * 60 * 60 * 1000 ? sum + Number(row.reward || 0) : sum;
  }, 0), [miningHistory]);
  
  // Enhanced Mining Calculations with Modes
  // hashPower is stored in MH/s units (1 hashPower = 1 MH/s = 1000 KH/s)
  const baseHashrate = parseFloat(user?.hashPower || '0');
  const currentMode = miningModes[selectedMiningMode];
  // Mode multipliers are presentation/gameplay only and must never alter real mining power.
  const miningEligible = miningStatus?.miningActive === true && user?.isFrozen !== true && user?.isBanned !== true;
  const myHashrate = miningEligible ? parseFloat(miningStatus?.lockedHashPower || user?.lockedHashPower || '0') : 0;
  // Never substitute a user's own power for the network total; zero means no eligible network power.
  const globalHashrate = Math.max(0, Number(supplyMetrics?.totalHashrate || 0));

  // Memoized reward calculations for performance
  const rewardCalculations = useMemo(() => {
    const currentBlockReward = Number(miningInfo?.blockReward ?? 3200); // Next scheduled B2B block reward from server
    const myMiningShare = globalHashrate > 0 && myHashrate > 0 ? Math.round((myHashrate / globalHashrate) * 100 * 1000000) / 1000000 : 0; // Percentage with 6 decimals precision
    const myEstimatedReward = globalHashrate > 0 && myHashrate > 0 ? Math.round((myHashrate / globalHashrate) * currentBlockReward * 100000000) / 100000000 : 0; // B2B per block with 8 decimals
    const dailyEstimatedRewards = Math.round(myEstimatedReward * 24 * 10000) / 10000; // 24 hourly blocks per day
    const isNewUser = myHashrate === 0;
    
    return {
      currentBlockReward,
      myMiningShare,
      myEstimatedReward,
      dailyEstimatedRewards,
      isNewUser
    };
  }, [myHashrate, globalHashrate, miningInfo?.blockReward]);
  
  // Destructure for backward compatibility
  const { currentBlockReward, myMiningShare, myEstimatedReward, dailyEstimatedRewards, isNewUser } = rewardCalculations;

  // Only the server-locked eligible snapshot represents real reward-bearing power.
  const effectiveHashrate = myHashrate;

  // Update when new block arrives from WebSocket
  useEffect(() => {
    if (lastBlock) {
      console.log('New block received via WebSocket:', lastBlock);
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/mining/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mining/unclaimed-blocks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/supply-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mining/info'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mining/blocks'] });
      if (miningEligible) setCoins(c => [...c, Date.now()]);
      // Animate only when a persisted server block is received.
      setIsBlockAnimating(true);
      setTimeout(() => setIsBlockAnimating(false), 500);
    }
  }, [lastBlock, miningEligible]);
  
  // Control mining animation based on WebSocket suspension status
  useEffect(() => {
    if (wsUserStats) {
      const isMining = !wsUserStats.miningSuspended && wsUserStats.miningActive;
      setMiningActive(isMining);
    }
  }, [wsUserStats]);

  // Countdown is seeded from the server's latest committed block timestamp.
  useEffect(() => {
    if (miningInfo?.timeUntilNextBlock !== undefined) {
      setBlockTimer(Math.max(0, Number(miningInfo.timeUntilNextBlock)));
    }
  }, [miningInfo?.timeUntilNextBlock]);

  useEffect(() => {
    const timer = setInterval(() => setBlockTimer(prev => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    setBlockProgress(((3600 - blockTimer) / 3600) * 100);
  }, [blockTimer]);
  
  // Map persisted mining history and pending ledger status for BlockParticipationList
  const formattedBlocks = useMemo(() => {
    if (!miningHistory || !Array.isArray(miningHistory)) return [];
    return miningHistory.map((block: any) => ({
      blockNumber: block.blockNumber,
      blockHeight: block.blockNumber,
      totalReward: block.blockReward ?? "0",
      blockReward: block.blockReward ?? "0",
      blockHash: block.blockHash ?? undefined,
      userShare: block.reward || "0",
      timestamp: block.claimedAt || block.timestamp,
      claimed: !pendingBlockNumbers.has(Number(block.blockNumber)),
      globalHashrate: block.globalHashrate ?? "0",
    }));
  }, [miningHistory, pendingBlockNumbers]);
  
  // Memoized hashrate display function
  // Input is in MH/s (1 hashPower = 1 MH/s = 1000 KH/s)
  const getHashrateDisplay = useMemo(() => (hashrate: number) => formatHashPower(hashrate), []);

  // Display the latest persisted server block hash, not a random client-generated string.
  useEffect(() => {
    setHashDisplay(miningInfo?.latestBlockHash || 'No block generated yet');
  }, [miningInfo?.latestBlockHash]);

  const handleClaimCoins = () => {
    if (coins.length > 0) {
      const coinCount = coins.length;
      setCoins([]);
      toast({ 
        title: `Visual Mining Complete!`, 
        description: `Cleared ${coinCount} block animations. Check your actual rewards in Account page.` 
      });
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-spinner fa-spin text-4xl text-primary mb-4"></i>
          <p className="text-sm text-muted-foreground">Loading Mining Factory...</p>
        </div>
      </div>
    );
  }

  // Redirect to auth if not logged in
  if (!user) {
    setLocation('/auth');
    return null;
  }

  return (
    <div className="min-h-screen pb-24 relative overflow-hidden">
      {/* Enhanced Background Effects */}
      <div className="fixed inset-0 bitcoin-grid opacity-20"></div>
      
      {/* Advanced Hash Rain Effect */}
      <div className="fixed inset-0 pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute font-mono text-xs text-primary/30"
            style={{
              left: `${8.33 * i}%`,
              animation: `hash-stream ${15 + i * 2}s linear infinite`, // Slower for performance
              animationDelay: `${i * 0.3}s`
            }}
          >
            {hashDisplay.substring(i * 4, (i * 4) + 8)}
          </div>
        ))}
      </div>

      {/* Professional Header */}
      <div className="relative z-10">
        <div className="mobile-header">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-br from-primary to-chart-4 rounded-xl flex items-center justify-center">
                <Cpu className="w-6 h-6 text-black" />
              </div>
              <div>
                <h1 className="text-xl font-heading font-bold text-gradient">Mining Operations</h1>
                <p className="text-xs text-muted-foreground font-mono">Professional Dashboard</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2">
                <div className="hashrate-indicator">
                  <Hash className="w-4 h-4 mr-1" />
                  <span className="font-mono font-bold">{getHashrateDisplay(myHashrate)}</span>
                </div>
                <Badge 
                  variant="outline" 
                  className={`flex items-center space-x-1 ${isConnected ? 'bg-chart-2/10 border-chart-2 text-chart-2' : 'bg-destructive/10 border-destructive text-destructive'}`}
                  data-testid="ws-connection-status"
                >
                  {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  <span className="text-xs font-mono">{isConnected ? 'Live' : 'Offline'}</span>
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvancedAnalytics(!showAdvancedAnalytics)}
                className="text-chart-3 hover:text-chart-3/80"
                data-testid="button-toggle-analytics"
              >
                {showAdvancedAnalytics ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          
          {/* Mining Mode Selector */}
          <div className="mt-4 p-3 bg-card/50 border border-border rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-heading font-semibold text-foreground">Active Mode</span>
              <div className="flex items-center text-xs text-muted-foreground font-mono">
                <Target className="w-3 h-3 mr-1" />
                Visual preset only
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(miningModes).map(([key, mode]) => {
                const IconComponent = mode.icon;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedMiningMode(key as keyof typeof miningModes)}
                    className={`p-2 rounded-lg border transition-all ${
                      selectedMiningMode === key
                        ? 'border-primary bg-primary/10 shadow-lg'
                        : 'border-border bg-muted/50 hover:border-primary/50'
                    }`}
                    data-testid={`button-mode-${key}`}
                  >
                    <div className="text-center">
                      <IconComponent className={`w-4 h-4 mx-auto mb-1 ${mode.color}`} />
                      <div className="text-xs font-medium">{mode.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mobile-content space-y-6">{/* Content continues here */}
        
        {/* Enhanced 3D Mining Visualization */}
        <div className="analytics-card relative">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-heading font-bold text-gradient">Mining Engine</h3>
            <div className={`flex items-center px-3 py-1 rounded-full text-xs font-mono ${
              (wsUserStats ? !wsUserStats.miningSuspended && wsUserStats.miningActive : miningActive) && !isNewUser ? 'bg-chart-2/20 text-chart-2' : 'bg-destructive/20 text-destructive'
            }`}>
              <div className={`w-2 h-2 rounded-full mr-2 ${
                (wsUserStats ? !wsUserStats.miningSuspended && wsUserStats.miningActive : miningActive) && !isNewUser ? 'bg-chart-2' : 'bg-destructive'
              } animate-pulse`}></div>
              {isNewUser ? 'INACTIVE' : (wsUserStats ? !wsUserStats.miningSuspended && wsUserStats.miningActive : miningActive) ? 'OPERATIONAL' : 'MAINTENANCE'}
            </div>
          </div>
          
          <div className="relative h-48 flex flex-col items-center justify-center">
            <div className="relative">
              {/* Enhanced 3D Block */}
              <div className={`mining-block-3d ${isBlockAnimating ? 'block-pulse' : ''}`}>
                <div className="block-face block-front"></div>
                <div className="block-face block-back"></div>
                <div className="block-face block-left"></div>
                <div className="block-face block-right"></div>
                <div className="block-face block-top"></div>
                <div className="block-face block-bottom"></div>
              </div>
              
              {/* Block Progress */}
              {!isNewUser && (
                <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 text-center">
                  <div className="text-xs text-muted-foreground mb-2">Block #{(miningStatus as any)?.currentBlockNumber ?? '...'} Progress</div>
                  <div className="text-lg font-mono font-bold text-primary mb-2">{formatTime(blockTimer)}</div>
                  <div className="w-40 h-2 bg-background rounded-full overflow-hidden border border-border">
                    <div 
                      className="h-full bg-gradient-to-r from-primary to-chart-4 transition-all duration-1000 relative"
                      style={{ width: `${blockProgress}%` }}
                    >
                      <div className="absolute inset-0 bg-white/30 animate-pulse"></div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Est. Reward: {myEstimatedReward.toFixed(8)} B2B
                  </div>
                </div>
              )}
            </div>
          </div>
          
        </div>
        
        {/* Enhanced Coins Collection Area */}
        <div className="analytics-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-heading font-bold text-gradient">Block Rewards</h3>
            <div className="flex items-center text-xs text-muted-foreground font-mono">
              <Coins className="w-3 h-3 mr-1" />
              {coins.length} Visual Blocks
            </div>
          </div>
          
          <div className="relative min-h-[120px]">
            {coins.length > 0 ? (
              <div>
                <div className="flex flex-wrap gap-2 mb-4 justify-center p-3 bg-gradient-to-br from-chart-4/10 to-chart-2/10 rounded-lg border border-border">
                  {coins.slice(-15).map((coin, index) => (
                    <div 
                      key={coin} 
                      className="coin-3d"
                      style={{ animationDelay: `${index * 0.1}s` }}
                    >
                      <Coins className="w-6 h-6 text-chart-4" />
                    </div>
                  ))}
                  {coins.length > 15 && (
                    <div className="flex items-center justify-center w-8 h-8 text-xs font-mono font-bold text-muted-foreground bg-muted rounded-full">
                      +{coins.length - 15}
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="data-card p-3">
                    <div className="text-xs text-muted-foreground mb-1">Visual Blocks</div>
                    <div className="text-lg font-mono font-bold text-chart-4">{coins.length}</div>
                  </div>
                  <div className="data-card p-3">
                    <div className="text-xs text-muted-foreground mb-1">Est. Value</div>
                    <div className="text-lg font-mono font-bold text-chart-2">
                      {(coins.length * myEstimatedReward).toFixed(6)} B2B
                    </div>
                  </div>
                </div>
                
                <Button
                  className="w-full btn-primary"
                  onClick={handleClaimCoins}
                  data-testid="button-claim-coins"
                >
                  <Award className="w-4 h-4 mr-2" />
                  CLEAR ANIMATIONS ({coins.length} blocks)
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <div className="w-12 h-12 bg-muted/50 rounded-full flex items-center justify-center mb-3">
                  <Coins className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  {isNewUser ? 'Activate mining to see visual feedback' : 'Visual block animations will appear here'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Visual feedback only - Real rewards tracked in Account page
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Enhanced Personal Mining Stats */}
        <div className="analytics-card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-chart-1 to-chart-1/80 rounded-lg flex items-center justify-center">
                <Hash className="w-5 h-5 text-black" />
              </div>
              <div>
                <h2 className="text-lg font-heading font-bold text-gradient">Mining Performance</h2>
                <p className="text-xs text-muted-foreground font-mono">Personal Analytics</p>
              </div>
            </div>
            <div className="performance-indicator">
              <TrendingUp className="w-4 h-4 mr-1" />
              {currentMode.name}
            </div>
          </div>

          {/* Enhanced Hashrate Display */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="data-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Eligible Locked Hashrate</span>
                <Hash className="w-4 h-4 text-chart-1" />
              </div>
              <div className="text-2xl font-mono font-bold text-gradient">
                {getHashrateDisplay(effectiveHashrate)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Owned: {getHashrateDisplay(baseHashrate)} • Visual preset: {currentMode.name}
              </div>
            </div>

            <div className="data-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Network Share</span>
                <Percent className="w-4 h-4 text-chart-3" />
              </div>
              <div className="text-2xl font-mono font-bold text-chart-3">
                {myMiningShare.toFixed(6)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                of {getHashrateDisplay(globalHashrate)} global
              </div>
            </div>
          </div>

          {/* Live metrics only; no synthetic uptime or performance scores. */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="data-card p-3">
              <div className="text-xs text-muted-foreground mb-1">Mining Status</div>
              <div className="text-lg font-mono font-bold text-chart-2">{miningEligible ? "Eligible" : "Paused"}</div>
            </div>
            <div className="data-card p-3">
              <div className="text-xs text-muted-foreground mb-1">History Rows</div>
              <div className="text-lg font-mono font-bold text-chart-4">{(miningHistory || []).length}</div>
            </div>
            <div className="data-card p-3">
              <div className="text-xs text-muted-foreground mb-1">Recorded Rewards</div>
              <div className="text-lg font-mono font-bold text-chart-1">{recentRecordedRewards.toFixed(4)} B2B</div>
            </div>
          </div>

          {/* Current Block Progress */}
          {!isNewUser && (
            <div className="hashrate-efficiency mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-heading font-semibold text-foreground">Current Block Mining</span>
                <span className="text-xs font-mono text-primary">{formatTime(blockTimer)}</span>
              </div>
              <div className="h-4 bg-background rounded-full overflow-hidden border border-border">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-chart-4 transition-all duration-1000 relative"
                  style={{ width: `${blockProgress}%` }}
                >
                  <div className="absolute inset-0 bg-white/30 animate-pulse"></div>
                </div>
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>Block #{(miningStatus as any)?.currentBlockNumber ?? '...'}</span>
                <span>Estimated: {myEstimatedReward.toFixed(8)} B2B</span>
              </div>
            </div>
          )}

          {/* Earnings Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="data-card p-3">
              <div className="text-xs text-muted-foreground mb-1">Per Block</div>
              <div className="text-lg font-mono font-bold text-chart-3">{myEstimatedReward.toFixed(6)}</div>
              <div className="text-xs text-muted-foreground">B2B</div>
            </div>
            <div className="data-card p-3">
              <div className="text-xs text-muted-foreground mb-1">Daily Est.</div>
              <div className="text-lg font-mono font-bold text-chart-4">{dailyEstimatedRewards.toFixed(4)}</div>
              <div className="text-xs text-muted-foreground">B2B</div>
            </div>
            <div className="data-card p-3">
              <div className="text-xs text-muted-foreground mb-1">Network Share</div>
              <div className="text-lg font-mono font-bold text-chart-5">{myMiningShare.toFixed(6)}%</div>
              <div className="text-xs text-muted-foreground">Current eligible power</div>
            </div>
          </div>
        </div>

        {/* Advanced Analytics (when toggled) */}
        {showAdvancedAnalytics && (
          <div className="analytics-card border-chart-3/30">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-heading font-bold text-chart-3 flex items-center">
                <BarChart3 className="w-5 h-5 mr-2" />
                Advanced Analytics
              </h3>
              <div className="roi-indicator">
                <Gauge className="w-4 h-4 mr-1" />
                DETAILED
              </div>
            </div>
            
            <div className="space-y-4">
              {/* Network Analytics */}
              <div className="hashrate-efficiency">
                <h4 className="text-md font-heading font-semibold text-foreground mb-3">Network Status</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="data-card p-3">
                    <div className="text-xs text-muted-foreground mb-1">Global Hashrate</div>
                    <div className="text-sm font-mono font-bold text-chart-1">
                      {getHashrateDisplay(globalHashrate)}
                    </div>
                  </div>
                  <div className="data-card p-3">
                    <div className="text-xs text-muted-foreground mb-1">Network Growth</div>
                    <div className="text-sm font-mono font-bold text-chart-4">N/A</div>
                  </div>
                  <div className="data-card p-3">
                    <div className="text-xs text-muted-foreground mb-1">Difficulty</div>
                    <div className="text-sm font-mono font-bold text-chart-3">N/A</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mining Status Card - New Section */}
        <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-orange-500/20">
          <CardContent className="p-6">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-500 uppercase">TOTAL SUPPLY</p>
                <p className="text-lg font-bold text-orange-400">21.0M</p>
                <p className="text-xs text-gray-600">B2B</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">CIRCULATING SUPPLY</p>
                <p className="text-lg font-bold text-orange-400">
                  {supplyMetrics ? (parseFloat(supplyMetrics.circulating) / 1000000).toFixed(1) + 'M' : '0'}
                </p>
                <p className="text-xs text-gray-600">B2B</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">BLOCK HEIGHT</p>
                <p className="text-lg font-bold text-orange-400">#{supplyMetrics?.totalBlocks ?? miningInfo?.blockHeight ?? 0}</p>
                <p className="text-xs text-gray-600">CURRENT</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mining Metrics Grid - New Section */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-gray-900/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Zap className="h-8 w-8 text-yellow-500" />
                <div className="text-right">
                  <p className="text-xs text-gray-500">Network Share</p>
                  <p className="text-xl font-bold">{myMiningShare.toFixed(4)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gray-900/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Activity className="h-8 w-8 text-green-500" />
                <div className="text-right">
                  <p className="text-xs text-gray-500">Your Hashrate</p>
                  <p className="text-xl font-bold">{getHashrateDisplay(myHashrate)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gray-900/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Clock className="h-8 w-8 text-blue-500" />
                <div className="text-right">
                  <p className="text-xs text-gray-500">Est. Daily</p>
                  <p className="text-xl font-bold">{dailyEstimatedRewards.toFixed(4)}</p>
                  <p className="text-xs text-gray-600">B2B</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Supply Metrics Card - Original */}
        {supplyMetrics && (
          <Card className="mining-block relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-2xl"></div>
            
            <h3 className="text-lg font-heading font-bold mb-4">Network Supply Metrics</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="data-card">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground uppercase">Total Mined</span>
                  <i className="fas fa-coins text-primary"></i>
                </div>
                <div className="text-xl font-mono font-bold text-gradient">
                  {parseFloat(supplyMetrics.totalMined).toLocaleString()}
                </div>
                <div className="text-xs text-accent mt-1">
                  {supplyMetrics.percentageMined}% of max supply
                </div>
              </div>
              
              <div className="data-card">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground uppercase">Circulating</span>
                  <i className="fas fa-sync text-chart-3"></i>
                </div>
                <div className="text-xl font-mono font-bold text-chart-3">
                  {parseFloat(supplyMetrics.circulating).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  In wallets
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 rounded-lg bg-background">
                <div className="text-lg font-mono font-bold text-chart-2">{supplyMetrics.currentBlockReward}</div>
                <div className="text-xs text-muted-foreground">Block Reward</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-background">
                <div className="text-lg font-mono font-bold text-chart-4">{supplyMetrics.totalBlocks}</div>
                <div className="text-xs text-muted-foreground">Total Blocks</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-background">
                <div className="text-lg font-mono font-bold text-warning">{supplyMetrics.halvingProgress.blocksRemaining}</div>
                <div className="text-xs text-muted-foreground">Until Halving</div>
              </div>
            </div>
            
            <div className="mt-3 p-2 bg-primary/5 rounded-lg border border-primary/20">
              <div className="text-xs text-muted-foreground text-center">
                <span className="font-semibold">Max Supply:</span>
                <span className="font-mono ml-2 text-primary">21,000,000 B2B</span>
              </div>
            </div>
          </Card>
        )}
        
        {/* Rewards Section */}
        <Card className="mining-block relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-accent/20 to-transparent rounded-full blur-2xl"></div>
          
          <h3 className="text-lg font-heading font-bold mb-4">Mining Rewards</h3>
          
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs text-muted-foreground uppercase mb-1">Auto-Credited B2B Balance</div>
                <div className="text-3xl font-mono font-bold text-gradient-green">
                  {parseFloat(user?.b2bBalance || '0').toFixed(8)} B2B
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Daily Est.: {dailyEstimatedRewards.toFixed(4)} B2B
                </div>
              </div>
              <div className="text-right">
                {miningSuspended ? (
                  <>
                    <div className="text-xs text-orange-500 mb-1">⏸️ Mining Paused</div>
                    <div className="text-xs text-muted-foreground">Admin action required</div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground mb-1">Blocks auto-received</div>
                    <div className="text-xs text-warning">{user?.personalBlockHeight || 0}</div>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
              Each hourly block is credited to your B2B wallet automatically, based on your locked mining power.
            </div>
          </div>
        </Card>
        
        {/* Block Participation List */}
        <Card className="mining-block">
          <h3 className="text-lg font-heading font-bold mb-4">Block Participation History</h3>
          <BlockParticipationList 
            blocks={formattedBlocks}
            totalMined={recentRecordedRewards.toFixed(8)}
            participatedCount={formattedBlocks.length}
            isLoading={miningHistoryLoading}
            showClaimButton={false}
          />
        </Card>
        
        {/* My Miners Tab */}
        {activeTab === 'miners' && (
          <Card className="mining-block">
            <h3 className="text-lg font-heading font-bold mb-4">My Mining Equipment</h3>
            <div className="space-y-4">
              <div className="data-card">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-heading">Total Hashrate</span>
                  <i className="fas fa-microchip text-primary"></i>
                </div>
                <div className="text-2xl font-mono font-bold text-gradient">
                  {getHashrateDisplay(myHashrate)}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Network Share: {myMiningShare.toFixed(6)}%
                </div>
              </div>
              
              
            </div>
          </Card>
        )}
        
        {/* My Wallet Tab */}
        {activeTab === 'wallet' && (
          <div className="space-y-4">
            <Card className="mining-block">
              <div className="text-center mb-4">
                <i className="fas fa-user-circle text-4xl text-primary mb-2"></i>
                <h3 className="text-lg font-heading font-bold">{user?.username}</h3>
                <p className="text-xs text-muted-foreground">Wallet Overview</p>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Button 
                  className="btn-secondary h-auto py-3"
                  onClick={() => setLocation('/deposit')}
                  data-testid="button-deposit"
                >
                  <div className="text-center">
                    <i className="fas fa-download text-xl mb-1"></i>
                    <div className="text-sm font-heading">Deposit</div>
                  </div>
                </Button>
                <Button 
                  className="btn-secondary h-auto py-3"
                  onClick={() => setLocation('/withdraw')}
                  data-testid="button-withdraw"
                >
                  <div className="text-center">
                    <i className="fas fa-upload text-xl mb-1"></i>
                    <div className="text-sm font-heading">Withdraw</div>
                  </div>
                </Button>
              </div>
              
              <div className="space-y-3">
                <div className="data-card">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground uppercase">B2B Balance</span>
                    <i className="fas fa-coins text-primary"></i>
                  </div>
                  <div className="text-2xl font-mono font-bold text-gradient">
                    {parseFloat(user?.b2bBalance || '0').toFixed(4)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Mined tokens</div>
                </div>
                
                <div className="data-card">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground uppercase">USDT Balance</span>
                    <i className="fas fa-dollar-sign text-accent"></i>
                  </div>
                  <div className="text-2xl font-mono font-bold text-accent">
                    ${parseFloat(user?.usdtBalance || '0').toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Ready for investment</div>
                </div>
                
                <div className="data-card">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground uppercase">Pending Legacy Rewards</span>
                    <i className="fas fa-gift text-chart-3"></i>
                  </div>
                  <div className="text-2xl font-mono font-bold text-chart-3">
                    {parseFloat(user?.unclaimedBalance || '0').toFixed(4)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">New mining rewards are automatic</div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button 
                  onClick={() => setLocation('/transfer')}
                  className="data-card text-center py-2 transition-all hover:scale-105"
                  data-testid="button-transfer"
                >
                  <i className="fas fa-exchange-alt text-lg text-chart-4 mb-1"></i>
                  <div className="text-xs font-heading uppercase">Transfer</div>
                </button>
                <button 
                  onClick={() => setLocation('/referral')}
                  className="data-card text-center py-2 transition-all hover:scale-105"
                  data-testid="button-referral"
                >
                  <i className="fas fa-users text-lg text-chart-3 mb-1"></i>
                  <div className="text-xs font-heading uppercase">Referral</div>
                </button>
              </div>
            </Card>
          </div>
        )}

        {/* Mining History */}
        <Card className="mining-block">
          <h3 className="text-lg font-heading font-bold mb-4">Recent Blocks</h3>
          <div className="space-y-2">
            {(miningHistory || []).slice(0, 5).length === 0 ? <p className="text-sm text-muted-foreground">No mining rewards recorded yet.</p> : (miningHistory || []).slice(0, 5).map((item: any) => (
              <div key={item.id || item.blockNumber} className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
                    <i className="fas fa-cube text-primary text-xs"></i>
                  </div>
                  <div>
                    <div className="text-sm font-mono">Block #{item.blockNumber}</div>
                    <div className="text-xs text-muted-foreground">{item.claimedAt ? new Date(item.claimedAt).toLocaleString() : "Time unavailable"}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-bold text-accent">+{Number(item.reward || 0).toFixed(8)} B2B</div>
                  <div className="text-xs text-green-500">Recorded</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Performance Stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="data-card">
            <div className="text-xs text-muted-foreground mb-1">24h Earnings</div>
            <div className="text-xl font-mono font-bold text-gradient-green">{rewardsLast24Hours.toFixed(8)} B2B</div>
            <div className="text-xs text-muted-foreground">From loaded reward history</div>
          </Card>
          <Card className="data-card">
            <div className="text-xs text-muted-foreground mb-1">Total Mined</div>
            <div className="text-xl font-mono font-bold text-gradient">{recentRecordedRewards.toFixed(8)} B2B</div>
            <div className="text-xs text-muted-foreground">Loaded reward history (up to 50 rows)</div>
          </Card>
        </div>
      </div>
    </div>
  );
}