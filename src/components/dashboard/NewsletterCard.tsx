import { ArrowRight, Mail } from "lucide-react";
import { LandscapeThumb } from "@/components/layout/Artwork";
import { formatDate } from "@/components/kora/labels";
import { useSignalActions } from "@/components/signals/hooks";
import { HrefLink } from "@/components/signals/links";
import { plural } from "@/components/signals/signal-utils";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSignal } from "@/lib/api/hooks";
import type { Dashboard } from "@/lib/api/types";
import { BottomCardShell, BottomCardSkeletonBody } from "./BottomCardShell";

/** Carte « Newsletter hebdomadaire » : le switch agit sur le signal sélectionné (sinon celui proposé par l'API). */
export function NewsletterCard({
  newsletter,
  loading,
  selectedSignalId,
}: {
  newsletter: Dashboard["newsletter"] | undefined;
  loading: boolean;
  selectedSignalId: string | null;
}) {
  const targetId = selectedSignalId ?? newsletter?.signalId ?? null;
  const signal = useSignal(targetId);
  const actions = useSignalActions();
  const included =
    signal.data?.inNewsletter ??
    (targetId && targetId === newsletter?.signalId ? newsletter.includeNext : false);
  const disabled = !signal.data || actions.toggleNewsletter.isPending;

  return (
    <BottomCardShell
      icon={<Mail className="size-[22px] shrink-0 fill-kora-teal text-white" strokeWidth={1.6} />}
      title="Newsletter hebdomadaire"
      right={
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex shrink-0 cursor-pointer items-center gap-2">
              <span className="hidden text-[10.5px] text-muted-foreground @min-[300px]:inline">
                Inclure dans la prochaine édition
              </span>
              <Switch
                checked={included}
                disabled={disabled}
                aria-label="Inclure le sujet sélectionné dans la prochaine édition"
                onCheckedChange={(v) =>
                  signal.data &&
                  actions.toggleNewsletter.mutate({ signalId: signal.data.id, include: v })
                }
                className="h-[22px] w-10 data-[state=checked]:bg-kora-teal data-[state=unchecked]:bg-[oklch(0.88_0.02_240)] [&>span]:size-[18px] [&>span]:data-[state=checked]:translate-x-[18px]"
              />
            </label>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] bg-kora-ink text-[12px] text-white">
            {signal.data
              ? `Sujet sélectionné : « ${signal.data.title} »`
              : "Sélectionnez une actualité dans la table."}
          </TooltipContent>
        </Tooltip>
      }
      className="@container"
    >
      {newsletter ? (
        <HrefLink href="/newsletter" className="group flex gap-3">
          <LandscapeThumb className="h-[46px] w-[66px] shrink-0 overflow-hidden rounded-md" />
          <span className="min-w-0">
            <span className="line-clamp-2 text-[12.5px] leading-snug font-bold text-kora-ink group-hover:text-kora-teal-dark">
              {newsletter.title}
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {plural(newsletter.selectedCount, "sujet sélectionné", "sujets sélectionnés")} · Envoi
              prévu le {formatDate(newsletter.scheduledFor)}
            </span>
          </span>
        </HrefLink>
      ) : loading ? (
        <BottomCardSkeletonBody />
      ) : (
        <p className="text-[12px] text-muted-foreground">Aucune édition en composition.</p>
      )}
      <HrefLink
        href="/newsletter"
        className="mt-2.5 inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[11.5px] font-medium text-kora-ink transition hover:border-kora-teal-light hover:bg-kora-teal-bg"
      >
        Composer l&apos;édition
        <ArrowRight className="size-3" />
      </HrefLink>
    </BottomCardShell>
  );
}
