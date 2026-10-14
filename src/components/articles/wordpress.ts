import { ApiError } from "@/lib/api/client";
import type { Article, WordPressStatus } from "@/lib/api/types";
import type { BannerTone } from "./ui";

type RemoteState = Pick<Article["wordpress"], "remoteId" | "status">;

export const WORDPRESS_NOT_CONFIGURED =
  "WordPress n'est pas configuré : voir Paramètres > WordPress.";

/** Brouillon distant connu de KORA (le serveur revérifie qu'il appartient bien au site configuré). */
export function hasRemoteDraft(wp: RemoteState): boolean {
  return !!wp.remoteId && wp.status !== "aucun" && wp.status !== "supprime";
}

/** Contenu en ligne ou programmé : le serveur refuse de le modifier (409 `wordpress_remote_published`). */
export function isRemoteLocked(wp: RemoteState): boolean {
  return !!wp.remoteId && (wp.status === "publie" || wp.status === "programme");
}

/** Libellé du bouton d'envoi : le serveur décide seul entre création et mise à jour. */
export function wordpressActionLabel(wp: RemoteState): string {
  if (!wp.remoteId || wp.status === "aucun") return "Créer le brouillon WordPress";
  if (wp.status === "supprime") return "Recréer le brouillon WordPress";
  if (wp.status === "brouillon" || wp.status === "en_attente")
    return "Mettre à jour le brouillon WordPress";
  return "Envoyer à WordPress";
}

/**
 * État du bouton d'envoi WordPress. Un statut absent (chargement, erreur, serveur plus ancien)
 * ne bloque rien : l'API revérifie la configuration avant tout envoi.
 */
export function wordpressSendState(
  status: Pick<WordPressStatus, "mode"> | undefined,
  channelReason: string | null,
): { disabledReason: string | null; notConfigured: boolean; demo: boolean } {
  const notConfigured = status?.mode === "non_configure";
  return {
    disabledReason: notConfigured ? WORDPRESS_NOT_CONFIGURED : channelReason,
    notConfigured,
    demo: status?.mode === "simule",
  };
}

const ERROR_VIEW: Partial<Record<string, { tone: BannerTone; title: string }>> = {
  publication_verification_required: {
    tone: "warning",
    title: "Plusieurs brouillons identiques sur WordPress",
  },
  wordpress_remote_published: {
    tone: "warning",
    title: "Contenu déjà en ligne ou programmé : la modification se fait dans WordPress",
  },
  wordpress_not_configured: { tone: "warning", title: "WordPress n'est pas configuré" },
  publication_in_progress: { tone: "info", title: "Un envoi vers WordPress est déjà en cours" },
  wordpress_auth_failed: { tone: "danger", title: "Identifiants WordPress refusés" },
  wordpress_forbidden: { tone: "danger", title: "Droit manquant pour le compte WordPress" },
  wordpress_blocked: { tone: "danger", title: "Accès bloqué par la protection du site" },
  wordpress_rate_limited: { tone: "danger", title: "Trop de requêtes vers WordPress" },
  wordpress_invalid: { tone: "danger", title: "Envoi refusé par WordPress" },
  wordpress_unavailable: { tone: "danger", title: "Site WordPress injoignable" },
};

export interface WordPressErrorView {
  code: string | null;
  tone: BannerTone;
  title: string;
}

/** Présentation d'un refus de l'API lors d'un envoi ou d'une actualisation WordPress. */
export function wordpressErrorView(error: unknown): WordPressErrorView {
  const code = error instanceof ApiError ? error.code : null;
  const fallback = { tone: "danger", title: "Envoi bloqué par l'API" } as const;
  return { code, ...((code ? ERROR_VIEW[code] : undefined) ?? fallback) };
}

export interface WordPressCandidate {
  id: string;
  title: string;
  date: string | null;
  editUrl: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function firstString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Date lisible ou null ; les champs `*Gmt` de WordPress n'ont pas de suffixe de fuseau. */
function candidateDate(o: Record<string, unknown>): string | null {
  for (const k of ["date", "modifiedGmt", "dateGmt", "modified", "at"]) {
    const v = o[k];
    if (typeof v !== "string" || !v.trim()) continue;
    const raw = v.trim();
    const iso = k.endsWith("Gmt") && /T\d{2}:\d{2}(:\d{2})?$/.test(raw) ? `${raw}Z` : raw;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  return null;
}

/** Lien ouvrable sans risque : seules les adresses http(s) sont conservées. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Brouillons candidats d'un 409 `publication_verification_required`. Le contrat annonce
 * « id, titre, date, lien d'édition » sans figer la forme : on accepte une liste directe ou
 * rangée sous `candidates` / `drafts` / `posts`, et les variantes de noms usuelles.
 */
export function verificationCandidates(details: unknown): WordPressCandidate[] {
  const list = Array.isArray(details)
    ? details
    : isRecord(details)
      ? [details["candidates"], details["drafts"], details["posts"]].find(Array.isArray)
      : undefined;
  if (!list) return [];
  const out: WordPressCandidate[] = [];
  for (const item of list as unknown[]) {
    if (!isRecord(item)) continue;
    const rawId = item["id"] ?? item["remoteId"];
    const id =
      typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : typeof rawId === "string"
          ? rawId.trim()
          : "";
    if (!id) continue;
    out.push({
      id,
      title: firstString(item, ["title", "titre"]) ?? "",
      date: candidateDate(item),
      editUrl: safeHttpUrl(firstString(item, ["editUrl", "edit_url", "link", "url"])),
    });
  }
  return out;
}
