import type { WordPressCategory, WordPressMode } from "@/lib/api/types";
import { now } from "../clock";
import { hash32 } from "../store/prng";
import { WordPressError } from "../wordpress/errors";
import { textKey } from "../wordpress/html";

/** Statuts WordPress d'un article (type `post`). */
export type RemotePostStatus = "draft" | "pending" | "future" | "publish" | "private" | "trash";

export interface RemotePost {
  /** Identifiant WordPress (chiffres) ; `wp-NNNN` en simulation. */
  id: string;
  status: RemotePostStatus;
  /** Titre brut, entités décodées. */
  title: string;
  authorId: number | null;
  /** Dates ISO 8601 (UTC). */
  dateGmt: string | null;
  modifiedGmt: string | null;
  link: string | null;
  /** Contenu brut (`content.raw`, contexte d'édition) ; null s'il n'est pas lisible. */
  content: string | null;
}

export interface WordPressAccount {
  id: number;
  name: string;
  roles: string[] | null;
  /** Droit `publish_posts` du compte ; null si WordPress ne l'indique pas. */
  canPublish: boolean | null;
}

/** Statuts non publics qu'un Contributeur peut poser : une création est toujours `draft`. */
export type DraftStatus = "draft" | "pending";

/**
 * Contenu d'un brouillon. Le statut n'en fait pas partie (voir `DraftStatus`).
 * Une liste de catégories ou d'étiquettes vide n'est pas envoyée (WordPress garde sa valeur).
 */
export interface WordPressDraftPayload {
  title: string;
  /** HTML (voir `toWordPressHtml`). */
  content: string;
  excerpt: string;
  categories: number[];
  tags: number[];
}

/**
 * Canal WordPress : KORA crée et met à jour des brouillons, jamais de publication.
 * Les méthodes asynchrones lèvent `WordPressError` (message français, sans secret).
 */
export interface WordPressClient {
  readonly name: string;
  readonly mode: WordPressMode;
  /** Origine du site en mode réel, null sinon. */
  readonly site: string | null;
  /** Variables manquantes ou invalides (noms seulement) en mode `non_configure`. */
  readonly missing: string[];
  /** L'identifiant stocké (avec le site qui l'a produit) désigne-t-il un contenu de ce site ? */
  ownsRemote(remoteId: string, site: string | null | undefined): boolean;
  /** Lien d'édition dans l'administration WordPress (null en simulation). */
  editUrl(remoteId: string): string | null;
  whoAmI(): Promise<WordPressAccount>;
  /** null si le contenu n'existe pas (ou plus). */
  getPost(remoteId: string): Promise<RemotePost | null>;
  /**
   * Brouillons et contenus en attente du compte KORA dont le contenu contient `search`, modifiés
   * pour la dernière fois entre `since` et `until`. L'appelant vérifie le contenu brut.
   */
  findOwnDrafts(search: string, since: string, until: string): Promise<RemotePost[]>;
  createDraft(input: WordPressDraftPayload): Promise<RemotePost>;
  /** `status` : celui lu juste avant (un contenu en attente de relecture y reste). */
  updateDraft(
    remoteId: string,
    input: WordPressDraftPayload,
    status?: DraftStatus,
  ): Promise<RemotePost>;
  /** Toutes les catégories du site (toutes les pages), noms décodés. */
  listCategories(): Promise<WordPressCategory[]>;
  /** Étiquettes existantes de même nom ; les autres sont rendues dans `missing`. */
  findTags(names: string[]): Promise<{ ids: number[]; missing: string[] }>;
}

/** Catégories fictives de la démonstration locale (hiérarchie à deux niveaux). */
export const SIMULATED_CATEGORIES: WordPressCategory[] = [
  { id: 1, slug: "non-classe", name: "Non classé", parent: 0 },
  { id: 2, slug: "actualites", name: "Actualités", parent: 0 },
  { id: 3, slug: "vie-des-entreprises", name: "Vie des entreprises", parent: 2 },
  { id: 4, slug: "levee-de-fonds", name: "Levée de fonds", parent: 3 },
  { id: 5, slug: "innovation", name: "Innovation", parent: 2 },
  { id: 6, slug: "emploi-recrutement", name: "Emploi & recrutement", parent: 2 },
  { id: 7, slug: "partenariats", name: "Partenariats", parent: 2 },
  { id: 8, slug: "international", name: "International", parent: 2 },
  { id: 9, slug: "evenements", name: "Événements", parent: 0 },
];

const SIMULATED_ACCOUNT: WordPressAccount = {
  id: 1,
  name: "KORA (démonstration)",
  roles: ["contributor"],
  canPublish: false,
};

const SIMULATED_ID = /^wp-\d+$/;

interface SimulatedPost extends Omit<RemotePost, "content"> {
  input: WordPressDraftPayload | null;
}

/**
 * WordPress simulé en mémoire (Vitest, démonstration locale) : identifiants `wp-NNNN`, jamais
 * réutilisés par le client réel. Un identifiant `wp-NNNN` inconnu (jeu de démonstration) est
 * traité comme un brouillon existant du compte simulé.
 */
export class SimulatedWordPress implements WordPressClient {
  readonly name = "wordpress-simule";
  readonly mode = "simule" as const;
  readonly site = null;
  readonly missing: string[] = [];
  private posts = new Map<string, SimulatedPost>();
  private removed = new Set<string>();
  private next = 5000;

  ownsRemote(remoteId: string, site: string | null | undefined) {
    return SIMULATED_ID.test(remoteId) && !site;
  }

  editUrl(_remoteId: string) {
    return null;
  }

  async whoAmI() {
    return { ...SIMULATED_ACCOUNT, roles: [...(SIMULATED_ACCOUNT.roles ?? [])] };
  }

  async getPost(remoteId: string) {
    const post = this.lookup(remoteId);
    return post ? this.view(post) : null;
  }

  async findOwnDrafts(search: string, since: string, until: string) {
    const from = Date.parse(since);
    const to = Date.parse(until);
    return [...this.posts.values()]
      .filter((p) => {
        const at = Date.parse(p.modifiedGmt ?? "");
        return (
          (p.status === "draft" || p.status === "pending") &&
          p.authorId === SIMULATED_ACCOUNT.id &&
          (p.input?.content.includes(search) ?? false) &&
          at >= from &&
          at <= to
        );
      })
      .map((p) => this.view(p));
  }

  async createDraft(input: WordPressDraftPayload) {
    let id = `wp-${++this.next}`;
    while (this.posts.has(id) || this.removed.has(id)) id = `wp-${++this.next}`;
    const at = now().toISOString();
    const post: SimulatedPost = {
      id,
      status: "draft",
      title: input.title,
      authorId: SIMULATED_ACCOUNT.id,
      dateGmt: at,
      modifiedGmt: at,
      link: null,
      input,
    };
    this.posts.set(id, post);
    return this.view(post);
  }

  async updateDraft(remoteId: string, input: WordPressDraftPayload, status: DraftStatus = "draft") {
    const post = this.lookup(remoteId);
    if (!post) {
      throw new WordPressError(
        "wordpress_invalid",
        `Le brouillon simulé ${remoteId} n'existe plus (démonstration).`,
      );
    }
    Object.assign(post, {
      status: status === "pending" ? "pending" : "draft",
      title: input.title,
      modifiedGmt: now().toISOString(),
      input,
    });
    return this.view(post);
  }

  async listCategories() {
    return SIMULATED_CATEGORIES.map((c) => ({ ...c }));
  }

  async findTags(names: string[]) {
    return { ids: names.map((n) => 1000 + (hash32(textKey(n)) % 90_000)), missing: [] };
  }

  /** Tests : statut ou auteur modifié dans WordPress, `null` = supprimé définitivement. */
  alter(remoteId: string, patch: Partial<Pick<RemotePost, "status" | "authorId">> | null) {
    if (patch === null) {
      this.posts.delete(remoteId);
      this.removed.add(remoteId);
      return;
    }
    const post = this.lookup(remoteId);
    if (post) Object.assign(post, patch);
  }

  /** Tests : contenu reçu pour un brouillon. */
  sent(remoteId: string): WordPressDraftPayload | null {
    return this.posts.get(remoteId)?.input ?? null;
  }

  draftCount() {
    return this.posts.size;
  }

  private lookup(remoteId: string): SimulatedPost | null {
    if (!SIMULATED_ID.test(remoteId) || this.removed.has(remoteId)) return null;
    let post = this.posts.get(remoteId);
    if (!post) {
      const at = now().toISOString();
      post = {
        id: remoteId,
        status: "draft",
        title: "",
        authorId: SIMULATED_ACCOUNT.id,
        dateGmt: at,
        modifiedGmt: at,
        link: null,
        input: null,
      };
      this.posts.set(remoteId, post);
    }
    return post;
  }

  private view({ input, ...post }: SimulatedPost): RemotePost {
    return { ...post, content: input?.content ?? null };
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
