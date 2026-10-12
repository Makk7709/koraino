import {
  BookOpenCheck,
  ExternalLink,
  FileSearch,
  Gavel,
  Lightbulb,
  ListOrdered,
  Newspaper,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserPen,
} from "lucide-react";
import { BrandMark } from "@/components/kora/BrandMark";
import { EmptyState, Pill } from "@/components/kora/primitives";
import { useState } from "react";
import { EVIDENCE, formatDate, formatDateTime, type Tone } from "@/components/kora/labels";
import type { ArticleDetail, FactCheck, Observation } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { FactCheckDialog } from "./FactCheckDialog";
import { markerSentences } from "./format";
import { usePermissions } from "./hooks";
import { HighlightMarkers } from "./markers";
import { CheckItem, MintPanel, SectionTitle, SkyPanel } from "./ui";

const FACT_STATUS: Record<FactCheck["status"], { label: string; tone: Tone }> = {
  etaye: { label: "Étayé", tone: "green" },
  non_corrobore: { label: "Non corroboré", tone: "amber" },
  contradictoire: { label: "Contradictoire", tone: "rose" },
};

function ObservationLine({ o }: { o: Observation }) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg bg-white/80 px-2.5 py-2">
      <BrandMark name={o.outlet.name} brand={o.outlet.brand} size="xs" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
          <span className="font-semibold text-kora-ink">{o.outlet.name}</span>
          <span>{formatDate(o.publishedAt ?? o.eventDate)}</span>
          {o.isSyndicated && (
            <Pill tone="gray" size="sm" className="font-medium">
              Reprise de communiqué
            </Pill>
          )}
        </p>
        <a
          href={o.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-0.5 inline-flex items-start gap-1 text-[12.5px] leading-snug font-medium text-kora-ink transition hover:text-kora-teal"
        >
          <span className="line-clamp-2">{o.title}</span>
          <ExternalLink className="mt-0.5 size-3 shrink-0 text-kora-teal" />
        </a>
      </div>
    </li>
  );
}

function FactCheckCard({
  fc,
  observations,
  onArbitrate,
}: {
  fc: FactCheck;
  observations: Observation[];
  onArbitrate: (() => void) | undefined;
}) {
  const s = FACT_STATUS[fc.status];
  const linked = fc.observationIds
    .map((id) => observations.find((o) => o.id === id))
    .filter((o): o is Observation => !!o);
  return (
    <li
      className={cn(
        "rounded-xl border p-3",
        fc.status === "etaye" && "border-kora-green/15 bg-kora-green-bg/30",
        fc.status === "non_corrobore" && "border-kora-amber/25 bg-kora-amber-bg/40",
        fc.status === "contradictoire" && "border-kora-rose/20 bg-kora-rose-bg/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Pill tone={s.tone} size="sm" className="mt-0.5 min-w-[6.5rem] font-semibold">
          {s.label}
        </Pill>
        <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium text-kora-ink">
          {fc.claim}
        </p>
        {onArbitrate && fc.status === "contradictoire" && (
          <button
            type="button"
            onClick={onArbitrate}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-kora-rose/30 bg-white px-2.5 text-[11.5px] font-semibold text-kora-rose transition hover:bg-kora-rose-bg"
          >
            <Gavel className="size-3.5" /> Arbitrer
          </button>
        )}
      </div>
      {fc.resolution && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-kora-ink-soft">
          <Gavel className="mt-px size-3.5 shrink-0 text-kora-teal" />
          <span>
            Arbitré par <span className="font-semibold text-kora-ink">{fc.resolution.by}</span> le{" "}
            {formatDateTime(fc.resolution.at)}
            {fc.resolution.note ? ` — « ${fc.resolution.note} »` : ""}
          </span>
        </p>
      )}
      {linked.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {linked.map((o) => (
            <ObservationLine key={o.id} o={o} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11.5px] font-medium text-kora-rose">
          Aucune source du dossier reliée à cette assertion.
        </p>
      )}
    </li>
  );
}

/** Dossier factuel (Evidence Pack) : faits reliés aux sources, angles, plan. */
export function EvidencePack({ article, body }: { article: ArticleDetail; body: string }) {
  const { canWrite, canValidate } = usePermissions();
  const [arbitrating, setArbitrating] = useState<FactCheck | null>(null);
  const signal = article.signal;
  const counts = {
    etaye: article.factChecks.filter((f) => f.status === "etaye").length,
    non_corrobore: article.factChecks.filter((f) => f.status === "non_corrobore").length,
    contradictoire: article.factChecks.filter((f) => f.status === "contradictoire").length,
  };
  const toVerify = markerSentences(body);
  const angleTags = signal?.suggestedAngle.tags ?? [];
  const evidence = signal?.evidence;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-2">
        {signal ? (
          <MintPanel title="Pourquoi c'est intéressant ?" icon={Sparkles}>
            <ul className="flex flex-col gap-2">
              {signal.whyInteresting.map((w) => (
                <CheckItem key={w}>{w}</CheckItem>
              ))}
            </ul>
          </MintPanel>
        ) : (
          <MintPanel title="Human Content Guard" icon={UserPen}>
            <ul className="flex flex-col gap-2">
              <CheckItem>
                Auteur nommé conservé :{" "}
                <span className="font-semibold text-kora-ink">{article.author ?? "—"}</span>
              </CheckItem>
              <CheckItem>Original déposé conservé, distinct du texte extrait</CheckItem>
              <CheckItem>Seules les propositions acceptées ont été appliquées</CheckItem>
            </ul>
          </MintPanel>
        )}
        <SkyPanel title="Angles éditoriaux proposés" icon={Lightbulb}>
          {article.angles.length ? (
            <ul className="flex flex-col gap-1.5">
              {article.angles.map((a, i) => (
                <li
                  key={a}
                  className={cn(
                    "text-[12.5px] leading-snug",
                    i === 0 ? "font-semibold text-kora-ink" : "text-kora-ink-soft",
                  )}
                >
                  « {a} »
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Aucun angle proposé.</p>
          )}
          {angleTags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {angleTags.map((t, i) => (
                <Pill key={t} tone={i % 2 === 0 ? "purple" : "blue"} size="sm">
                  {t}
                </Pill>
              ))}
            </div>
          )}
        </SkyPanel>
      </div>

      {evidence && (
        <section>
          <SectionTitle
            icon={ShieldCheck}
            action={
              <Pill tone={EVIDENCE[evidence.level].tone} className="font-semibold">
                {EVIDENCE[evidence.level].label}
              </Pill>
            }
          >
            Solidité documentaire
          </SectionTitle>
          <div className="rounded-xl border border-border bg-white/80 p-3.5">
            <div className="grid gap-3 text-[12px] sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Source directe</p>
                <p className="mt-0.5 font-semibold text-kora-ink">
                  {evidence.directSource ? "Disponible" : "Non disponible"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Corroborations indépendantes</p>
                <p className="mt-0.5 font-semibold text-kora-ink tabular-nums">
                  {evidence.independentCorroborations}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Fraîcheur</p>
                <p className="mt-0.5 font-semibold text-kora-ink">
                  {evidence.freshnessDays === null
                    ? "Date inconnue"
                    : evidence.freshnessDays === 0
                      ? "Aujourd'hui"
                      : `${evidence.freshnessDays} j`}
                </p>
              </div>
            </div>
            {evidence.contradictions.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {evidence.contradictions.map((c) => (
                  <CheckItem key={c} tone="rose">
                    <span className="font-medium text-kora-rose">Contradiction :</span> {c}
                  </CheckItem>
                ))}
              </ul>
            )}
            {evidence.explanation.length > 0 && (
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[12px] text-kora-ink-soft marker:text-kora-teal">
                {evidence.explanation.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <p className="mt-2.5 text-[11px] text-muted-foreground">
              Indicateur explicable, pas une probabilité : plusieurs reprises d&apos;un même
              communiqué ne valent pas des confirmations indépendantes.
            </p>
          </div>
        </section>
      )}

      <section>
        <SectionTitle
          icon={BookOpenCheck}
          action={
            <span className="flex flex-wrap gap-1.5">
              <Pill tone="green" size="sm">
                {counts.etaye} étayé{counts.etaye > 1 ? "s" : ""}
              </Pill>
              <Pill tone="amber" size="sm">
                {counts.non_corrobore} non corroboré{counts.non_corrobore > 1 ? "s" : ""}
              </Pill>
              <Pill tone="rose" size="sm">
                {counts.contradictoire} contradictoire{counts.contradictoire > 1 ? "s" : ""}
              </Pill>
            </span>
          }
        >
          Faits vérifiables et sources
        </SectionTitle>
        {article.factChecks.length ? (
          <ul className="flex flex-col gap-2">
            {article.factChecks.map((fc) => (
              <FactCheckCard
                key={fc.id}
                fc={fc}
                observations={article.observations}
                onArbitrate={canWrite || canValidate ? () => setArbitrating(fc) : undefined}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title="Aucune assertion relevée">
            Le dossier factuel ne contient pas encore de faits reliés aux sources.
          </EmptyState>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Une source n&apos;établit pas automatiquement la vérité d&apos;un fait : la relecture
          vérifie aussi fidélité, date, contexte et attribution. Aucune citation n&apos;est
          conservée sans passage source identifiable.
        </p>
      </section>

      {toVerify.length > 0 && (
        <section>
          <SectionTitle icon={TriangleAlert}>
            Passages marqués « À vérifier » dans le brouillon
          </SectionTitle>
          <ul className="flex flex-col gap-1.5 rounded-xl border border-kora-amber/25 bg-kora-amber-bg/40 p-3">
            {toVerify.map((s, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-kora-ink-soft">
                <HighlightMarkers text={s} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-5 min-[1400px]:grid-cols-2">
        <section>
          <SectionTitle icon={ListOrdered}>Plan proposé</SectionTitle>
          {article.plan.length ? (
            <ol className="flex flex-col gap-1.5">
              {article.plan.map((p, i) => (
                <li
                  key={`${i}-${p}`}
                  className="flex items-start gap-2.5 rounded-lg border border-border bg-white/80 px-3 py-2 text-[12.5px] text-kora-ink"
                >
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-kora-teal-bg text-[11px] font-bold text-kora-teal tabular-nums">
                    {i + 1}
                  </span>
                  {p}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Aucun plan proposé.</p>
          )}
        </section>
        <section>
          <SectionTitle icon={Newspaper}>
            Sources du dossier ({article.observations.length})
          </SectionTitle>
          {article.observations.length ? (
            <ul className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-2">
              {article.observations.map((o) => (
                <ObservationLine key={o.id} o={o} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <FileSearch className="size-3.5" /> Aucune observation rattachée.
            </p>
          )}
        </section>
      </div>
      <FactCheckDialog
        article={article}
        factCheck={arbitrating}
        onClose={() => setArbitrating(null)}
      />
    </div>
  );
}
