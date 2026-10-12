import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { qk, useKoraMutation } from "@/lib/api/hooks";
import type { ArticleDetail, Channel } from "@/lib/api/types";
import { usePermissions } from "./hooks";

/** Met à jour le cache du détail dès la réponse (avant la ré-invalidation globale). */
export function useSetArticle() {
  const qc = useQueryClient();
  return (a: ArticleDetail) => qc.setQueryData(qk.article(a.id), a);
}

export function validApprovalFor(article: ArticleDetail, channel: Channel) {
  return (
    article.approvals.find(
      (a) => a.valid && a.channel === channel && a.version === article.currentVersion,
    ) ?? null
  );
}

/**
 * État du circuit d'approbation d'un article : actions possibles et raisons de
 * désactivation (l'API revérifie droits et état avant chaque transition).
 */
export function useArticleWorkflow(article: ArticleDetail, dirty: boolean) {
  const perms = usePermissions();
  const setArticle = useSetArticle();
  const submit = useKoraMutation(() => api.submitArticle(article.id), {
    success: (a) => `Version ${a.currentVersion} soumise en revue`,
    onSuccess: setArticle,
  });
  const s = article.status;
  const dirtyHint = "Modifications non enregistrées : enregistrez d'abord une nouvelle version.";
  const contradictions = article.factChecks.filter((f) => f.status === "contradictoire").length;

  const submitHint = !perms.canWrite
    ? "Réservé aux rédacteurs."
    : dirty
      ? dirtyHint
      : s === "en_revue"
        ? "Déjà en revue."
        : s !== "brouillon" && s !== "rejete"
          ? "Article déjà approuvé."
          : null;

  const approveHint = !perms.canValidate
    ? "Réservé aux validateurs."
    : dirty
      ? dirtyHint
      : s === "brouillon" || s === "rejete"
        ? "Soumettez d'abord l'article en revue."
        : s === "publie"
          ? "Article déjà publié."
          : contradictions > 0
            ? `${contradictions} contradiction${contradictions > 1 ? "s" : ""} à arbitrer dans le dossier factuel avant approbation.`
            : null;

  const rejectHint = !perms.canValidate
    ? "Réservé aux validateurs."
    : s === "brouillon"
      ? "Seul un article soumis en revue peut être rejeté."
      : s === "rejete"
        ? "Article déjà rejeté."
        : s === "publie"
          ? "Article déjà publié."
          : null;

  return {
    perms,
    submit,
    canSubmit: submitHint === null,
    submitHint,
    canApprove: approveHint === null,
    approveHint,
    canReject: rejectHint === null,
    rejectHint,
    canPublish: perms.canValidate && !dirty,
    dirtyHint,
  };
}

export type ArticleWorkflow = ReturnType<typeof useArticleWorkflow>;
