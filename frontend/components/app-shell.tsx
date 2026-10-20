"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, FlaskConical, History, MessageSquare, Settings, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  {
    title: "Workspace",
    items: [
      { href: "/chat", label: "Ask", icon: MessageSquare },
      { href: "/upload", label: "Documents", icon: FileText },
      { href: "/history", label: "History", icon: History }
    ]
  },
  {
    title: "Analysis",
    items: [
      { href: "/", label: "Overview", icon: BarChart3 },
      { href: "/trace", label: "Traces", icon: Workflow },
      { href: "/evaluations", label: "Evaluations", icon: FlaskConical }
    ]
  }
];

const allItems = [...sections.flatMap((section) => section.items), { href: "/settings", label: "Settings", icon: Settings }];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="fixed left-0 top-0 hidden h-screen w-60 flex-col border-r border-white/[0.06] bg-zinc-950 px-3 py-5 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-3">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight text-white">RAGWatch</span>
        </Link>

        <nav className="mt-8 flex-1 space-y-6">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="px-3 pb-2 text-xs font-medium text-zinc-500">{section.title}</div>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink key={item.href} {...item} active={pathname === item.href} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <NavLink href="/settings" label="Settings" icon={Settings} active={pathname === "/settings"} />
      </aside>

      <main className="lg:pl-60">
        <header className="flex h-14 items-center border-b border-white/[0.06] px-4 lg:hidden">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-sm font-semibold">RAGWatch</span>
          </Link>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-4 py-2 lg:hidden">
          {allItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs text-zinc-400",
                pathname === item.href && "bg-white/[0.06] text-white"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Settings; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-3 text-sm text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100",
        active && "bg-white/[0.06] text-white"
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
      {label}
    </Link>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
      <rect x="2" y="3" width="10" height="2" rx="1" fill="currentColor" className="text-zinc-500" />
      <rect x="2" y="9" width="16" height="2" rx="1" fill="currentColor" className="text-white" />
      <rect x="2" y="15" width="7" height="2" rx="1" fill="currentColor" className="text-zinc-500" />
    </svg>
  );
}
