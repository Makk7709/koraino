import { useCallback, useState } from "react";
import { SignalDetailCard } from "@/components/signals/SignalDetailCard";
import type { Dashboard } from "@/lib/api/types";
import { ActivityCard } from "./ActivityCard";
import { EngineCard } from "./EngineCard";
import { GroupCard } from "./GroupCard";
import { GROUP_ORDER } from "./dashboard-style";
import { LatestSignalsCard } from "./LatestSignalsCard";
import { LinkedInPostCard } from "./LinkedInPostCard";
import { NewsletterCard } from "./NewsletterCard";
import { WordpressDraftCard } from "./WordpressDraftCard";

/** Onglet « Vue éditoriale » : regroupements, activité, actualités + détail, cartes basses. */
export function EditorialView({
  dashboard,
  loading,
}: {
  dashboard: Dashboard | undefined;
  loading: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 @min-[720px]:grid-cols-3 @min-[1080px]:grid-cols-[1fr_1fr_1fr_1.85fr]">
        {GROUP_ORDER.map((kind) => (
          <GroupCard
            key={kind}
            kind={kind}
            group={dashboard?.groups.find((g) => g.key === kind)}
            loading={loading}
          />
        ))}
        <ActivityCard className="min-h-[200px] @min-[720px]:col-span-3 @min-[1080px]:col-span-1" />
      </div>

      <div className="grid gap-4 @min-[1000px]:grid-cols-[1.5fr_1fr]">
        <LatestSignalsCard selectedId={selectedId} onSelect={onSelect} />
        <SignalDetailCard signalId={selectedId} />
      </div>

      <div className="grid gap-4 @min-[640px]:grid-cols-2 @min-[1000px]:grid-cols-4">
        <WordpressDraftCard draft={dashboard?.latestWordpressDraft} loading={loading} />
        <LinkedInPostCard post={dashboard?.latestLinkedInPost} loading={loading} />
        <NewsletterCard
          newsletter={dashboard?.newsletter}
          loading={loading}
          selectedSignalId={selectedId}
        />
        <EngineCard engine={dashboard?.engine} loading={loading} />
      </div>
    </div>
  );
}
