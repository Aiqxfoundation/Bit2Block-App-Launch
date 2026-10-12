import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { SectionCard, tableStyles } from "./SectionCard";
import { formatHashPower } from "@/lib/utils";

function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

/**
 * Position and performance of the account across the network. Read-only view
 * over /api/mining/status and /api/mining/info.
 */
export function HashratePanel({ user, status, info }: { user: any; status: any; info: any }) {
  const [secondsLeft, setSecondsLeft] = useState<number>(Number(status?.timeUntilNextBlock || 0));

  useEffect(() => {
    setSecondsLeft(Number(status?.timeUntilNextBlock || 0));
  }, [status?.timeUntilNextBlock]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const networkHashrate = Number(info?.totalHashPower || 0);
  const blockReward = Number(info?.blockReward || 0);
  const miningHashrate = Number(status?.lockedHashPower ?? user?.lockedHashPower ?? 0);
  const share = networkHashrate > 0 && miningHashrate > 0 ? (miningHashrate / networkHashrate) * 100 : 0;
  const estimatedReward = networkHashrate > 0 && miningHashrate > 0 ? (miningHashrate / networkHashrate) * blockReward : 0;

  const rows: Array<{ label: string; value: string; note?: string }> = [
    { label: "Network Hashrate", value: formatHashPower(networkHashrate), note: "All eligible miners" },
    { label: "Network Share", value: `${share.toFixed(6)}%`, note: "Your slice of the current block" },
    { label: "Est. Reward / Block", value: `${estimatedReward.toFixed(8)} B2B`, note: "At the current hashrate" },
    { label: "Next Block In", value: formatCountdown(secondsLeft), note: "Blocks are cut hourly" },
    {
      label: "Last Settled Block",
      value: status?.lastClaimedBlock ? `#${status.lastClaimedBlock}` : "—",
      note: "Most recent payout",
    },
    {
      label: "Blocks Until Pause",
      value: `${Number(status?.blocksUntilSuspension ?? 0)}`,
      note: "24 unsettled blocks pause mining",
    },
  ];

  return (
    <SectionCard
      icon={Activity}
      label="Performance"
      title="Hashrate"
      description="How your hashrate sits against the network"
    >
      <div className={tableStyles.wrapper}>
        <table className={tableStyles.table}>
          <tbody className={tableStyles.body}>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className={tableStyles.cell}>
                  <span className="block text-zinc-200">{row.label}</span>
                  {row.note ? <span className="mt-0.5 block text-[10px] text-zinc-500">{row.note}</span> : null}
                </td>
                <td className={tableStyles.cellRight}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
