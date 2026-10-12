import { useQuery } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { MyMinersGrid } from "@/components/account/MyMinersGrid";
import { HashratePanel } from "@/components/account/HashratePanel";
import { BlocksTable } from "@/components/account/BlocksTable";
import { SecuritySettings } from "@/components/account/SecuritySettings";
import { KnowledgeGrid } from "@/components/account/KnowledgeGrid";

/**
 * Account hub: identity, mining equipment, network performance, block ledger,
 * security and reference material — one theme, one accent, log out at the end.
 */
export default function AccountPage() {
  const { user, logoutMutation } = useAuth();

  const { data: miningStatus } = useQuery<any>({
    queryKey: ["/api/mining/status"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const { data: miningInfo } = useQuery<any>({
    queryKey: ["/api/mining/info"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const { data: miningHistory, isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/mining/history"],
    enabled: !!user,
  });

  const { data: pendingBlocks } = useQuery<any[]>({
    queryKey: ["/api/mining/unclaimed-blocks"],
    enabled: !!user,
  });

  const twoFactorEnabled = Boolean(user?.twoFactorEnabled);

  return (
    <div className="mobile-page">
      <div className="mobile-header">
        <h1 className="text-lg font-display font-bold text-primary">ACCOUNT</h1>
      </div>

      <div className="mobile-content">
        <div className="space-y-3">
          {/* Identity */}
          <section className="mobile-card">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/5">
                <span className="font-display text-xl font-bold text-primary">
                  {user?.username?.[0]?.toUpperCase() || "?"}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg font-bold text-white" data-testid="text-username">
                  @{user?.username}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-400">
                    {user?.isAdmin ? "Administrator" : "Miner"}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                      twoFactorEnabled ? "border-primary/30 bg-primary/5 text-primary" : "border-white/10 text-zinc-500"
                    }`}
                  >
                    {twoFactorEnabled ? "2FA active" : "2FA off"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Equipment */}
          <MyMinersGrid user={user} />

          {/* Network performance */}
          <HashratePanel user={user} status={miningStatus} info={miningInfo} />

          {/* Block ledger */}
          <BlocksTable
            blocks={miningHistory || []}
            pendingCount={(pendingBlocks || []).length}
            isLoading={historyLoading}
          />

          {/* Security */}
          <SecuritySettings user={user} />

          {/* Reference material */}
          <KnowledgeGrid />

          {/* Only action at the end of the page */}
          <Button
            variant="outline"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="w-full border-white/10 py-5 font-display text-sm font-bold text-zinc-300 hover:border-primary/40 hover:text-primary"
            data-testid="button-logout"
          >
            {logoutMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing out…
              </>
            ) : (
              <>
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
