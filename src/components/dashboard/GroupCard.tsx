import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight } from "lucide-react";
import { CountBadge, IconTile, SolidBadge } from "@/components/kora/primitives";
import { isCategory, isTheme } from "@/components/signals/signal-utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardGroup, SignalStatus } from "@/lib/api/types";
import { GROUP_STYLE, groupIcon, pick } from "./dashboard-style";

/** Statut des signaux couverts par chaque regroupement (liens « Voir tout » vers /signaux). */
const GROUP_STATUS: Record<DashboardGroup["key"], SignalStatus | "prioritaires"> = {
  prioritaires: "prioritaires",
  a_surveiller: "surveille",
  traites: "traite",
};

function linkSearch(kind: DashboardGroup["key"], itemKey?: string) {
  const status = GROUP_STATUS[kind];
  if (itemKey && isTheme(itemKey)) return { status, theme: itemKey };
  if (itemKey && isCategory(itemKey)) return { status, category: itemKey };
  return { status };
}

/** Carte de regroupement (« Sujets prioritaires 8 », « Signaux à surveiller 12 »…). */
export function GroupCard({
  kind,
  group,
  loading,
}: {
  kind: DashboardGroup["key"];
  group: DashboardGroup | undefined;
  loading: boolean;
}) {
  const style = GROUP_STYLE[kind];
  return (
    <section className="kora-card flex min-w-0 flex-col px-3.5 pt-3 pb-3">
      <header className="flex items-center justify-between gap-2 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[13.5px] font-bold tracking-tight text-kora-ink">
            {group?.label ?? style.title}
          </h2>
          {group ? (
            <SolidBadge value={group.total} tone={style.badge} className="h-[19px] min-w-[26px]" />
          ) : (
            <Skeleton className="h-[19px] w-[26px] rounded-full" />
          )}
        </div>
        <Link
          to="/signaux"
          search={linkSearch(kind)}
          className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-medium text-kora-ink-soft transition-colors hover:text-kora-teal"
        >
          Voir tout <ArrowRight className="size-3" />
        </Link>
      </header>

      <ul className="flex flex-1 flex-col gap-1.5">
        {!group &&
          Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex h-[31px] items-center gap-2.5 rounded-lg bg-muted/70 px-1.5"
            >
              <Skeleton
                className={
                  loading ? "size-[22px] rounded-md" : "size-[22px] animate-none rounded-md"
                }
              />
              <Skeleton className={loading ? "h-3 flex-1" : "h-3 flex-1 animate-none"} />
            </li>
          ))}
        {group?.items.map((item, i) => (
          <li key={item.key}>
            <Link
              to="/signaux"
              search={linkSearch(kind, item.key)}
              className="group flex h-[31px] items-center gap-1.5 rounded-lg bg-[oklch(0.975_0.006_240)] pr-1 pl-1.5 transition-colors hover:bg-kora-teal-bg"
            >
              <IconTile
                icon={groupIcon(item.icon)}
                tone={item.tone ?? pick(style.tiles, i, "blue")}
                size="sm"
                className="size-[22px] rounded-md [&>svg]:size-3.5"
              />
              <span
                title={item.label}
                className="min-w-0 flex-1 truncate text-[11.5px] font-medium tracking-[-0.005em] text-kora-ink-soft group-hover:text-kora-ink"
              >
                {item.label}
              </span>
              <CountBadge
                value={item.count}
                tone={pick(style.counts, i, "blue")}
                className="h-[19px] min-w-[19px] rounded-full px-1 text-[10.5px]"
              />
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-kora-ink" />
            </Link>
          </li>
        ))}
        {group && group.items.length === 0 && (
          <li className="rounded-lg bg-muted/70 px-3 py-3 text-center text-[12px] text-muted-foreground">
            Aucun sujet sur la période.
          </li>
        )}
      </ul>
    </section>
  );
}
