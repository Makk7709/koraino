import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { api } from "@/lib/api/client";
import {
  qk,
  useCompanies,
  useKoraMutation,
  useLinkedInPosts,
  useMe,
  useNewsletters,
} from "@/lib/api/hooks";
import type { Company, Role } from "@/lib/api/types";

/**
 * Droits d'interface (le serveur revérifie toujours). Tant que le profil n'est pas
 * chargé, rien n'est désactivé pour éviter un clignotement.
 */
export function usePermissions() {
  const { data: me } = useMe();
  const has = (...roles: Role[]) => !me || me.roles.some((r) => roles.includes(r));
  const canWrite = has("admin", "redacteur");
  const canValidate = has("admin", "validateur");
  return { me, canWrite, canValidate, readOnly: !canWrite && !canValidate };
}

export type Permissions = ReturnType<typeof usePermissions>;

export function useCompanyMap(): Map<string, Company> {
  const { data } = useCompanies();
  return useMemo(() => new Map((data ?? []).map((c) => [c.id, c])), [data]);
}

/** Édition de newsletter en composition (cible de « Ajouter à la newsletter »). */
export function useComposingEdition() {
  const { data } = useNewsletters();
  return data?.find((e) => e.status === "composition") ?? null;
}

/** Ajoute un article ou un signal à l'édition en composition (créée au besoin). */
export function useAddToNewsletter() {
  const qc = useQueryClient();
  return useKoraMutation(
    async (input: { articleId: string } | { signalId: string }) => {
      const editions = await qc.fetchQuery({ queryKey: qk.newsletters, queryFn: api.newsletters });
      const target =
        editions.find((e) => e.status === "composition") ?? (await api.createNewsletter({}));
      return api.addNewsletterItem(target.id, input);
    },
    { success: (ed) => `Ajouté à l'édition « ${ed.title} »` },
  );
}

/** Post LinkedIn déjà préparé pour un article (évite les doublons). */
export function useLinkedInPostFor(articleId: string) {
  const { data } = useLinkedInPosts();
  return data?.find((p) => p.articleId === articleId) ?? null;
}

export function useGenerateLinkedInPost() {
  const navigate = useNavigate();
  return useKoraMutation((articleId: string) => api.createLinkedInPost({ articleId }), {
    success: "Post LinkedIn préparé : variantes à relire",
    onSuccess: (p) => void navigate({ to: "/linkedin", search: { id: p.id } }),
  });
}
