import { hash32 } from "../store/prng";

export interface WordPressDraftInput {
  idempotencyKey: string;
  remoteId: string | null;
  title: string;
  content: string;
  excerpt: string;
  categories: string[];
  tags: string[];
}

/**
 * Canal WordPress. Au pilote, seul un brouillon distant est créé ou mis à jour :
 * aucune publication publique n'est possible via cet adaptateur.
 */
export interface WordPressClient {
  readonly name: string;
  /** Vérifie l'existence d'un contenu distant déjà créé avec cette clé (reprise après ambiguïté). */
  findDraftByKey(idempotencyKey: string): string | null;
  upsertDraft(input: WordPressDraftInput): { remoteId: string; status: "draft" };
}

export class SimulatedWordPress implements WordPressClient {
  readonly name = "wordpress-simule";
  private byKey = new Map<string, string>();
  private drafts = new Map<string, WordPressDraftInput>();

  findDraftByKey(idempotencyKey: string) {
    return this.byKey.get(idempotencyKey) ?? null;
  }

  upsertDraft(input: WordPressDraftInput) {
    const existing = this.byKey.get(input.idempotencyKey);
    let remoteId = existing ?? input.remoteId;
    if (!remoteId) {
      let n = 1000 + (hash32(input.idempotencyKey) % 9000);
      while (this.drafts.has(`wp-${n}`)) n = n >= 9999 ? 1000 : n + 1;
      remoteId = `wp-${n}`;
    }
    this.drafts.set(remoteId, input);
    this.byKey.set(input.idempotencyKey, remoteId);
    return { remoteId, status: "draft" as const };
  }

  draftCount() {
    return this.drafts.size;
  }
}

/** Canal LinkedIn : l'API n'est pas disponible au pilote, la diffusion passe par l'export. */
export interface LinkedInClient {
  readonly name: string;
  readonly apiAvailable: boolean;
  readonly unavailableReason: string;
}

export class ExportOnlyLinkedIn implements LinkedInClient {
  readonly name = "linkedin-export";
  readonly apiAvailable = false;
  readonly unavailableReason =
    "API LinkedIn non disponible au pilote (accès non accordés) : contenu exporté pour publication manuelle.";
}
