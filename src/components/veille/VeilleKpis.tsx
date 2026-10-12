import { Activity, Database, Radio, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import type { CollectionRun, Source, UsageSnapshot } from "@/lib/api/types";
import { AsideLabel, KpiTile, MiniBars, ProgressBar, formatNumber, ratioTone } from "./kit";
import { runsByDay, runsSince, summarizeRuns } from "./runs";

export function VeilleKpis({
  sources,
  runs,
  usage,
}: {
  sources: Source[] | undefined;
  runs: CollectionRun[] | undefined;
  usage: UsageSnapshot | undefined;
}) {
  const stats = useMemo(() => {
    const all = sources ?? [];
    const active = all.filter((s) => s.access !== "desactivee").length;
    const failing = all.filter((s) => s.access === "erreur").length;
    const days = runsByDay(runs ?? [], 8);
    const last24 = summarizeRuns(runsSince(runs ?? [], 24));
    return { total: all.length, active, failing, days, last24 };
  }, [sources, runs]);

  const sourceMeter = usage?.meters.find((m) => m.key === "sources");
  const obsMeter = usage?.meters.find((m) => m.key === "observations");
  const sourceLimit = sourceMeter?.limit ?? 300;
  const obsRatio = obsMeter ? obsMeter.ratio : 0;
  const failingPct = stats.active ? Math.round((stats.failing / stats.active) * 100) : 0;
  const rate = stats.last24.successRate;

  return (
    <div className="grid grid-cols-4 gap-4">
      <KpiTile
        icon={Radio}
        tone="teal"
        loading={!sources}
        value={formatNumber(stats.active)}
        label="sources actives"
        aside={
          <>
            <AsideLabel tone={ratioTone(stats.total / sourceLimit)}>
              {formatNumber(stats.total)} / {formatNumber(sourceLimit)}
            </AsideLabel>
            <ProgressBar
              ratio={stats.total / sourceLimit}
              tone="teal"
              className="h-1.5 w-[4.5rem]"
            />
            <span className="text-[10px] text-muted-foreground">quota configuré</span>
          </>
        }
      />
      <KpiTile
        icon={TriangleAlert}
        tone="rose"
        loading={!sources}
        value={formatNumber(stats.failing)}
        label="sources en échec"
        aside={
          <>
            <AsideLabel tone={stats.failing > 0 ? "rose" : "green"}>
              {failingPct}% du parc
            </AsideLabel>
            <MiniBars values={stats.days.map((d) => d.failed)} tone="rose" />
          </>
        }
      />
      <KpiTile
        icon={Activity}
        tone="blue"
        loading={!runs}
        value={formatNumber(stats.last24.total)}
        label="collectes · dernières 24 h"
        aside={
          <>
            <AsideLabel tone={rate === null ? "gray" : rate >= 0.9 ? "green" : "amber"}>
              {rate === null ? "—" : `${Math.round(rate * 100)}% réussies`}
            </AsideLabel>
            <MiniBars values={stats.days.map((d) => d.success + d.empty + d.failed)} tone="blue" />
          </>
        }
      />
      <KpiTile
        icon={Database}
        tone="amber"
        loading={!usage}
        value={
          <>
            {formatNumber(obsMeter?.used ?? 0)}
            <span className="ml-1 text-[13px] font-semibold text-muted-foreground">
              / {formatNumber(obsMeter?.limit ?? 6000)}
            </span>
          </>
        }
        label="observations ce mois"
        aside={
          <>
            <AsideLabel tone={ratioTone(obsRatio)}>
              {Math.round(obsRatio * 100)}% du quota
            </AsideLabel>
            <ProgressBar ratio={obsRatio} tone={ratioTone(obsRatio)} className="h-1.5 w-[4.5rem]" />
          </>
        }
      />
    </div>
  );
}
