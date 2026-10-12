import { Link } from "wouter";
import { BookOpen, FileText, GraduationCap, Pickaxe, ShieldCheck } from "lucide-react";
import { SectionCard } from "./SectionCard";

const RESOURCES = [
  {
    href: "/docs",
    icon: BookOpen,
    title: "Documentation",
    caption: "Platform mechanics and parameters",
  },
  {
    href: "/mining-guide",
    icon: Pickaxe,
    title: "Mining Guideline",
    caption: "Step-by-step operating guide",
  },
  {
    href: "/whitepaper",
    icon: FileText,
    title: "Whitepaper",
    caption: "Token model and supply schedule",
  },
  {
    href: "/knowledge",
    icon: GraduationCap,
    title: "Knowledge Base",
    caption: "Terms and common questions",
  },
  {
    href: "/privacy",
    icon: ShieldCheck,
    title: "Privacy Policy",
    caption: "What we store and why",
  },
];

export function KnowledgeGrid() {
  return (
    <SectionCard
      icon={BookOpen}
      label="Resources"
      title="Docs & Knowledge"
      description="Reference material for mining on Bit2Block"
    >
      <div className="grid grid-cols-2 gap-2.5">
        {RESOURCES.map((resource) => (
          <Link key={resource.href} href={resource.href}>
            <div
              className="h-full cursor-pointer rounded-lg border border-white/10 bg-black/40 p-3 transition-colors hover:border-primary/40"
              data-testid={`link-resource-${resource.title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <resource.icon className="h-4 w-4 text-primary" />
              <p className="mt-2 font-display text-xs font-bold text-white">{resource.title}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{resource.caption}</p>
            </div>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}
