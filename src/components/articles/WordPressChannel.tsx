import { Link } from "@tanstack/react-router";
import { ExternalLink, FlaskConical, RefreshCw, Settings } from "lucide-react";
import { Pill } from "@/components/kora/primitives";
import { WORDPRESS_STATUS, formatDateTime } from "@/components/kora/labels";
import { ApiError } from "@/lib/api/client";
import { errorMessage, useRefreshArticleWordPress } from "@/lib/api/hooks";
import type { ArticleDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Banner } from "./ui";
import {
  WORDPRESS_NOT_CONFIGURED,
  hasRemoteDraft,
  safeHttpUrl,
  verificationCandidates,
  wordpressErrorView,
} from "./wordpress";
import { useSetArticle } from "./workflow";

const smallButton =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[11.5px] font-medium text-kora-ink transition hover:border-kora-teal-light hover:bg-kora-teal-bg disabled:pointer-events-none disabled:opacity-50";

/** Lien d'édition dans l'administration WordPress, toujours dans un nouvel onglet. */
export function OpenInWordPress({ href, className }: { href: string; className?: string }) {
  const url = safeHttpUrl(href);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(smallButton, className)}>
      <ExternalLink className="size-3.5" aria-hidden />
      Ouvrir dans WordPress
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );
}

function SettingsLink() {
  return (
    <Link
      to="/parametres"
      search={{ tab: "wordpress" }}
      className="inline-flex items-center gap-1 font-semibold text-kora-teal hover:text-kora-teal-dark hover:underline"
    >
      <Settings className="size-3.5" aria-hidden /> Paramètres &gt; WordPress
    </Link>
  );
}

/**
 * État du contenu côté WordPress : statut, identifiant, dernière synchronisation, lien
 * d'édition et actualisation (validateurs et administrateurs, s'il existe un brouillon).
 */
export function WordPressRemoteState({
  article,
  canRefresh,
  refreshBlockedReason,
}: {
  article: ArticleDetail;
  canRefresh: boolean;
  refreshBlockedReason: string | null;
}) {
  const wp = article.wordpress;
  const status = WORDPRESS_STATUS[wp.status];
  const refresh = useRefreshArticleWordPress();
  const setArticle = useSetArticle();
  const draft = hasRemoteDraft(wp);
  const editUrl = wp.status !== "supprime" ? (wp.editUrl ?? null) : null;
  const showHint = wp.status !== "aucun" && wp.status !== "brouillon";

  return (
    <div className="mt-2.5 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-[11.5px] text-kora-ink-soft">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5">
          État WordPress :
          <Pill tone={status.tone} size="sm">
            {status.label}
          </Pill>
        </span>
        {wp.remoteId && (
          <span>
            n° <span className="font-mono text-kora-ink">{wp.remoteId}</span>
          </span>
        )}
        {(draft || wp.lastSyncAt) && (
          <span>
            Dernière synchronisation :{" "}
            <span className="text-kora-ink">
              {wp.lastSyncAt ? formatDateTime(wp.lastSyncAt) : "jamais"}
            </span>
          </span>
        )}
        {(editUrl || (canRefresh && draft)) && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {editUrl && <OpenInWordPress href={editUrl} />}
            {canRefresh && draft && (
              <button
                type="button"
                className={smallButton}
                disabled={!!refreshBlockedReason || refresh.isPending}
                title={refreshBlockedReason ?? "Relire l'état du brouillon sur WordPress"}
                aria-busy={refresh.isPending || undefined}
                onClick={() => refresh.mutate(article.id, { onSuccess: setArticle })}
              >
                <RefreshCw
                  className={cn("size-3.5", refresh.isPending && "animate-spin")}
                  aria-hidden
                />
                {refresh.isPending ? "Actualisation…" : "Actualiser le statut"}
              </button>
            )}
          </span>
        )}
      </div>
      {showHint && <p className="mt-1.5 text-[11px] text-muted-foreground">{status.hint}</p>}
    </div>
  );
}

/** Configuration absente (envoi désactivé) ou mode démonstration (mention discrète). */
export function WordPressModeNote({
  notConfigured,
  demo,
}: {
  notConfigured: boolean;
  demo: boolean;
}) {
  if (notConfigured)
    return (
      <Banner tone="warning" className="mt-2.5" title={WORDPRESS_NOT_CONFIGURED}>
        L&apos;envoi est désactivé tant qu&apos;un administrateur n&apos;a pas renseigné la
        connexion au site : <SettingsLink />.
      </Banner>
    );
  if (demo)
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FlaskConical className="size-3.5" aria-hidden /> Mode démonstration : brouillon simulé
      </p>
    );
  return null;
}

/** Envoi interrompu avant confirmation : contrairement à LinkedIn, aucun verdict humain n'est attendu. */
export function WordPressPendingNote() {
  return (
    <p className="mt-1.5 text-[11px] text-muted-foreground">
      Au prochain envoi, KORA recherche lui-même ce brouillon sur WordPress avant d&apos;en créer un
      autre : aucune vérification manuelle n&apos;est nécessaire.
    </p>
  );
}

/** Refus de l'API pour un envoi WordPress : message du serveur, et aide selon le code. */
export function WordPressRefusal({ error, editUrl }: { error: unknown; editUrl: string | null }) {
  const view = wordpressErrorView(error);
  const candidates =
    view.code === "publication_verification_required" && error instanceof ApiError
      ? verificationCandidates(error.details)
      : [];

  return (
    <Banner tone={view.tone} title={view.title}>
      <p>{errorMessage(error)}</p>
      {view.code === "wordpress_remote_published" && editUrl && (
        <div className="mt-2">
          <OpenInWordPress href={editUrl} />
        </div>
      )}
      {view.code === "wordpress_not_configured" && (
        <p className="mt-1">
          Voir <SettingsLink />.
        </p>
      )}
      {candidates.length > 0 && (
        <div className="mt-2">
          <p className="text-[11.5px] font-semibold text-kora-ink">
            Brouillons trouvés sur WordPress ({candidates.length}) :
          </p>
          <ul className="mt-1 flex flex-col gap-1.5" aria-label="Brouillons candidats">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-border/70 bg-white/80 px-2.5 py-1.5 text-[11.5px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-kora-ink">{c.title || "Sans titre"}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    n° <span className="font-mono">{c.id}</span>
                    {c.date && <> · {formatDateTime(c.date)}</>}
                  </span>
                </span>
                {c.editUrl && <OpenInWordPress href={c.editUrl} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.code && (
        <p className="mt-1.5">
          <span className="rounded bg-white/70 px-1.5 py-px font-mono text-[10.5px] text-kora-ink">
            {view.code}
          </span>
        </p>
      )}
    </Banner>
  );
}
