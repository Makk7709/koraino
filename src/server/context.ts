import type { Repository } from "./store/repository";
import type { UserRecord } from "./store/records";

/** Contexte d'une requête API : utilisateur courant, dépôt, horloge, paramètres. */
export interface Ctx {
  request: Request;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  repo: Repository;
  /** Enregistrement interne : passer par `toPublicUser` avant de le renvoyer. */
  user: UserRecord;
  now: Date;
  /** Durable HTTP intent ID, set only by the idempotency middleware. */
  httpOperationId?: string;
  /** Corps JSON (undefined si absent). */
  body: unknown;
  /** Corps multipart (imports). */
  form: FormData | null;
}

export type Handler = (ctx: Ctx) => Promise<Response>;

/** Routes publiques (/auth/*) : aucun utilisateur n'est résolu d'office. */
export type PublicCtx = Omit<Ctx, "user">;

export type PublicHandler = (ctx: PublicCtx) => Promise<Response>;
