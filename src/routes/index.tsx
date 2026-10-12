import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AllNewsView } from "@/components/dashboard/AllNewsView";
import { AnalyticsView } from "@/components/dashboard/AnalyticsView";
import { DashboardTabs, type DashboardTab } from "@/components/dashboard/DashboardTabs";
import { EditorialCalendarView } from "@/components/dashboard/EditorialCalendarView";
import { EditorialView } from "@/components/dashboard/EditorialView";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { MySpaceView } from "@/components/dashboard/MySpaceView";
import { currentMonth, fromApiRange, toApiRange, type Period } from "@/components/dashboard/period";
import { errorMessage, useDashboard } from "@/lib/api/hooks";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard éditorial — Inovallée Newsroom IA" },
      {
        name: "description",
        content: "Le poste de pilotage : signaux scorés, sujets prioritaires et diffusion.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [tab, setTab] = useState<DashboardTab>("vue");
  const [custom, setCustom] = useState<Period | null>(null);
  const dashboard = useDashboard(custom ? toApiRange(custom) : undefined);
  const period: Period =
    custom ?? (dashboard.data ? fromApiRange(dashboard.data.period) : currentMonth());
  const loading = dashboard.isPending;

  return (
    <div className="@container flex flex-col gap-4 pt-1">
      {dashboard.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-kora-rose/25 bg-kora-rose-bg px-4 py-2.5 text-[12.5px] text-kora-ink"
        >
          <span>
            <span className="font-semibold">Le tableau de bord n&apos;a pas pu être chargé.</span>{" "}
            <span className="text-kora-ink-soft">{errorMessage(dashboard.error)}</span>
          </span>
          <button
            type="button"
            onClick={() => void dashboard.refetch()}
            className="rounded-md border border-kora-rose/30 bg-white px-3 py-1 text-[12px] font-semibold text-kora-rose transition hover:bg-kora-rose-bg"
          >
            Réessayer
          </button>
        </div>
      )}

      <KpiCards kpis={dashboard.data?.kpis} loading={loading} />

      <DashboardTabs value={tab} onChange={setTab} period={period} onPeriodChange={setCustom} />

      {tab === "vue" && <EditorialView dashboard={dashboard.data} loading={loading} />}
      {tab === "actualites" && <AllNewsView />}
      {tab === "analyses" && <AnalyticsView period={period} />}
      {tab === "calendrier" && <EditorialCalendarView initialMonth={period.from} />}
      {tab === "espace" && <MySpaceView />}
    </div>
  );
}
