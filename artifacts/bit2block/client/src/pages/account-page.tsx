import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { TwoFactorSettings } from "@/components/account/TwoFactorSettings";
import { formatHashPower } from "@/lib/utils";
import {
  ChevronRight,
  Copy,
  Cpu,
  Fingerprint,
  LogOut,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";

interface WalletBalances {
  btcBalance: string;
  usdtBalance: string;
  b2bBalance: string;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{children}</p>
  );
}

function DetailRow({
  icon,
  label,
  value,
  mono,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  mono?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-900 py-3 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className="text-zinc-500">{icon}</span>
        <span className="text-[11px] text-zinc-400">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-xs text-white ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
        {action}
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { user, logoutMutation } = useAuth();
  const { toast } = useToast();

  const { data: walletBalances } = useQuery<WalletBalances>({
    queryKey: ["/api/wallet/balances"],
    enabled: !!user,
    refetchInterval: 15000,
  });

  const b2b = parseFloat(walletBalances?.b2bBalance ?? user?.b2bBalance ?? "0");
  const usdt = parseFloat(walletBalances?.usdtBalance ?? user?.usdtBalance ?? "0");
  const hashrate = parseFloat(user?.hashPower || "0");

  const uid = user?.id?.slice(0, 8) || "00000000";
  const referralCode = user?.referralCode || user?.username?.toUpperCase().slice(0, 8) || "";

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard` });
  };

  const copyButton = (text: string, label: string, testId: string) => (
    <button
      type="button"
      onClick={() => copy(text, label)}
      className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-primary/40 hover:text-primary"
      data-testid={testId}
    >
      <Copy className="h-3 w-3" />
    </button>
  );

  return (
    <div className="mobile-page">
      <div className="mobile-header">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-bold text-primary">ACCOUNT</h1>
          <span className="flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] text-emerald-400">
            <ShieldCheck className="h-3 w-3" /> SECURED
          </span>
        </div>
      </div>

      <div className="mobile-content space-y-5">
        {/* Identity */}
        <Card className="mobile-card">
          <div className="flex items-center gap-3.5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
              <span className="font-display text-2xl font-bold text-primary">
                {user?.username?.[0]?.toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-display text-lg font-bold text-white">@{user?.username}</p>
                {user?.isAdmin && (
                  <Badge className="border border-[#f7931a]/30 bg-[#f7931a]/20 font-mono text-[10px] text-[#f7931a]">
                    ADMIN
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                UID #{uid}
                {user?.createdAt && ` · since ${new Date(user.createdAt).toLocaleDateString()}`}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    user?.miningActive
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-800 text-zinc-400"
                  }`}
                >
                  {user?.miningActive ? "Miner Active" : "Miner Idle"}
                </Badge>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    user?.twoFactorEnabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-800 text-zinc-400"
                  }`}
                >
                  2FA {user?.twoFactorEnabled ? "On" : "Off"}
                </Badge>
              </div>
            </div>
          </div>
        </Card>

        {/* Balances */}
        <div>
          <SectionLabel>Vault Balances</SectionLabel>
          <Card className="mobile-card">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                  <Wallet className="h-4 w-4" />
                </span>
                <span className="text-xs text-zinc-300">B2B Balance</span>
              </div>
              <span className="font-mono text-sm font-semibold text-white">
                {b2b.toFixed(4)} <span className="text-[10px] text-zinc-500">B2B</span>
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-900 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
                  <Wallet className="h-4 w-4" />
                </span>
                <span className="text-xs text-zinc-300">USDT Balance</span>
              </div>
              <span className="font-mono text-sm font-semibold text-white">
                ${usdt.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400">
                  <Cpu className="h-4 w-4" />
                </span>
                <span className="text-xs text-zinc-300">Mining Hashrate</span>
              </div>
              <span className="font-mono text-sm font-semibold text-white">{formatHashPower(hashrate)}</span>
            </div>
          </Card>
        </div>

        {/* Security */}
        <div>
          <SectionLabel>Security &amp; Access</SectionLabel>
          <div className="space-y-2">
            <TwoFactorSettings />

            <Link href="/referral">
              <div
                className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 transition-colors hover:border-primary/40"
                data-testid="link-referral-program"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300">
                    <Users className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Referral Program</p>
                    <p className="text-[11px] text-zinc-500">Invite code, team and commissions</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-600" />
              </div>
            </Link>

            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              className="flex w-full items-center justify-between rounded-xl border border-destructive/25 bg-destructive/5 p-3.5 text-left transition-colors hover:border-destructive/50"
              data-testid="button-logout"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive">
                  <LogOut className="h-4 w-4" />
                </span>
                <p className="text-sm font-semibold text-destructive">Sign Out</p>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-600" />
            </button>
          </div>
        </div>

        {/* Account details */}
        <div>
          <SectionLabel>Account Details</SectionLabel>
          <Card className="mobile-card py-1">
            <DetailRow
              icon={<Fingerprint className="h-3.5 w-3.5" />}
              label="Account ID"
              value={`#${uid}`}
              mono
              action={copyButton(user?.id || "", "Account ID", "button-copy-uid")}
            />
            <DetailRow icon={<Wallet className="h-3.5 w-3.5" />} label="Username" value={`@${user?.username}`} mono />
            <DetailRow
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              label="Member since"
              value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
            />
            <DetailRow
              icon={<Users className="h-3.5 w-3.5" />}
              label="Referral code"
              value={referralCode || "—"}
              mono
              action={referralCode ? copyButton(referralCode, "Referral code", "button-copy-referral-code") : undefined}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
