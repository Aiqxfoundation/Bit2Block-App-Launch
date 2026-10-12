import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { formatHashPower } from "@/lib/utils";

export default function MiningPage() {
  const { user, logoutMutation } = useAuth();
  const [blockTimer, setBlockTimer] = useState(0);
  const { data: miningInfo } = useQuery<any>({ queryKey: ["/api/mining/info"], refetchInterval: 15000 });
  const { data: globalStats } = useQuery<any>({ queryKey: ["/api/global-stats"], refetchInterval: 15000 });
  const { data: recentBlocks = [] } = useQuery<any[]>({ queryKey: ["/api/mining/blocks"], refetchInterval: 15000 });
  const minedBlocks = Number(miningInfo?.blockHeight ?? globalStats?.blockHeight ?? 0);
  const globalHashRate = Number(globalStats?.totalHashrate ?? miningInfo?.totalHashPower ?? 0);
  const currentReward = Number(miningInfo?.blockReward ?? globalStats?.blockReward ?? 0);
  const networkDifficulty: number | null = null; // Difficulty is not implemented by this scheduled ledger engine.

  useEffect(() => {
    setBlockTimer(Math.max(0, Number(miningInfo?.timeUntilNextBlock ?? 0)));
  }, [miningInfo?.timeUntilNextBlock]);

  useEffect(() => {
    const timer = setInterval(() => setBlockTimer(prev => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatHashrate = (value: number) => formatHashPower(value);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const blockProgress = Math.max(0, Math.min(100, ((3600 - blockTimer) / 3600) * 100));

  return (
    <div className="min-h-screen matrix-bg">
      {/* Floating mining particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className={`absolute w-1 h-1 bg-primary rounded-full mining-float opacity-${[30, 40, 50, 60][i % 4]}`}
            style={{
              top: `${20 + (i * 10)}%`,
              left: `${10 + (i * 12)}%`,
              animationDelay: `${i * 0.5}s`
            }}
          />
        ))}
      </div>

      {/* Cyber Header */}
      <header className="bg-card/80 border-b border-primary/20 sticky top-0 z-50 backdrop-blur-md">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div className="w-12 h-12 cyber-border rounded-xl flex items-center justify-center glow-bitcoin">
                  <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center mining-pulse">
                    <span className="text-white font-bold text-xs">₿</span>
                  </div>
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full mining-pulse"></div>
              </div>
              <div>
                <h1 className="text-2xl font-display font-bold text-primary glow-green">
                  QUANTUM<span className="text-chart-4">MINE</span>
                </h1>
                <p className="text-xs text-muted-foreground font-mono">Live scheduled block ledger</p>
              </div>
            </div>
            
            <nav className="hidden md:flex items-center space-x-8">
              <Link href="/" className="text-foreground hover:text-primary transition-colors font-medium">
                <i className="fas fa-home mr-2"></i>Home
              </Link>
              <button className="text-primary font-medium transition-all hover:glow-green font-display">
                <i className="fas fa-microchip mr-2 mining-spin"></i>Mining
              </button>
              <Link href="/dashboard" className="text-foreground hover:text-primary transition-colors font-medium">
                <i className="fas fa-satellite-dish mr-2"></i>Control
              </Link>
              {user && (
                <button 
                  onClick={() => logoutMutation.mutate()}
                  className="text-foreground hover:text-destructive transition-colors"
                >
                  <i className="fas fa-sign-out-alt mr-2"></i>Exit
                </button>
              )}
            </nav>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Mining Status Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-display font-black mb-4">
            <span className="text-primary glow-green">QUANTUM</span>
            <span className="text-chart-4 glow-bitcoin ml-4">MINING</span>
          </h1>
          <p className="text-xl text-muted-foreground font-mono">Live database-backed network statistics</p>
        </div>

        {/* Real-Time Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <Card className="hologram-card border-primary/30">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-mono">GLOBAL_HASHRATE</p>
                  <p className="text-2xl font-display font-black text-primary" data-testid="text-global-hashrate">
                    {formatHashrate(globalHashRate)}
                  </p>
                </div>
                <div className="w-12 h-12 cyber-border rounded-lg flex items-center justify-center glow-green">
                  <i className="fas fa-network-wired text-primary mining-pulse"></i>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="hologram-card border-chart-4/30">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-mono">BLOCKS_MINED</p>
                  <p className="text-2xl font-display font-black text-chart-4" data-testid="text-blocks-mined">
                    {minedBlocks.toLocaleString()}
                  </p>
                </div>
                <div className="w-12 h-12 cyber-border rounded-lg flex items-center justify-center glow-bitcoin">
                  <i className="fas fa-cube text-chart-4 mining-spin"></i>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="hologram-card border-accent/30">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-mono">CURRENT_REWARD</p>
                  <p className="text-2xl font-display font-black text-accent" data-testid="text-current-reward">
                    {currentReward} B2B
                  </p>
                </div>
                <div className="w-12 h-12 cyber-border rounded-lg flex items-center justify-center">
                  <i className="fas fa-coins text-accent mining-pulse"></i>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="hologram-card border-chart-3/30">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-mono">DIFFICULTY</p>
                  <p className="text-2xl font-display font-black text-chart-3" data-testid="text-difficulty">
                    {networkDifficulty === null ? "N/A" : Number(networkDifficulty).toFixed(3)}
                  </p>
                </div>
                <div className="w-12 h-12 cyber-border rounded-lg flex items-center justify-center">
                  <i className="fas fa-shield-alt text-chart-3 mining-pulse"></i>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Block Mining Progress */}
        <div className="grid lg:grid-cols-2 gap-8 mb-12">
          <Card className="cyber-border bg-gradient-to-br from-card/80 to-background/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center font-display text-2xl">
                <div className="w-8 h-8 bg-primary rounded-full mr-3 mining-pulse glow-green"></div>
                NEXT BLOCK TIMER
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-6">
                <div className="text-6xl font-display font-black text-primary mb-2 glow-green" data-testid="text-block-timer">
                  {formatTime(blockTimer)}
                </div>
                <p className="text-muted-foreground font-mono">Estimated time until the next scheduled ledger block</p>
              </div>
              
              <div className="space-y-4">
                <div className="flex justify-between text-sm font-mono">
                  <span>Progress</span>
                  <span>{blockProgress.toFixed(1)}%</span>
                </div>
                <Progress value={blockProgress} className="h-3 bg-secondary" />
                <div className="flex justify-between text-xs text-muted-foreground font-mono">
                  <span>Started</span>
                  <span>Next block #{minedBlocks + 1}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cyber-border bg-gradient-to-br from-card/80 to-background/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center font-display text-2xl">
                <div className="w-8 h-8 bg-chart-4 rounded-full mr-3 mining-pulse glow-bitcoin"></div>
                3D MINING VISUALIZATION
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative h-48 flex items-center justify-center">
                {/* 3D Block Visualization */}
                <div className="relative">
                  {/* Main mining block */}
                  <div className="w-32 h-32 block-3d cyber-border rounded-xl bg-gradient-to-br from-primary/20 to-chart-4/20 flex items-center justify-center relative">
                    <div className="w-16 h-16 bg-orange-500 rounded-lg flex items-center justify-center mining-float">
                      <span className="text-white font-bold text-2xl">₿</span>
                    </div>
                    
                    {/* Mining particles around the block */}
                    <div className="absolute -top-2 -left-2 w-4 h-4 bg-primary rounded-full mining-pulse"></div>
                    <div className="absolute -top-2 -right-2 w-3 h-3 bg-chart-4 rounded-full mining-pulse" style={{animationDelay: '0.5s'}}></div>
                    <div className="absolute -bottom-2 -left-2 w-3 h-3 bg-accent rounded-full mining-pulse" style={{animationDelay: '1s'}}></div>
                    <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-chart-3 rounded-full mining-pulse" style={{animationDelay: '1.5s'}}></div>
                  </div>
                  
                  {/* Progress ring around the block */}
                  <div className="absolute inset-0 rounded-xl border-4 border-transparent" 
                       style={{
                         background: `conic-gradient(from 0deg, hsl(142, 76%, 36%) ${blockProgress}%, transparent ${blockProgress}%)`,
                         borderImage: `conic-gradient(from 0deg, hsl(142, 76%, 36%) ${blockProgress}%, transparent ${blockProgress}%) 1`
                       }}>
                  </div>
                </div>
              </div>
              
              <div className="text-center mt-4">
                <p className="text-sm text-muted-foreground font-mono">
                  Next scheduled block #{minedBlocks + 1} • {blockProgress.toFixed(1)}% elapsed
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Blocks & Mining Activity */}
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Card className="hologram-card">
              <CardHeader>
                <CardTitle className="flex items-center font-display text-xl">
                  <i className="fas fa-history text-primary mr-3"></i>
                  RECENT BLOCKS
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentBlocks.length === 0 ? <p className="text-sm text-muted-foreground">No persisted blocks have been generated yet.</p> : recentBlocks.map((block: any) => {
                    return (
                      <div key={block.id || block.blockNumber} className="flex items-center justify-between p-4 bg-background/50 rounded-lg border border-primary/20">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 cyber-border rounded-lg flex items-center justify-center">
                            <div className="w-6 h-6 bg-orange-500 rounded flex items-center justify-center">
                              <span className="text-white font-bold text-xs">₿</span>
                            </div>
                          </div>
                          <div>
                            <p className="font-display font-bold text-foreground">Block #{block.blockNumber}</p>
                            <p className="text-sm text-muted-foreground font-mono">{block.timestamp ? new Date(block.timestamp).toLocaleString() : "Time unavailable"}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-display font-bold text-primary">{Number(block.reward || 0).toLocaleString()} B2B</p>
                          <p className="text-sm text-muted-foreground font-mono">{formatHashrate(Number(block.globalHashrate ?? block.totalHashPower ?? 0))}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="hologram-card">
              <CardHeader>
                <CardTitle className="flex items-center font-display text-xl">
                  <i className="fas fa-cogs text-chart-4 mr-3"></i>
                  MINING CONTROLS
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Link href="/dashboard">
                    <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-display" data-testid="button-dashboard">
                      <i className="fas fa-tachometer-alt mr-2"></i>
                      VIEW DASHBOARD
                    </Button>
                  </Link>
                  
                  <Link href={user ? "/dashboard" : "/auth"}>
                    <Button className="w-full bg-gradient-to-r from-chart-4 to-accent text-primary-foreground hover:scale-105 transition-all font-display" data-testid="button-start-mining">
                      <i className="fas fa-rocket mr-2"></i>
                      {user ? "OPEN MINING DASHBOARD" : "START MINING"}
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}