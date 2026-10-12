import { Eye, PencilLine, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { ArticleDetail, ArticleVersionInput } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import type { ArticleDraft, ArticleDraftState } from "./draft";
import { countMarkers } from "./format";
import { HighlightMarkers, RichBody } from "./markers";
import { Banner, Field, inputClass, Segmented, TagInput } from "./ui";
import { useSetArticle } from "./workflow";

/** Aperçu de lecture ; les marqueurs « [À vérifier] » sont surlignés en ambre. */
export function ArticlePreview({ draft }: { draft: ArticleDraft }) {
  return (
    <article className="rounded-xl border border-border bg-white px-6 py-5">
      <h2 className="text-[22px] leading-tight font-bold tracking-tight text-kora-ink">
        <HighlightMarkers text={draft.title || "Sans titre"} />
      </h2>
      {draft.chapo && (
        <p className="mt-3 text-[15px] leading-relaxed font-semibold text-kora-ink-soft">
          <HighlightMarkers text={draft.chapo} />
        </p>
      )}
      <div className="mt-4 border-t border-border/70 pt-4">
        {draft.body.trim() ? (
          <RichBody body={draft.body} />
        ) : (
          <p className="text-sm text-muted-foreground">Corps vide.</p>
        )}
      </div>
      {(draft.categories.length > 0 || draft.tags.length > 0) && (
        <div className="mt-5 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
          {draft.categories.map((c) => (
            <Pill key={`c-${c}`} tone="blue" size="sm">
              {c}
            </Pill>
          ))}
          {draft.tags.map((t) => (
            <Pill key={`t-${t}`} tone="purple" size="sm">
              #{t}
            </Pill>
          ))}
        </div>
      )}
    </article>
  );
}

function charCount(n: number, max?: number) {
  return (
    <span className={cn(max !== undefined && n > max && "font-semibold text-kora-rose")}>
      {n}
      {max !== undefined ? ` / ${max}` : ""} car.
    </span>
  );
}

export function ArticleEditor({
  article,
  state,
  canWrite,
}: {
  article: ArticleDetail;
  state: ArticleDraftState;
  canWrite: boolean;
}) {
  const { draft, dirty, update, reset } = state;
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [note, setNote] = useState("");
  const setArticle = useSetArticle();
  const save = useKoraMutation(
    (input: ArticleVersionInput) => api.saveArticleVersion(article.id, input),
    {
      success: (a) => `Version ${a.currentVersion} enregistrée`,
      onSuccess: (a) => {
        setArticle(a);
        setNote("");
      },
    },
  );
  const approved = article.approvals.some((a) => a.valid);
  const next = article.currentVersion + 1;
  const markers = countMarkers(`${draft.title}\n${draft.chapo}\n${draft.body}`);
  const missing = !draft.title.trim() ? "le titre" : !draft.body.trim() ? "le corps" : null;
  const readOnly = !canWrite;

  const onSave = () =>
    save.mutate({
      title: draft.title.trim(),
      chapo: draft.chapo.trim(),
      body: draft.body,
      excerpt: draft.excerpt.trim(),
      seoTitle: draft.seoTitle.trim(),
      categories: draft.categories,
      tags: draft.tags,
      note: note.trim() || null,
    });

  return (
    <div className="flex flex-col gap-3.5">
      {/* Barre d'enregistrement, toujours visible pendant la rédaction */}
      <div className="sticky top-2 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white/95 px-3 py-2 shadow-[0_4px_16px_-10px_oklch(0.289_0.062_263.9/35%)] backdrop-blur">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "edit", label: "Édition", icon: PencilLine },
            { value: "preview", label: "Aperçu", icon: Eye },
          ]}
        />
        {markers > 0 && (
          <Pill tone="amber" size="sm" className="font-semibold">
            <TriangleAlert className="size-3" /> {markers} passage{markers > 1 ? "s" : ""} « À
            vérifier »
          </Pill>
        )}
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          {dirty ? (
            <span className="font-semibold text-kora-amber">Modifications non enregistrées</span>
          ) : (
            `Version ${article.currentVersion} · à jour`
          )}
        </span>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={readOnly || !dirty}
          placeholder="Note de version (facultatif)"
          aria-label="Note de version"
          className={cn(inputClass, "h-8 w-56")}
        />
        {dirty && (
          <GhostButton className="h-8 px-2.5 text-xs" onClick={reset} disabled={save.isPending}>
            <RotateCcw className="size-3.5" /> Annuler
          </GhostButton>
        )}
        <PrimaryButton
          className="h-8 px-3 text-xs"
          disabled={readOnly || !dirty || !!missing || save.isPending}
          title={
            readOnly
              ? "Lecture seule"
              : missing
                ? `Renseignez ${missing} avant d'enregistrer`
                : undefined
          }
          onClick={onSave}
        >
          <Save className="size-3.5" />
          {save.isPending ? "Enregistrement…" : `Enregistrer la version ${next}`}
        </PrimaryButton>
      </div>

      {approved && (
        <Banner tone="danger" title="Enregistrer une modification invalidera l'approbation">
          Cet article dispose d&apos;une approbation valide pour la version {article.currentVersion}
          . Toute nouvelle version devra être relue et approuvée à nouveau avant diffusion.
        </Banner>
      )}

      <div className="grid gap-4 min-[1440px]:grid-cols-[minmax(0,1fr)_290px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {mode === "preview" ? (
            <ArticlePreview draft={draft} />
          ) : (
            <>
              <Field label="Titre" htmlFor="article-title" aside={charCount(draft.title.length)}>
                <Input
                  id="article-title"
                  value={draft.title}
                  readOnly={readOnly}
                  onChange={(e) => update("title", e.target.value)}
                  className={cn(inputClass, "h-11 text-[16px] font-bold md:text-[16px]")}
                />
              </Field>
              <Field label="Chapô" htmlFor="article-chapo" aside={charCount(draft.chapo.length)}>
                <Textarea
                  id="article-chapo"
                  value={draft.chapo}
                  readOnly={readOnly}
                  onChange={(e) => update("chapo", e.target.value)}
                  rows={3}
                  className={cn(inputClass, "font-medium leading-relaxed")}
                />
              </Field>
              <Field
                label="Corps de l'article"
                htmlFor="article-body"
                aside={`${draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0} mots`}
                hint="Paragraphes séparés par une ligne vide · « ## » pour un intertitre · « - » pour une liste. Les éléments non corroborés portent le marqueur [À vérifier]."
              >
                <Textarea
                  id="article-body"
                  value={draft.body}
                  readOnly={readOnly}
                  onChange={(e) => update("body", e.target.value)}
                  className={cn(
                    inputClass,
                    "min-h-[480px] resize-y px-4 py-3 text-[14px] leading-7 md:text-[14px]",
                  )}
                />
              </Field>
            </>
          )}
        </div>

        <aside className="flex flex-col gap-3.5">
          <Field
            label="Extrait"
            htmlFor="article-excerpt"
            aside={charCount(draft.excerpt.length, 300)}
          >
            <Textarea
              id="article-excerpt"
              value={draft.excerpt}
              readOnly={readOnly}
              onChange={(e) => update("excerpt", e.target.value)}
              rows={4}
              className={cn(inputClass, "leading-relaxed")}
            />
          </Field>
          <Field
            label="Titre SEO"
            htmlFor="article-seo"
            aside={charCount(draft.seoTitle.length, 60)}
            hint="Suggestion KORA, modifiable ; aucun connecteur de plugin SEO."
          >
            <Input
              id="article-seo"
              value={draft.seoTitle}
              readOnly={readOnly}
              onChange={(e) => update("seoTitle", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Catégories" htmlFor="article-categories">
            <TagInput
              id="article-categories"
              value={draft.categories}
              onChange={(v) => update("categories", v)}
              disabled={readOnly}
              placeholder="Ajouter (Entrée)"
            />
          </Field>
          <Field label="Tags" htmlFor="article-tags">
            <TagInput
              id="article-tags"
              value={draft.tags}
              onChange={(v) => update("tags", v)}
              disabled={readOnly}
              tone="purple"
              placeholder="Ajouter (Entrée)"
            />
          </Field>
        </aside>
      </div>
    </div>
  );
}
