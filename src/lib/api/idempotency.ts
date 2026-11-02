/**
 * Stable client intent for a pending paid HTTP request.
 * Never persist the payload itself: the storage key is its SHA-256 digest.
 * A lost HTTP response retains the operation key for a deliberate retry.
 * An acknowledged 2xx clears it, permitting a new explicit business intent.
 */
const protectedRoutes = [
  /^\/articles$/,
  /^\/linkedin$/,
  /^\/collect$/,
  /^\/sources\/[^/]+\/collect$/,
  /^\/signals\/[^/]+\/split$/,
  /^\/newsletters\/[^/]+\/items$/,
];

export async function paidRequestIdentity(
  path: string,
  init: RequestInit,
): Promise<{ key: string; clear: () => void } | null> {
  if (init.method?.toUpperCase() !== "POST" || !protectedRoutes.some((r) => r.test(path))) {
    return null;
  }
  if (typeof window === "undefined" || !globalThis.crypto?.subtle) {
    throw new Error("Idempotence indisponible : contexte navigateur sécurisé requis.");
  }
  const raw = JSON.stringify({ path, body: typeof init.body === "string" ? init.body : null });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const digest = Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
  const storageName = `kora-paid-intent:v1:${digest}`;
  let key: string;
  try {
    const existing = window.sessionStorage.getItem(storageName);
    key = existing ?? crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem(storageName, key);
  } catch {
    // Refuse rather than silently lose retry identity on a potentially charged operation.
    throw new Error("Stockage de la clé d'idempotence indisponible : opération non envoyée.");
  }
  return {
    key,
    clear: () => {
      try {
        if (window.sessionStorage.getItem(storageName) === key) {
          window.sessionStorage.removeItem(storageName);
        }
      } catch {
        // A confirmed successful result remains valid; no network retry is triggered here.
      }
    },
  };
}
