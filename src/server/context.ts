import type { User } from "@/lib/api/types";
import type { Repository } from "./store/repository";

/** Contexte d'une requête API : utilisateur courant, dépôt, horloge, paramètres. */
export interface Ctx {
  request: Request;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  repo: Repository;
  user: User;
  now: Date;
  /** Corps JSON (undefined si absent). */
  body: unknown;
  /** Corps multipart (imports). */
  form: FormData | null;
}

export type Handler = (ctx: Ctx) => Promise<Response>;
