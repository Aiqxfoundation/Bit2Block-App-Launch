import type { ElementType, ReactNode } from "react";

/**
 * Shared shell for every block on the Account page: one accent colour, one
 * border weight, one header pattern — so the whole page reads as a single
 * system instead of a stack of differently-styled cards.
 */
export function SectionCard({
  icon: Icon,
  label,
  title,
  description,
  action,
  children,
  className = "",
}: {
  icon: ElementType;
  label: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mobile-card ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/5">
            <Icon className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</p>
            <h2 className="truncate font-display text-sm font-bold text-white">{title}</h2>
            {description ? <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Shared table styling so every table on the page has identical rhythm. */
export const tableStyles = {
  wrapper: "w-full overflow-x-auto",
  table: "w-full border-collapse text-xs",
  headCell: "pb-2 text-left font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-zinc-500",
  headCellRight: "pb-2 text-right font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-zinc-500",
  body: "divide-y divide-white/5",
  cell: "py-2.5 pr-3 align-middle text-zinc-300",
  cellRight: "py-2.5 pl-3 text-right align-middle font-mono text-white",
  caption: "mt-3 border-t border-white/5 pt-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500",
  empty: "py-6 text-center font-mono text-xs text-zinc-500",
};

/** Small label / value pair used inside grids and list rows. */
export function StatBlock({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      <p className="mt-1 break-words font-mono text-sm font-bold text-white">{value}</p>
      {caption ? <p className="mt-1 text-[10px] text-zinc-500">{caption}</p> : null}
    </div>
  );
}
