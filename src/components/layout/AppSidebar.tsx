import { Link } from "@tanstack/react-router";
import { Building2, ChevronRight, FileText, Lightbulb, Mail, Radio, Settings } from "lucide-react";
import { useSignals } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { CardHills, HomeSolidIcon, InovalleeLogo, LinkedInIcon, SidebarMountains } from "./Artwork";

const NAV = [
  { to: "/", label: "Dashboard", icon: HomeSolidIcon, exact: true },
  { to: "/veille", label: "Veille", icon: Radio },
  { to: "/signaux", label: "Signaux", icon: Lightbulb, badge: true },
  { to: "/articles", label: "Articles", icon: FileText },
  { to: "/linkedin", label: "LinkedIn", icon: LinkedInIcon },
  { to: "/newsletter", label: "Newsletter", icon: Mail },
  { to: "/entreprises", label: "Entreprises", icon: Building2 },
  { to: "/parametres", label: "Paramètres", icon: Settings },
] as const;

export const APP_VERSION = "v1.2.0";

/** Élément actif : verre turquoise lumineux (maquette « Dashboard »). */
const ACTIVE =
  "kora-nav-active !text-white bg-[linear-gradient(90deg,oklch(0.68_0.105_200/92%),oklch(0.56_0.095_208/78%))] !border-[oklch(0.88_0.09_195/65%)] shadow-[0_0_0_1px_oklch(0.85_0.1_195/14%),0_0_22px_oklch(0.8_0.12_195/42%),inset_0_1px_0_oklch(1_0_0/24%)]";

export function AppSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const fresh = useSignals({ status: "nouveau", limit: 1 });
  const newCount = fresh.data?.total ?? 0;

  return (
    <aside
      className={cn(
        "kora-sidebar-bg sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden text-sidebar-foreground transition-[width] duration-300",
        collapsed ? "w-[76px]" : "w-[232px]",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-[30%] -right-24 h-[46%] w-[260px] rotate-[-14deg] rounded-full bg-[radial-gradient(closest-side,oklch(0.818_0.174_160.5/30%),transparent)] blur-2xl"
      />
      <div className={cn("relative z-10 pt-5 pb-5", collapsed ? "px-3" : "px-4")}>
        <Link to="/" aria-label="Accueil Inovallée Newsroom IA" className="block">
          {collapsed ? (
            <span className="mx-auto flex size-11 items-center justify-center rounded-full border-[3px] border-kora-aurora/80 text-lg font-semibold text-[#e9fbf2]">
              i
            </span>
          ) : (
            <InovalleeLogo className="h-[60px] w-auto" />
          )}
        </Link>
      </div>

      <nav className={cn("relative z-10 flex flex-col gap-[7px]", collapsed ? "px-2.5" : "px-3.5")}>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: "exact" in item && item.exact }}
              activeProps={{ className: ACTIVE }}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group relative flex h-[44px] items-center gap-3.5 rounded-xl border border-transparent text-[14px] font-medium text-white/90 transition-colors hover:bg-white/[0.07] hover:text-white",
                collapsed ? "justify-center px-0" : "px-3.5",
              )}
            >
              <Icon className="size-[20px] shrink-0" strokeWidth={1.8} />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && "badge" in item && newCount > 0 && (
                <span className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-kora-aurora shadow-[0_0_8px_var(--kora-aurora)]" />
                  <span className="min-w-[30px] rounded-full border border-kora-aurora/35 bg-[oklch(0.42_0.09_165/55%)] px-2 py-0.5 text-center text-[11.5px] font-semibold text-[#c9fbe0] tabular-nums">
                    {newCount}
                  </span>
                </span>
              )}
              {collapsed && "badge" in item && newCount > 0 && (
                <span className="absolute top-2 right-3 size-2 rounded-full bg-kora-aurora shadow-[0_0_8px_var(--kora-aurora)]" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="relative mt-auto">
        <SidebarMountains className="pointer-events-none absolute inset-x-0 bottom-0 h-[360px]" />
        {!collapsed && (
          <div className="relative z-10 mx-3.5 mb-3 overflow-hidden rounded-2xl border border-white/20 bg-[oklch(0.28_0.055_222/62%)] px-4 pt-4 pb-4 shadow-[inset_0_1px_0_oklch(1_0_0/10%)] backdrop-blur-[3px]">
            <p className="text-[15px] leading-snug font-medium text-white">
              L&apos;IA au service
              <br />
              des écosystèmes
              <br />
              d&apos;innovation
            </p>
            <span className="mt-3 block h-[3px] w-7 rounded-full bg-kora-lime" />
            <p className="mt-2.5 text-[12.5px] leading-[1.25] font-semibold tracking-wide text-[#72e3a6]">
              TECH
              <br />
              HUMAN
              <br />
              ENGAGED
            </p>
            <CardHills className="pointer-events-none absolute right-0 bottom-0 h-[70px] w-44" />
          </div>
        )}
        <div
          className={cn(
            "relative z-10 flex items-center pb-4 text-[11px] text-white/70",
            collapsed ? "justify-center" : "justify-between px-5",
          )}
        >
          {!collapsed && <span>{APP_VERSION}</span>}
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
            className="rounded-md p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
