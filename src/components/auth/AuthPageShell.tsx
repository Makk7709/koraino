import type { ReactNode } from "react";
import { InovalleeLogo, SidebarMountains } from "@/components/layout/Artwork";

/** Mise en page des écrans de connexion, sans barre latérale ni en-tête applicatif. */
export function AuthPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="kora-page-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="kora-card grid w-full max-w-[880px] overflow-hidden bg-white md:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
        <aside className="kora-sidebar-bg relative hidden min-h-[480px] flex-col overflow-hidden px-7 pt-7 text-white md:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute top-[30%] -right-24 h-[46%] w-[260px] rotate-[-14deg] rounded-full bg-[radial-gradient(closest-side,oklch(0.818_0.174_160.5/30%),transparent)] blur-2xl"
          />
          <InovalleeLogo className="relative z-10 h-[56px] w-auto self-start" />
          <div className="relative z-10 mt-10">
            <p className="text-[22px] leading-tight font-bold tracking-tight">
              Inovallée Newsroom IA
            </p>
            <p className="mt-1.5 text-[13px] text-white/80">
              De la veille au rayonnement éditorial
            </p>
            <span className="mt-4 block h-[3px] w-7 rounded-full bg-kora-lime" />
          </div>
          <SidebarMountains className="pointer-events-none absolute inset-x-0 bottom-0 h-[250px]" />
        </aside>

        <main className="flex flex-col justify-center px-6 py-9 sm:px-10">
          <p className="mb-6 text-[13px] font-bold tracking-tight text-kora-teal-dark md:hidden">
            Inovallée Newsroom IA
          </p>
          <h1 className="text-xl font-bold tracking-tight text-kora-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-kora-ink-soft">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
