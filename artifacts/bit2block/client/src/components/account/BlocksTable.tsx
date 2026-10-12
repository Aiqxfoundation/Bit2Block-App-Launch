import { Boxes } from "lucide-react";
import { SectionCard, tableStyles } from "./SectionCard";
import { formatHashPower } from "@/lib/utils";

/**
 * The user's own settled blocks from /api/mining/history, with the number of
 * blocks still waiting to settle underneath.
 */
export function BlocksTable({ blocks, pendingCount = 0, isLoading }: { blocks: any[]; pendingCount?: number; isLoading?: boolean }) {
  const rows = (blocks || []).slice(0, 8);

  return (
    <SectionCard
      icon={Boxes}
      label="Ledger"
      title="Blocks"
      description="Recent blocks your hashrate was part of"
    >
      {isLoading ? (
        <p className={tableStyles.empty}>Loading blocks…</p>
      ) : rows.length === 0 ? (
        <p className={tableStyles.empty}>No settled blocks yet</p>
      ) : (
        <div className={tableStyles.wrapper}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th className={tableStyles.headCell}>Block</th>
                <th className={tableStyles.headCell}>Hashrate</th>
                <th className={tableStyles.headCellRight}>Reward</th>
                <th className={tableStyles.headCellRight}>Date</th>
              </tr>
            </thead>
            <tbody className={tableStyles.body}>
              {rows.map((block) => (
                <tr key={block.id || block.blockNumber}>
                  <td className={`${tableStyles.cell} font-mono text-white`}>#{block.blockNumber}</td>
                  <td className={`${tableStyles.cell} whitespace-nowrap`}>
                    {formatHashPower(Number(block.lockedHashrate || 0))}
                  </td>
                  <td className={`${tableStyles.cellRight} whitespace-nowrap`}>
                    +{Number(block.reward || 0).toFixed(4)}
                  </td>
                  <td className={`${tableStyles.cellRight} whitespace-nowrap text-zinc-400`}>
                    {block.claimedAt
                      ? new Date(block.claimedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={tableStyles.caption}>
        {pendingCount > 0 ? `${pendingCount} block${pendingCount === 1 ? "" : "s"} pending settlement` : "All blocks settled"}
      </p>
    </SectionCard>
  );
}
