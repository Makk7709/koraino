import type { AuthMode } from "@/lib/api/types";
import { usesDatabase } from "../database";

export type { AuthMode };

let override: AuthMode | null = null;

/**
 * `supabase` exactement quand le dépôt est en base (production) ; `demo` sous Vitest ou en
 * développement local sans base (cookie `kora_uid`, profil par défaut).
 */
export function authMode(): AuthMode {
  if (override) return override;
  return usesDatabase() ? "supabase" : "demo";
}

export function setAuthModeForTests(mode: AuthMode | null): void {
  override = mode;
}
