import type { AuthConfig, AuthMode } from "@/lib/api/types";

interface CachedMode {
  mode: AuthMode;
  /** `false` : repli `demo` après un échec de `GET /api/auth/config`. */
  confirmed: boolean;
}

let cached: CachedMode | null = null;
let inflight: Promise<AuthMode> | null = null;

function isAuthMode(value: unknown): value is AuthMode {
  return value === "supabase" || value === "demo";
}

async function fetchMode(): Promise<CachedMode> {
  try {
    const res = await fetch("/api/auth/config", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { mode: "demo", confirmed: false };
    const body = (await res.json()) as Partial<AuthConfig> | null;
    return isAuthMode(body?.mode)
      ? { mode: body.mode, confirmed: true }
      : { mode: "demo", confirmed: false };
  } catch {
    return { mode: "demo", confirmed: false };
  }
}

/**
 * Mode d'authentification du serveur. En cas d'échec on considère `demo` pour l'interface
 * (le serveur reste seul garant de la sécurité) ; `refresh` relance alors la lecture.
 */
export function getAuthMode(opts: { refresh?: boolean } = {}): Promise<AuthMode> {
  if (typeof window === "undefined") return Promise.resolve("demo");
  if (cached && (cached.confirmed || !opts.refresh)) return Promise.resolve(cached.mode);
  inflight ??= fetchMode().then((result) => {
    cached = result;
    inflight = null;
    return result.mode;
  });
  return inflight;
}

/** Mode déjà connu, sans requête. */
export function peekAuthMode(): AuthMode | null {
  return cached?.mode ?? null;
}

export function setAuthModeForTests(mode: AuthMode | null): void {
  cached = mode ? { mode, confirmed: true } : null;
  inflight = null;
}
