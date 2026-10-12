import type { Tone } from "@/components/kora/labels";
import type { HumanImport, ImportProposal } from "@/lib/api/types";

export const PROPOSAL_KIND: Record<ImportProposal["kind"], { label: string; tone: Tone }> = {
  enrichissement: { label: "Enrichissement", tone: "purple" },
  correction: { label: "Correction", tone: "amber" },
  mise_en_forme: { label: "Mise en forme", tone: "blue" },
};

export const PROPOSAL_DECISION: Record<ImportProposal["decision"], { label: string; tone: Tone }> =
  {
    en_attente: { label: "En attente", tone: "amber" },
    acceptee: { label: "Acceptée", tone: "green" },
    refusee: { label: "Refusée", tone: "rose" },
  };

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export function fileKind(filename: string): "DOCX" | "TXT" | "?" {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext === "docx" ? "DOCX" : ext === "txt" ? "TXT" : "?";
}

export function importState(imp: HumanImport): { label: string; tone: Tone } {
  if (imp.articleId) return { label: "Article créé", tone: "green" };
  const pending = imp.proposals.filter((p) => p.decision === "en_attente").length;
  if (pending) return { label: `${pending} à valider`, tone: "amber" };
  return { label: "Prêt à convertir", tone: "teal" };
}

/** Contrôle client avant envoi (le serveur revérifie : 413 / 415). */
export function checkImportFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc"))
    return "Format .doc non pris en charge : enregistrez le document au format .docx.";
  if (!name.endsWith(".docx") && !name.endsWith(".txt"))
    return "Format non pris en charge : seuls les fichiers DOCX et texte UTF-8 (.txt) sont acceptés (pas d'OCR).";
  if (file.size === 0) return "Le fichier est vide.";
  if (file.size > MAX_IMPORT_BYTES) return "Fichier trop volumineux : 10 Mo maximum par fichier.";
  return null;
}
