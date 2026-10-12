import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import bitcoinLogo from "@assets/file_00000000221c61fab63936953b889556_1756633909848.png";
import { formatHashPower } from "@/lib/utils";

export default function GlobalInfoPage() {
  const { data: globalStats } = useQuery<any>({
    queryKey: ["/api/global-stats"],
    refetchInterval: 5000,
    staleTime: 3000
  });

  const totalMinted = Number(globalStats?.totalMinedSupply ?? 0);
  const circulating = Number(globalStats?.totalCirculation ?? globalStats?.circulatingSupply ?? 0);
  const totalSupply = globalStats?.maxSupply ?? 21000000;
  const percentMined = totalSupply > 0 ? (totalMinted / totalSupply) * 100 : 0;
  const targetPercent = 25; // 25% target for exchange listing
  
  const globalHashrate = Number(globalStats?.totalHashrate ?? 0);
  const currentBlockReward = Number(globalStats?.blockReward ?? globalStats?.currentBlockReward ?? 0);
  const currentBlockHeight = Number(globalStats?.blockHeight ?? 0);
  
  const getHashrateDisplay = (hashrate: number) => {
    if (globalStats?.hashRateDisplay) return globalStats.hashRateDisplay;
    return formatHashPower(hashrate);
  };

  const stats = {
    totalDeposits: parseFloat(globalStats?.totalDeposits || "0"),
    totalWithdrawals: parseFloat(globalStats?.totalWithdrawals || "0"),
    activeMiners: globalStats?.activeMiners ?? 0,
    registeredUsers: globalStats?.userCount ?? 0,
    networkHashrate: globalHashrate,
    blockHeight: currentBlockHeight,
    blocksToday: globalStats?.blocksToday ?? 0,
    blockReward: currentBlockReward,
    difficulty: globalStats?.networkDifficulty ? parseFloat(globalStats.networkDifficulty) : null
  };

  return (
    <div className="mobile-page">
      {/* Header */}
      <div className="mobile-header">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 cyber-border rounded-xl flex items-center justify-center glow-bitcoin">
            <img src={bitcoinLogo} alt="B2B" className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-primary">GLOBAL INFO</h1>
            <p className="text-xs text-muted-foreground font-mono">
              Network Statistics
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mobile-content">
        {/* FOMO Ticker - Progress to 25% */}
        <div className="fomo-ticker">
          <div className="mb-3">
            <p className="text-xs font-mono text-muted-foreground mb-1">MINED SUPPLY PROGRESS</p>
            <p className="text-2xl font-display font-black text-primary">
              {percentMined.toFixed(2)}% / {targetPercent}%
            </p>
          </div>
          
          <div className="fomo-progress mb-3">
            <div 
              className="fomo-progress-bar"
              style={{ width: `${(percentMined / targetPercent) * 100}%` }}
            />
          </div>
          
          <p className="text-xs text-muted-foreground">
            When {targetPercent}% mined, B2B will list on exchanges → external withdrawals enabled
          </p>
        </div>

        {/* Mining Stats */}
        <Card className="mobile-card">
          <p className="text-sm font-mono text-muted-foreground mb-3">MINING STATISTICS</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">CIRCULATING</p>
              <p className="text-lg font-display font-bold text-primary">
                {circulating.toFixed(0)} B2B
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">TOTAL SUPPLY</p>
              <p className="text-lg font-display font-bold">
                {(totalSupply / 1000000).toFixed(1)}M
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">NETWORK HASHRATE</p>
              <p className="text-lg font-display font-bold text-chart-4">
                {getHashrateDisplay(stats.networkHashrate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">BLOCK REWARD</p>
              <p className="text-lg font-display font-bold text-accent">
                {stats.blockReward} B2B
              </p>
            </div>
          </div>
        </Card>

        {/* Network Activity */}
        <Card className="mobile-card">
          <p className="text-sm font-mono text-muted-foreground mb-3">NETWORK ACTIVITY</p>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Active Miners</span>
              <span className="text-sm font-display font-bold text-primary">
                {stats.activeMiners.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Registered Users</span>
              <span className="text-sm font-display font-bold">
                {stats.registeredUsers.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Blocks Today</span>
              <span className="text-sm font-display font-bold text-chart-4">
                {stats.blocksToday}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Block Height</span>
              <span className="text-sm font-display font-bold text-accent">
                #{stats.blockHeight.toLocaleString()}
              </span>
            </div>
          </div>
        </Card>

        {/* Financial Stats */}
        <Card className="mobile-card bg-gradient-to-br from-accent/10 to-chart-3/10">
          <p className="text-sm font-mono text-muted-foreground mb-3">FINANCIAL OVERVIEW</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">TOTAL DEPOSITS</p>
              <p className="text-lg font-display font-bold text-accent">
                ${(stats.totalDeposits / 1000).toFixed(1)}K
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">WITHDRAWALS</p>
              <p className="text-lg font-display font-bold text-chart-3">
                ${(stats.totalWithdrawals / 1000).toFixed(1)}K
              </p>
            </div>
          </div>
        </Card>

        {/* Recent Blocks with Dynamic Rewards */}
        <Card className="mobile-card">
          <p className="text-sm font-mono text-muted-foreground mb-3">RECENT BLOCKS</p>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map(offset => {
              const blockNum = currentBlockHeight - offset;
              const blockReward = currentBlockReward; // Fixed 50 B2B per block
              return (
                <div key={blockNum} className="flex justify-between items-center p-2 bg-background rounded">
                  <span className="text-xs font-mono">Block #{blockNum.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">{blockReward} B2B</span>
                  <span className="text-xs text-primary">✓ Mined</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Live Activity Feed */}
        <Card className="mobile-card">
          <p className="text-sm font-mono text-muted-foreground mb-3">LIVE ACTIVITY</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-primary rounded-full mining-pulse"></div>
              <span className="text-muted-foreground">User mined 0.0234 B2B</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-accent rounded-full"></div>
              <span className="text-muted-foreground">New deposit: 50 USDT</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-chart-4 rounded-full"></div>
              <span className="text-muted-foreground">100 GH/s purchased</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-primary rounded-full mining-pulse"></div>
              <span className="text-muted-foreground">Block #{currentBlockHeight} mined</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}