import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  Download,
  FileCode2,
  FileText,
  History,
  ListOrdered,
  Mail,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { NEWSLETTER_STATUS, formatDate, formatRelative } from "@/components/kora/labels";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, downloadUrl } from "@/lib/api/client";
import { qk, useKoraMutation, usePublications } from "@/lib/api/hooks";
import type { Company, NewsletterEdition, NewsletterItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/components/articles/hooks";
import { plural } from "@/components/articles/format";
import { ApprovalItem, AttemptHistory } from "@/components/articles/publication";
import {
  Banner,
  Field,
  GhostLink,
  inputClass,
  Meta,
  MetaRow,
  SectionTitle,
} from "@/components/articles/ui";
import { AddTopicsPanel, type TopicRef } from "./AddTopicsPanel";
import { weekLabel } from "./format";
import { ItemsList } from "./ItemsList";
import { NewsletterPreview } from "./NewsletterPreview";

interface MetaEdits {
  title?: string;
  intro?: string;
}

const sortItems = (items: NewsletterItem[]) => [...items].sort((a, b) => a.order - b.order);

function VersionBox({ version, approved }: { version: number; approved: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-xl border px-4 py-2",
        approved
          ? "border-kora-green/20 bg-kora-green-bg"
          : "border-kora-amber/25 bg-kora-amber-bg",
      )}
    >
      <p
        className={cn(
          "leading-none font-bold tabular-nums",
          approved ? "text-kora-green" : "text-kora-amber",
        )}
      >
        <span className="text-[15px]">v</span>
        <span className="text-[26px]">{version}</span>
      </p>
      <p className="mt-1 text-[11px] text-kora-ink-soft">
        {approved ? "Version approuvée" : "Non approuvée"}
      </p>
    </div>
  );
}

export function EditionWorkspace({
  edition,
  companies,
}: {
  edition: NewsletterEdition;
  companies: Map<string, Company>;
}) {
  const qc = useQueryClient();
  const perms = usePermissions();
  const [meta, setMeta] = useState<MetaEdits>({});
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  const items = sortItems(edition.items);
  const title = meta.title ?? edition.title;
  const intro = meta.intro ?? edition.intro;
  const summaryOf = (it: NewsletterItem) => summaries[it.id] ?? it.summary;
  const dirty =
    title !== edition.title ||
    intro !== edition.intro ||
    items.some((it) => summaryOf(it) !== it.summary);
  const approved = !!edition.approval?.valid && edition.approval.version === edition.version;
  const status = NEWSLETTER_STATUS[edition.status];
  const locked = edition.status === "exportee";
  const canEdit = perms.canWrite && !locked;
  const exportsQuery = usePublications({ channel: "newsletter" });
  const exports = (exportsQuery.data ?? []).filter((p) => p.newsletterId === edition.id);
  const setEdition = (e: NewsletterEdition) =>
    qc.setQueryData<NewsletterEdition[]>(qk.newsletters, (old) =>
      old?.map((x) => (x.id === e.id ? e : x)),
    );

  const recordExport = useKoraMutation(() => api.recordNewsletterExport(edition.id), {
    onSuccess: setEdition,
  });
  const onExported = () => {
    if (approved && !locked && perms.canValidate && !recordExport.isPending)
      recordExport.mutate(undefined);
  };

  const save = useKoraMutation(
    () =>
      api.updateNewsletter(edition.id, {
        title: title.trim(),
        intro,
        items: items.map((it, i) => ({ id: it.id, summary: summaryOf(it), order: i + 1 })),
      }),
    {
      success: (e) => `Version ${e.version} enregistrée`,
      onSuccess: (e) => {
        setEdition(e);
        setMeta({});
        setSummaries({});
      },
    },
  );
  const reorder = useKoraMutation(
    (ordered: NewsletterItem[]) =>
      api.updateNewsletter(edition.id, {
        items: ordered.map((it, i) => ({ id: it.id, summary: it.summary, order: i + 1 })),
      }),
    { success: "", onSuccess: setEdition },
  );
  const add = useKoraMutation((ref: TopicRef) => api.addNewsletterItem(edition.id, ref), {
    success: "Sujet ajouté à l'édition",
    onSuccess: setEdition,
  });
  const remove = useKoraMutation((itemId: string) => api.removeNewsletterItem(edition.id, itemId), {
    success: "Sujet retiré de l'édition",
    onSuccess: (e) => {
      setEdition(e);
      setSummaries((s) =>
        Object.fromEntries(Object.entries(s).filter(([id]) => e.items.some((i) => i.id === id))),
      );
    },
  });
  const approve = useKoraMutation(() => api.approveNewsletter(edition.id, edition.version), {
    success: (e) => `Version ${e.version} approuvée`,
    onSuccess: setEdition,
  });

  const move = (index: number, delta: -1 | 1) => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(index + delta, 0, moved);
    reorder.mutate(next);
  };
  const busy = reorder.isPending || remove.isPending || add.isPending || save.isPending;

  const approveHint = locked
    ? "Édition exportée : elle n'est plus modifiable."
    : !perms.canValidate
      ? "Réservé aux validateurs."
      : dirty
        ? "Enregistrez d'abord vos modifications : seule la version courante peut être approuvée."
        : approved
          ? `Version ${edition.version} déjà approuvée.`
          : items.length === 0
            ? "Ajoutez au moins un sujet avant d'approuver."
            : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="kora-card p-4">
        <div className="flex items-start gap-3.5">
          <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-kora-teal-bg text-kora-teal">
            <Mail className="size-7" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold text-kora-ink">Newsletter hebdomadaire</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill tone={status.tone}>{status.label}</Pill>
              <Pill tone="blue">{weekLabel(edition.weekOf)}</Pill>
              <Pill tone="purple">
                {plural(items.length, "sujet sélectionné", "sujets sélectionnés")}
              </Pill>
            </div>
          </div>
          <VersionBox version={edition.version} approved={approved} />
        </div>
        <h2 className="mt-3 text-[18px] leading-snug font-bold text-kora-ink">{edition.title}</h2>
        <MetaRow className="mt-2">
          <Meta icon={CalendarDays}>Créée le {formatDate(edition.createdAt)}</Meta>
          <Meta icon={Clock}>Modifiée {formatRelative(edition.updatedAt)}</Meta>
          {edition.scheduledFor && (
            <Meta icon={Mail}>Envoi prévu le {formatDate(edition.scheduledFor)}</Meta>
          )}
        </MetaRow>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <PrimaryButton
            className="flex-1"
            disabled={!!approveHint || approve.isPending}
            title={approveHint ?? undefined}
            onClick={() => approve.mutate(undefined)}
          >
            <ShieldCheck className="size-4" /> Approuver la version {edition.version}
          </PrimaryButton>
          <GhostLink
            href={downloadUrl.newsletter(edition.id, "html")}
            download
            onClick={onExported}
            className="flex-1"
          >
            <FileCode2 className="size-4" /> Export HTML
          </GhostLink>
          <GhostLink
            href={downloadUrl.newsletter(edition.id, "txt")}
            download
            onClick={onExported}
            className="flex-1"
          >
            <FileText className="size-4" /> Export texte
          </GhostLink>
        </div>
        {approveHint && !approved && !locked && (
          <p className="mt-2 text-[11.5px] text-muted-foreground">{approveHint}</p>
        )}
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Download className="size-3.5 shrink-0" />
          {locked
            ? `Version ${edition.version} exportée : les fichiers restent téléchargeables à l'identique.`
            : approved
              ? perms.canValidate
                ? "L'export de la version approuvée est consigné (clé d'idempotence) et fige l'édition."
                : "Export de la version approuvée ; seul un validateur peut le consigner comme diffusion."
              : `Tant que la version ${edition.version} n'est pas approuvée, les exports portent la mention « Aperçu non approuvé ».`}
        </p>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.85fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="kora-card p-4">
            <SectionTitle icon={ListOrdered}>Composition</SectionTitle>
            {locked && (
              <Banner
                tone="success"
                className="mb-3.5"
                title={`Édition exportée — version ${edition.version} figée`}
              >
                Elle n&apos;est plus modifiable : créez une nouvelle édition pour la semaine
                suivante.
              </Banner>
            )}
            {approved && !locked && (
              <Banner
                tone="danger"
                className="mb-3.5"
                title="Toute modification invalidera l'approbation"
              >
                Enregistrer, réordonner, ajouter ou retirer un sujet crée une nouvelle version, à
                approuver de nouveau.
              </Banner>
            )}
            <div className="flex flex-col gap-3.5">
              <Field label="Titre de l'édition" htmlFor="nl-edit-title">
                <Input
                  id="nl-edit-title"
                  value={title}
                  onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
                  readOnly={!canEdit}
                  className={cn(inputClass, "h-10 text-[15px] font-semibold md:text-[15px]")}
                />
              </Field>
              <Field label="Introduction" htmlFor="nl-edit-intro">
                <Textarea
                  id="nl-edit-intro"
                  value={intro}
                  onChange={(e) => setMeta((m) => ({ ...m, intro: e.target.value }))}
                  readOnly={!canEdit}
                  rows={4}
                  className={cn(inputClass, "min-h-[96px] leading-relaxed")}
                />
              </Field>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-kora-ink-soft">
                    Sujets, dans l&apos;ordre
                  </p>
                  <span className="text-[11.5px] font-semibold text-kora-teal-dark">
                    {plural(items.length, "sujet sélectionné", "sujets sélectionnés")}
                  </span>
                </div>
                <ItemsList
                  items={items}
                  summaries={summaries}
                  onSummary={(id, s) => setSummaries((m) => ({ ...m, [id]: s }))}
                  onMove={move}
                  onRemove={(id) => remove.mutate(id)}
                  busy={busy}
                  readOnly={!canEdit}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-3.5">
              {dirty && (
                <span className="mr-auto text-[11.5px] font-semibold text-kora-amber">
                  Modifications non enregistrées
                </span>
              )}
              {dirty && (
                <GhostButton
                  disabled={save.isPending}
                  onClick={() => {
                    setMeta({});
                    setSummaries({});
                  }}
                >
                  <RotateCcw className="size-4" /> Annuler
                </GhostButton>
              )}
              <PrimaryButton
                disabled={!dirty || !canEdit || !title.trim() || busy}
                onClick={() => save.mutate(undefined)}
              >
                <Save className="size-4" /> Enregistrer la version {edition.version + 1}
              </PrimaryButton>
            </div>
          </section>

          <AddTopicsPanel
            edition={edition}
            companies={companies}
            onAdd={(ref) => add.mutate(ref)}
            pending={busy}
            disabled={!canEdit}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
          <section className="kora-card p-4">
            <SectionTitle
              icon={Mail}
              action={
                dirty ? (
                  <Pill tone="amber" size="sm">
                    Non enregistré
                  </Pill>
                ) : undefined
              }
            >
              Aperçu HTML
            </SectionTitle>
            <NewsletterPreview
              title={title}
              intro={intro}
              weekOf={edition.weekOf}
              version={edition.version}
              approved={approved && !dirty}
              items={items.map((it) => ({ id: it.id, title: it.title, summary: summaryOf(it) }))}
            />
          </section>
          <section className="kora-card p-4">
            <SectionTitle icon={ShieldCheck}>Approbation</SectionTitle>
            {edition.approval ? (
              <ApprovalItem approval={edition.approval} showChannel={false} />
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Aucune approbation pour l&apos;instant.
              </p>
            )}
          </section>
        </div>
      </div>

      <section className="kora-card p-4">
        <SectionTitle icon={History}>Historique des exports ({exports.length})</SectionTitle>
        <AttemptHistory attempts={exports} />
      </section>
    </div>
  );
}
