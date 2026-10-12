import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, BookOpen, FileText, GraduationCap, Pickaxe, ShieldCheck } from "lucide-react";
import { tableStyles } from "@/components/account/SectionCard";

export type DocSection = "docs" | "mining-guide" | "knowledge" | "privacy";

const NAV: Array<{ key: DocSection; href: string; label: string; icon: any }> = [
  { key: "docs", href: "/docs", label: "Documentation", icon: BookOpen },
  { key: "mining-guide", href: "/mining-guide", label: "Mining Guideline", icon: Pickaxe },
  { key: "knowledge", href: "/knowledge", label: "Knowledge Base", icon: GraduationCap },
  { key: "privacy", href: "/privacy", label: "Privacy Policy", icon: ShieldCheck },
];

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className={tableStyles.wrapper}>
      <table className={tableStyles.table}>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={cell} className={index === head.length - 1 && head.length > 2 ? tableStyles.headCellRight : tableStyles.headCell}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tableStyles.body}>
          {rows.map((row) => (
            <tr key={String(row[0])}>
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={
                    index === 0
                      ? `${tableStyles.cell} font-medium text-zinc-200`
                      : index === row.length - 1 && row.length > 2
                        ? tableStyles.cellRight
                        : tableStyles.cell
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <section className="mobile-card">
      <h2 className="font-display text-sm font-bold text-white">{title}</h2>
      {description ? <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{description}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function DocsContent() {
  return (
    <>
      <Block
        title="How the ledger works"
        description="Bit2Block mines in fixed blocks rather than a continuous stream. Every block carries a reward, and each miner's share of that reward follows the hashrate they held during the block."
      >
        <ol className="space-y-2.5">
          {[
            "Hold hashrate. Hashrate is purchased with USDT or earned as a referral bonus, and it is attached to your account until you change it.",
            "A block opens. One block is cut per hour. Your locked hashrate at that moment is your claim on the block.",
            "The reward splits by share. Your slice equals your hashrate divided by the network's eligible hashrate.",
            "Payouts settle automatically. Block rewards are credited to the B2B balance of your wallet without a manual claim step.",
            "Unsettled blocks pause mining. If 24 blocks go unsettled, mining stops until you settle them.",
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/5 font-mono text-[11px] text-primary">
                {index + 1}
              </span>
              <span className="text-[11px] leading-relaxed text-zinc-400">{step}</span>
            </li>
          ))}
        </ol>
      </Block>

      <Block title="Mining parameters" description="The values below are fixed by the network and can be read live from the mining endpoints.">
        <Table
          head={["Parameter", "Value"]}
          rows={[
            ["Block interval", "60 minutes"],
            ["Blocks per day", "24"],
            ["Halving interval", "Every 2,160 blocks"],
            ["Maximum supply", "21,000,000 B2B"],
            ["Pause threshold", "24 unsettled blocks"],
            ["Hashrate unit", "1 USDT = 100 KH/s of mining capacity"],
          ]}
        />
      </Block>

      <Block
        title="Your account"
        description="One account per person. Sign-in uses your username plus the B2B access key issued once at registration — keep it offline and never share it."
      />
    </>
  );
}

function MiningGuideContent() {
  return (
    <>
      <Block title="Operating checklist" description="The routine that keeps mining live and payouts flowing.">
        <Table
          head={["Step", "What to do", "Where"]}
          rows={[
            ["1", "Fund the account with USDT", "Wallet → Deposit"],
            ["2", "Convert balance into hashrate", "Hashrate → Buy power"],
            ["3", "Confirm your hashrate is attached", "Account → My Miners"],
            ["4", "Watch unsettled blocks", "Account → Blocks"],
            ["5", "Set a security PIN", "Account → Security"],
            ["6", "Turn on two-factor authentication", "Account → Security"],
            ["7", "Withdraw earnings", "Wallet → Withdraw"],
          ]}
        />
      </Block>

      <Block title="Payout rules" description="What the platform asks for before moving funds.">
        <Table
          head={["Action", "Requirement"]}
          rows={[
            ["Withdraw USDT / B2B", "Security PIN, plus a 2FA code when 2FA is enabled"],
            ["Transfer to another miner", "Security PIN when a PIN is set"],
            ["Disable 2FA", "A valid 2FA code or your security PIN"],
            ["Daily withdrawal limit", "Set per account by the operator"],
          ]}
        />
      </Block>

      <Block title="Best practice">
        <ul className="space-y-2">
          {[
            "Keep the access key offline — it is the only credential that can sign in for you.",
            "Settle blocks regularly so the daily cap and pause threshold never bite.",
            "Never type your PIN or 2FA code into a link sent by anyone.",
            "Review the audit of your accounts from the Transactions page after every payout.",
          ].map((tip) => (
            <li key={tip} className="flex gap-2 text-[11px] leading-relaxed text-zinc-400">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {tip}
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

function KnowledgeContent() {
  return (
    <>
      <Block title="Core terms">
        <Table
          head={["Term", "Meaning"]}
          rows={[
            ["Hashrate", "The mining capacity attached to your account; it decides your share of every block."],
            ["Block", "A one-hour mining round with its own reward and participant list."],
            ["Share", "Your hashrate divided by the network's total eligible hashrate."],
            ["Block reward", "The B2B amount distributed to participants of a block."],
            ["Unsettled block", "A block you participated in whose reward is still pending."],
            ["Halving", "The scheduled cut to the block reward, every 2,160 blocks."],
            ["Access key", "The B2B-XXXXX-XXXXX-XXXXX-XXXXX credential issued once at registration."],
            ["Security PIN", "Six digits required on withdrawals."],
            ["2FA", "A rotating code from an authenticator app, required at sign-in and withdrawal."],
          ]}
        />
      </Block>

      <Block title="Frequently asked">
        <Table
          head={["Question", "Answer"]}
          rows={[
            ["Why did my mining stop?", "Mining pauses after 24 unsettled blocks, or when an administrator suspends the account."],
            ["Do I have to claim rewards?", "No. Block rewards are credited to your B2B balance automatically."],
            ["How do I change my hashrate?", "Buy more power with USDT; the new hashrate applies from the next block."],
            ["Where are my payouts?", "The Wallet page shows balances; Transactions lists every movement."],
            ["I lost my access key.", "Access keys cannot be re-issued. Contact an administrator with your username."],
            ["How do I turn 2FA off?", "Account → Security → Manage, then confirm with a code or your PIN."],
          ]}
        />
      </Block>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <Block
        title="Privacy Policy"
        description="Last updated October 2026. This policy describes the data Bit2Block stores about your account and why."
      >
        <p className="text-[11px] leading-relaxed text-zinc-400">
          We keep the data needed to run a mining ledger and to protect it. We do not sell personal data, and no
          third-party advertising or tracking scripts run inside the app.
        </p>
      </Block>

      <Block title="Data we store">
        <Table
          head={["Data", "Why we keep it"]}
          rows={[
            ["Username and access key", "To authenticate you. The key is shown once at registration."],
            ["Registration IP address", "To limit duplicate accounts and investigate abuse."],
            ["Device identifiers", "To recognise trusted devices and flag sign-in from new ones."],
            ["Session records", "To keep you signed in and to expire idle sessions."],
            ["Mining and wallet ledger", "Blocks, hashrate, balances, transfers and withdrawals."],
            ["Administrative audit logs", "To record privileged actions on accounts and balances."],
            ["Security settings", "PIN presence and 2FA secret used to verify your codes."],
          ]}
        />
      </Block>

      <Block title="How we use it">
        <ul className="space-y-2">
          {[
            "Operate the mining ledger and calculate block payouts.",
            "Authenticate sessions and enforce security controls such as 2FA and the withdrawal PIN.",
            "Detect fraud, duplicate accounts and abuse of referral rewards.",
            "Produce encrypted backups so account balances survive infrastructure failure.",
          ].map((item) => (
            <li key={item} className="flex gap-2 text-[11px] leading-relaxed text-zinc-400">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Retention and sharing">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Ledger records are retained for the life of the platform so balances stay auditable. Session and device
          records are kept only while they are useful for security. Data is processed only by the infrastructure
          that hosts the application and its database; we do not sell or rent it to anyone.
        </p>
      </Block>

      <Block title="Your controls">
        <Table
          head={["Control", "Where"]}
          rows={[
            ["Change your security PIN", "Account → Security"],
            ["Enable or disable 2FA", "Account → Security"],
            ["End the current session", "Account → Log out"],
            ["Request account data or deletion", "Contact an administrator"],
          ]}
        />
      </Block>
    </>
  );
}

const TITLES: Record<DocSection, string> = {
  docs: "DOCUMENTATION",
  "mining-guide": "MINING GUIDELINE",
  knowledge: "KNOWLEDGE BASE",
  privacy: "PRIVACY POLICY",
};

export default function DocsPage() {
  const [location] = useLocation();
  const section: DocSection = location.startsWith("/mining-guide")
    ? "mining-guide"
    : location.startsWith("/knowledge")
      ? "knowledge"
      : location.startsWith("/privacy")
        ? "privacy"
        : "docs";

  return (
    <div className="mobile-page">
      <div className="mobile-header">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h1 className="text-lg font-display font-bold text-primary">{TITLES[section]}</h1>
        </div>
      </div>

      <div className="mobile-content">
        <Link href="/account">
          <span className="mb-3 inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-zinc-500 hover:text-primary">
            <ArrowLeft className="h-3 w-3" />
            Back to account
          </span>
        </Link>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {NAV.map((item) => (
            <Link key={item.key} href={item.href}>
              <span
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                  item.key === section
                    ? "border-primary/30 bg-primary/5 text-primary"
                    : "border-white/10 text-zinc-500 hover:border-primary/30 hover:text-primary/80"
                }`}
              >
                <item.icon className="h-3 w-3" />
                {item.label}
              </span>
            </Link>
          ))}
        </div>

        <div className="space-y-3">
          {section === "docs" && <DocsContent />}
          {section === "mining-guide" && <MiningGuideContent />}
          {section === "knowledge" && <KnowledgeContent />}
          {section === "privacy" && <PrivacyContent />}
        </div>
      </div>
    </div>
  );
}
