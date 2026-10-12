import type { AuthMode } from "@/lib/api/types";

export type { AuthMode };

let override: AuthMode | null = null;

/**
 * `supabase` exactement quand le dépôt est en base (production) ; `demo` sous Vitest ou en
 * développement local sans base (cookie `kora_uid`, profil par défaut).
 */
export function authMode(): AuthMode {
  if (override) return override;
  return !process.env["VITEST"] && process.env["SUPABASE_URL"] ? "supabase" : "demo";
}

export function setAuthModeForTests(mode: AuthMode | null): void {
  override = mode;
}
