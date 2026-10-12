/**
 * Vrai quand la persistance passe par la base du projet (production) : jamais sous Vitest,
 * ni en développement local sans `SUPABASE_URL`. Décide aussi du mode d'authentification.
 */
export function usesDatabase(): boolean {
  return !process.env["VITEST"] && !!process.env["SUPABASE_URL"];
}
