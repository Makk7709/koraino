import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  History,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BrandMark } from "@/components/kora/BrandMark";
import { GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { LINKEDIN_STATUS, formatDate, formatRelative } from "@/components/kora/labels";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@tanstack/react-router";
import { api, ApiError, downloadUrl } from "@/lib/api/client";
import {
  errorMessage,
  qk,
  useKoraMutation,
  useLinkedInConnection,
  usePublications,
} from "@/lib/api/hooks";
import type {
  Company,
  LinkedInPost,
  LinkedInPublishInput,
  LinkedInVariant,
  PublicationAttempt,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { LinkedInMark } from "@/components/articles/channel";
import { usePermissions } from "@/components/articles/hooks";
import {
  ApprovalItem,
  AttemptHistory,
  AttemptResult,
  RefusalResult,
} from "@/components/articles/publication";
import {
  Banner,
  Field,
  GhostLink,
  inputClass,
  Meta,
  MetaRow,
  SectionTitle,
  TagInput,
} from "@/components/articles/ui";
import { hasLinkedAccount } from "./connection";
import { LinkedInPreview } from "./LinkedInPreview";
import { LINKEDIN_MAX_CHARS, fullText, hashtag, selectedVariant, variantLetter } from "./text";
import { resolutionBlockedReason } from "./resolution";
import { UnconfirmedPublication } from "./UnconfirmedPublication";

/** Une autre demande (onglet, collègue) publie déjà cette version. */
const PUBLICATION_IN_PROGRESS = "publication_in_progress";
/** Délai laissé à la publication concurrente avant de relire son résultat. */
const IN_PROGRESS_REFRESH_MS = 5000;
/** Succès déclaré par un humain après vérification du fil LinkedIn. */
const CONFIRMED_BY_USER = "linkedin_confirmed_by_user";

/** Tentative jointe à une erreur de publication (422 / 409 de vérification). */
function attemptOf(error: unknown): PublicationAttempt | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return (error.details as { attempt?: PublicationAttempt } | undefined)?.attempt;
}

interface PostDraft {
  text: string;
  hashtags: string[];
}

function toDraft(v: LinkedInVariant | undefined): PostDraft {
  return { text: v?.text ?? "", hashtags: [...(v?.hashtags ?? [])] };
}

/** Brouillon local de la variante retenue, réinitialisé à chaque nouvelle version. */
function usePostDraft(post: LinkedInPost) {
  const base = selectedVariant(post);
  const key = `${post.id}:${post.version}:${post.selectedVariantId}`;
  const [state, setState] = useState(() => ({ key, draft: toDraft(base) }));
  let draft = state.draft;
  if (state.key !== key) {
    draft = toDraft(base);
    setState({ key, draft });
  }
  const initial = toDraft(base);
  const dirty =
    draft.text !== initial.text ||
    draft.hashtags.length !== initial.hashtags.length ||
    draft.hashtags.some((h, i) => h !== initial.hashtags[i]);
  return {
    draft,
    dirty,
    setText: (text: string) => setState((s) => ({ ...s, draft: { ...s.draft, text } })),
    setHashtags: (hashtags: string[]) =>
      setState((s) => ({ ...s, draft: { ...s.draft, hashtags } })),
    reset: () => setState({ key, draft: toDraft(base) }),
  };
}

function ApprovalBox({ post, approvedCurrent }: { post: LinkedInPost; approvedCurrent: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-xl border px-4 py-2",
        approvedCurrent
          ? "border-kora-green/20 bg-kora-green-bg"
          : "border-kora-amber/25 bg-kora-amber-bg",
      )}
    >
      <p
        className={cn(
          "leading-none font-bold tabular-nums",
          approvedCurrent ? "text-kora-green" : "text-kora-amber",
        )}
      >
        <span className="text-[15px]">v</span>
        <span className="text-[26px]">{post.version}</span>
      </p>
      <p className="mt-1 text-[11px] text-kora-ink-soft">
        {approvedCurrent ? "Version approuvée" : "Non approuvée"}
      </p>
    </div>
  );
}

export function PostDetail({
  post,
  company,
}: {
  post: LinkedInPost;
  company: Company | undefined;
}) {
  const qc = useQueryClient();
  const perms = usePermissions();
  const { draft, dirty, setText, setHashtags, reset } = usePostDraft(post);
  const attemptsQuery = usePublications({ channel: "linkedin" });
  const attempts = (attemptsQuery.data ?? []).filter((a) => a.linkedinPostId === post.id);
  const connected = hasLinkedAccount(useLinkedInConnection().data);
  const setPost = (p: LinkedInPost) =>
    qc.setQueryData<LinkedInPost[]>(qk.linkedin, (old) => old?.map((x) => (x.id === p.id ? p : x)));

  const update = useKoraMutation(
    (input: { selectedVariantId?: string; variants?: LinkedInVariant[] }) =>
      api.updateLinkedInPost(post.id, input),
    { success: (p) => `Version ${p.version} enregistrée`, onSuccess: setPost },
  );
  const submit = useKoraMutation(() => api.submitLinkedInPost(post.id), {
    success: "Post soumis à validation",
    onSuccess: setPost,
  });
  const approve = useKoraMutation(() => api.approveLinkedInPost(post.id, post.version), {
    success: (p) => `Version ${p.version} approuvée`,
    onSuccess: setPost,
  });
  const publish = useKoraMutation(
    (input?: LinkedInPublishInput) => api.publishLinkedInPost(post.id, input),
    {
      success: (r) =>
        r.status !== "succes"
          ? ""
          : r.code === CONFIRMED_BY_USER
            ? "Publication confirmée"
            : r.mode === "publication"
              ? "Post publié sur LinkedIn"
              : "Export LinkedIn prêt",
    },
  );
  // `isPending` ne désactive le bouton qu'au rendu suivant : un second clic ou une
  // répétition de touche passerait encore.
  const publishing = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["kora"] });
  const runPublish = (input?: LinkedInPublishInput) => {
    if (publishing.current) return;
    publishing.current = true;
    publish.mutate(input, {
      onError: (e) => {
        refresh();
        if (!(e instanceof ApiError) || e.code !== PUBLICATION_IN_PROGRESS) return;
        clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(refresh, IN_PROGRESS_REFRESH_MS);
      },
      onSettled: () => {
        publishing.current = false;
      },
    });
  };

  const variant = selectedVariant(post);
  const canEdit = perms.canWrite && post.status !== "publie";
  const approvedCurrent = !!post.approval?.valid && post.approval.version === post.version;
  const lastAttempt =
    publish.data ?? [...attempts].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const inProgress =
    publish.error instanceof ApiError && publish.error.code === PUBLICATION_IN_PROGRESS;
  const settledElsewhere =
    inProgress && lastAttempt?.status === "succes" && lastAttempt.version === post.version;
  const refused = publish.isError && !settledElsewhere;
  const settledNow = lastAttempt?.status === "succes" && lastAttempt.version === post.version;
  const unconfirmed = settledNow
    ? null
    : ([attemptOf(publish.error), lastAttempt].find(
        (a) => a?.status === "verification_requise" && a.version === post.version,
      ) ?? null);
  const exported =
    post.status === "exporte" ||
    post.status === "publie" ||
    attempts.some((a) => a.status === "succes");
  const status = LINKEDIN_STATUS[post.status];
  const text = fullText(draft.text, draft.hashtags);
  const tooLong = text.length > LINKEDIN_MAX_CHARS;
  const useHash = post.variants.some((v) => v.hashtags.some((h) => h.startsWith("#")));

  const submitHint = !perms.canWrite
    ? "Réservé aux rédacteurs."
    : dirty
      ? "Enregistrez d'abord vos modifications."
      : post.status !== "brouillon"
        ? "Seul un brouillon peut être soumis."
        : null;
  const approveHint = !perms.canValidate
    ? "Réservé aux validateurs."
    : dirty
      ? "Modifications non enregistrées : la version affichée n'est pas la version courante."
      : approvedCurrent
        ? `Version ${post.version} déjà approuvée.`
        : post.status === "brouillon"
          ? "Soumettez d'abord le post à validation."
          : post.status !== "a_valider"
            ? "Aucune version à valider."
            : null;
  const exportHint = !approvedCurrent
    ? `Approbation valide de la version ${post.version} requise avant export.`
    : dirty
      ? "Enregistrez ou annulez vos modifications d'abord."
      : !perms.canValidate
        ? "L'export vers LinkedIn est réservé aux validateurs."
        : unconfirmed
          ? "Indiquez d'abord si la publication précédente figure sur LinkedIn."
          : null;
  const next =
    post.status === "brouillon" ? "submit" : post.status === "a_valider" ? "approve" : "export";

  const saveText = () => {
    if (!variant) return;
    const tags = [...new Set(draft.hashtags.map((h) => h.trim()).filter(Boolean))].map((h) =>
      useHash ? hashtag(h) : h.replace(/^#/, ""),
    );
    update.mutate({
      variants: post.variants.map((v) =>
        v.id === variant.id ? { ...v, text: draft.text, hashtags: tags } : v,
      ),
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texte du post copié");
    } catch {
      toast.error("Copie impossible : sélectionnez le texte de l'aperçu manuellement.");
    }
  };

  const buttons = {
    submit: {
      label: "Soumettre à validation",
      icon: Send,
      disabled: !!submitHint || submit.isPending,
      hint: submitHint,
      run: () => submit.mutate(undefined),
    },
    approve: {
      label: `Approuver la version ${post.version}`,
      icon: ShieldCheck,
      disabled: !!approveHint || approve.isPending,
      hint: approveHint,
      run: () => approve.mutate(undefined),
    },
    export: {
      label: connected
        ? publish.isPending
          ? "Publication…"
          : "Publier sur LinkedIn"
        : publish.isPending
          ? "Export…"
          : "Exporter",
      icon: Upload,
      disabled: !!exportHint || publish.isPending,
      hint: exportHint,
      run: () => runPublish(),
    },
  } as const;

  return (
    <div className="flex flex-col gap-4">
      <section className="kora-card p-4">
        <div className="flex items-start gap-3.5">
          <LinkedInMark className="size-14 rounded-xl text-[24px]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-bold text-kora-ink">
              Post LinkedIn{company ? ` · ${company.name}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill tone={status.tone}>{status.label}</Pill>
              <Pill tone="blue">
                {post.variants.length} variante{post.variants.length > 1 ? "s" : ""}
              </Pill>
              {variant && (
                <Pill tone="purple">
                  Variante {variantLetter(post.variants.indexOf(variant))} retenue
                </Pill>
              )}
            </div>
          </div>
          <ApprovalBox post={post} approvedCurrent={approvedCurrent} />
        </div>
        <h2 className="mt-3 text-[18px] leading-snug font-bold text-kora-ink">{post.title}</h2>
        <MetaRow className="mt-2">
          <Meta icon={CalendarDays}>Créé le {formatDate(post.createdAt)}</Meta>
          <Meta icon={Clock}>Modifié {formatRelative(post.updatedAt)}</Meta>
          {company && (
            <span className="inline-flex items-center gap-1.5">
              <BrandMark name={company.name} brand={company.brand} size="xs" />
              {company.name}
            </span>
          )}
          {post.articleId && (
            <Link
              to="/articles"
              search={{ id: post.articleId }}
              className="inline-flex items-center gap-1 font-medium text-kora-teal hover:text-kora-teal-dark"
            >
              <ExternalLink className="size-3.5" /> Article source
            </Link>
          )}
        </MetaRow>

        <div className="mt-3.5 flex flex-wrap gap-2">
          {(["submit", "approve", "export"] as const).map((k) => {
            const b = buttons[k];
            const Btn = k === next ? PrimaryButton : GhostButton;
            const Icon = b.icon;
            return (
              <Btn
                key={k}
                className="flex-1"
                disabled={b.disabled}
                title={b.hint ?? undefined}
                onClick={b.run}
              >
                <Icon className="size-4" /> {b.label}
              </Btn>
            );
          })}
          {exported && (
            <>
              <GhostLink href={downloadUrl.linkedin(post.id)} download className="flex-1">
                <Download className="size-4" /> Télécharger l&apos;export
              </GhostLink>
              <GhostButton className="flex-1" onClick={() => void copy()}>
                <Copy className="size-4" /> Copier le texte
              </GhostButton>
            </>
          )}
        </div>
        {buttons[next].hint && (
          <p className="mt-2 text-[11.5px] text-muted-foreground">{buttons[next].hint}</p>
        )}
        {(unconfirmed || refused || lastAttempt) && (
          <div className="mt-3">
            {unconfirmed ? (
              <UnconfirmedPublication
                attempt={unconfirmed}
                disabledReason={
                  perms.canValidate
                    ? resolutionBlockedReason(unconfirmed, perms.me)
                    : "La vérification est réservée aux validateurs."
                }
                pending={publish.isPending}
                onResolve={(resolution) => runPublish({ resolution })}
              />
            ) : refused && inProgress ? (
              <Banner tone="warning" title="Publication déjà en cours">
                {errorMessage(publish.error)}
              </Banner>
            ) : refused ? (
              <RefusalResult error={publish.error} />
            ) : lastAttempt ? (
              <AttemptResult attempt={lastAttempt} />
            ) : null}
          </div>
        )}
      </section>

      <div className="grid items-start gap-4 min-[1400px]:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
        <section className="kora-card p-4">
          <SectionTitle>Variantes</SectionTitle>
          <RadioGroup
            value={post.selectedVariantId}
            onValueChange={(id) => update.mutate({ selectedVariantId: id })}
            disabled={dirty || !canEdit || update.isPending}
            className="gap-2"
          >
            {post.variants.map((v, i) => {
              const checked = v.id === post.selectedVariantId;
              return (
                <label
                  key={v.id}
                  htmlFor={`variant-${v.id}`}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-xl border p-3 transition",
                    checked
                      ? "border-kora-teal-light bg-kora-teal-bg/60 ring-1 ring-kora-teal-light/50"
                      : "border-border bg-white hover:border-kora-teal-light",
                    (dirty || !canEdit) && !checked && "cursor-not-allowed opacity-70",
                  )}
                >
                  <RadioGroupItem id={`variant-${v.id}`} value={v.id} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[12.5px] font-bold text-kora-ink">
                      Variante {variantLetter(i)}
                      {checked && (
                        <Pill tone="teal" size="sm">
                          <Check className="size-3" strokeWidth={3} /> Retenue
                        </Pill>
                      )}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-kora-ink-soft">
                      {v.text}
                    </p>
                    {v.hashtags.length > 0 && (
                      <p className="mt-1 truncate text-[11.5px] font-medium text-kora-linkedin">
                        {v.hashtags.map(hashtag).join(" ")}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </RadioGroup>
          {dirty && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Enregistrez ou annulez vos modifications pour changer de variante.
            </p>
          )}

          <div className="mt-5 flex flex-col gap-3.5 border-t border-border/70 pt-4">
            <SectionTitle
              className="mb-0"
              action={
                <span
                  className={cn(
                    "text-[11.5px] tabular-nums",
                    tooLong ? "font-semibold text-kora-rose" : "text-muted-foreground",
                  )}
                >
                  {text.length.toLocaleString("fr-FR")} /{" "}
                  {LINKEDIN_MAX_CHARS.toLocaleString("fr-FR")} caractères
                </span>
              }
            >
              Texte de la variante {variant ? variantLetter(post.variants.indexOf(variant)) : ""}
            </SectionTitle>
            {approvedCurrent && (
              <Banner tone="danger" title="Toute modification invalidera l'approbation">
                Enregistrer le texte ou changer de variante crée la version {post.version + 1}, qui
                devra être approuvée à nouveau avant export.
              </Banner>
            )}
            <Textarea
              value={draft.text}
              onChange={(e) => setText(e.target.value)}
              readOnly={!canEdit}
              aria-label="Texte du post"
              className={cn(
                inputClass,
                "min-h-[240px] px-4 py-3 text-[14px] leading-relaxed md:text-[14px]",
              )}
            />
            <Field label="Hashtags" htmlFor="post-hashtags">
              <TagInput
                id="post-hashtags"
                value={draft.hashtags}
                onChange={setHashtags}
                disabled={!canEdit}
                format={hashtag}
                placeholder="#Grenoble, #Innovation…"
              />
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dirty && (
                <span className="mr-auto text-[11.5px] font-semibold text-kora-amber">
                  Modifications non enregistrées
                </span>
              )}
              {dirty && (
                <GhostButton onClick={reset} disabled={update.isPending}>
                  <RotateCcw className="size-4" /> Annuler
                </GhostButton>
              )}
              <PrimaryButton
                disabled={!dirty || !canEdit || !draft.text.trim() || tooLong || update.isPending}
                onClick={saveText}
              >
                <Save className="size-4" /> Enregistrer la version {post.version + 1}
              </PrimaryButton>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-4 min-[1400px]:sticky min-[1400px]:top-4">
          <section className="kora-card p-4">
            <SectionTitle>Aperçu LinkedIn</SectionTitle>
            <LinkedInPreview text={draft.text} hashtags={draft.hashtags} />
            {dirty && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Aperçu incluant les modifications non enregistrées.
              </p>
            )}
          </section>
          <section className="kora-card p-4">
            <SectionTitle icon={ShieldCheck}>Approbation</SectionTitle>
            {post.approval ? (
              <ApprovalItem approval={post.approval} showChannel={false} />
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Aucune approbation : l&apos;export est bloqué tant qu&apos;une version n&apos;est
                pas approuvée.
              </p>
            )}
          </section>
        </div>
      </div>

      <section className="kora-card p-4">
        <SectionTitle icon={History}>Historique des exports ({attempts.length})</SectionTitle>
        <AttemptHistory attempts={attempts} />
      </section>
    </div>
  );
}
