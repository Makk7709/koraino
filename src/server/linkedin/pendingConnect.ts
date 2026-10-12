import type { Repository } from "../store/repository";

/**
 * Connexion LinkedIn en attente : ouverte par `/me/linkedin/connect`, consommée une seule fois
 * par `/me/linkedin/complete` du même utilisateur. Le dépôt n'offrant ni transaction ni
 * collection interne, l'attente est un verrou à expiration propre à la demande ; le navigateur
 * reçoit un état opaque (identifiant de la demande + jeton du verrou) qu'il rend à `/complete`.
 */

/** Délai laissé pour le consentement dans le popup LinkedIn. */
export const PENDING_CONNECT_TTL_MS = 10 * 60_000;
/** Sérialise les finalisations d'un utilisateur : deux `/complete` simultanés ne consomment pas la même attente. */
const CONSUME_LOCK_TTL_MS = 15_000;
/** Sondes de présence : relâchées aussitôt, expirent seules si la libération échoue. */
const PROBE_TTL_MS = 5_000;

const STATE_FORMAT = /^([\w-]{1,64})\.([\w-]{1,64})$/;

const pendingKey = (userId: string, requestId: string) => `linkedin-connect:${userId}:${requestId}`;

export async function openPendingConnect(repo: Repository, userId: string): Promise<string> {
  const requestId = crypto.randomUUID();
  const token = await repo.acquireLock(pendingKey(userId, requestId), PENDING_CONNECT_TTL_MS);
  if (!token) throw new Error("Connexion LinkedIn en attente impossible à enregistrer.");
  return `${requestId}.${token}`;
}

/**
 * Vrai si l'attente existait pour CET utilisateur, n'avait pas expiré et portait ce jeton ;
 * elle est alors supprimée. `releaseLock` ne dit pas s'il a supprimé quelque chose : une
 * acquisition réussie avant prouve l'absence, une acquisition réussie après prouve la suppression.
 */
export async function consumePendingConnect(
  repo: Repository,
  userId: string,
  state: string,
): Promise<boolean> {
  const match = STATE_FORMAT.exec(state);
  const requestId = match?.[1];
  const token = match?.[2];
  if (!requestId || !token) return false;
  const consumeKey = `linkedin-connect-consume:${userId}`;
  const guard = await repo.acquireLock(consumeKey, CONSUME_LOCK_TTL_MS);
  if (!guard) return false;
  try {
    const key = pendingKey(userId, requestId);
    const absent = await repo.acquireLock(key, PROBE_TTL_MS);
    if (absent) {
      await repo.releaseLock(key, absent);
      return false;
    }
    await repo.releaseLock(key, token);
    const released = await repo.acquireLock(key, PROBE_TTL_MS);
    if (!released) return false;
    await repo.releaseLock(key, released);
    return true;
  } finally {
    await repo.releaseLock(consumeKey, guard).catch((e: unknown) => {
      console.error(`[linkedin] verrou ${consumeKey} non libéré`, e);
    });
  }
}
