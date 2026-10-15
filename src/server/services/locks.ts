import type { HttpError } from "../http";
import type { Repository } from "../store/repository";

const RETRY_MS = 50;

/** Couvre une génération (un appel IA borné à 30 s) et les écritures qui la suivent. */
export const GENERATION_LOCK_TTL_MS = 2 * 60_000;
/** Couvre quelques lectures et écritures en base, sans appel externe. */
export const WRITE_LOCK_TTL_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exécute `fn` sous le verrou `key` (sans transactions en base, seule protection contre deux
 * requêtes simultanées). Verrou déjà pris : `busy()` aussitôt, ou après `waitMs` de nouvelles
 * tentatives pour les sections courtes.
 */
export async function withLock<T>(
  repo: Pick<Repository, "acquireLock" | "releaseLock">,
  key: string,
  opts: { ttlMs: number; waitMs?: number; busy: () => HttpError },
  fn: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + (opts.waitMs ?? 0);
  let token = await repo.acquireLock(key, opts.ttlMs);
  while (!token && Date.now() < deadline) {
    await sleep(RETRY_MS);
    token = await repo.acquireLock(key, opts.ttlMs);
  }
  if (!token) throw opts.busy();
  try {
    return await fn();
  } finally {
    await repo.releaseLock(key, token).catch((e: unknown) => {
      console.error(`[verrou] ${key} non libéré`, e);
    });
  }
}
