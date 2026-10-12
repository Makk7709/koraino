import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Radar" },
  { to: "/entreprises", label: "Entreprises" },
  { to: "/studio", label: "Studio" },
  { to: "/publications", label: "Publications" },
] as const;

export function Shell({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-display text-3xl leading-none">KORA</span>
            <span className="label text-primary">Newsroom · Inovallée</span>
          </Link>
          <nav className="flex gap-1">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === "/" }}
                className="label rounded-sm px-3 py-2 text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-foreground data-[status=active]:text-background">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="label text-primary">{kicker}</p>
        <h1 className="font-display mt-1 text-5xl">{title}</h1>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "muted" | "primary" }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
