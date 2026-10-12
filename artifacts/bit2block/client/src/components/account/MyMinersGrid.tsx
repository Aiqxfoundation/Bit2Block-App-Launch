import { Cpu } from "lucide-react";
import { SectionCard, StatBlock } from "./SectionCard";
import { formatHashPower } from "@/lib/utils";

interface MinerUnit {
  key: string;
  label: string;
  caption: string;
  value: number;
}

/**
 * The hashrate units actually attached to this account, straight from the
 * user record — no invented equipment rows.
 */
export function MyMinersGrid({ user }: { user: any }) {
  const units: MinerUnit[] = [
    {
      key: "owned",
      label: "Owned",
      caption: "Purchased hashrate",
      value: Number(user?.baseHashPower || 0),
    },
    {
      key: "bonus",
      label: "Referral Bonus",
      caption: "Earned from your team",
      value: Number(user?.referralHashBonus || 0),
    },
    {
      key: "locked",
      label: "In Block",
      caption: "Locked for the current payout",
      value: Number(user?.lockedHashPower || 0),
    },
    {
      key: "next",
      label: "Next Block",
      caption: "Applies from the next block",
      value: Number(user?.nextBlockHashPower || 0),
    },
  ];

  const total = Number(user?.hashPower || 0);

  return (
    <SectionCard
      icon={Cpu}
      label="Equipment"
      title="My Miners"
      description="Hashrate units running on this account"
    >
      <div className="grid grid-cols-2 gap-2.5">
        {units.map((unit) => (
          <StatBlock key={unit.key} label={unit.label} value={formatHashPower(unit.value)} caption={unit.caption} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary/80">Total Hashrate</span>
        <span className="font-mono text-sm font-bold text-primary">{formatHashPower(total)}</span>
      </div>
    </SectionCard>
  );
}
