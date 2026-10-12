/** Paramètres laissés dans l'URL par un lien d'invitation ou de réinitialisation Supabase. */
export interface AuthCallbackInfo {
  type: "invite" | "recovery" | "other" | null;
  /** Lien refusé par Supabase (expiré, déjà utilisé…). */
  error: { code: string; description: string } | null;
}

/** Lit la requête et le fragment, comme le client Supabase (flux implicite). */
export function parseAuthCallback(href: string): AuthCallbackInfo {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { type: null, error: null };
  }
  const params = new URLSearchParams(url.search);
  for (const [key, value] of new URLSearchParams(url.hash.replace(/^#/, ""))) {
    params.set(key, value);
  }
  const rawType = params.get("type");
  const type = rawType === "invite" || rawType === "recovery" ? rawType : rawType ? "other" : null;
  const code = params.get("error_code") ?? params.get("error");
  const description = params.get("error_description");
  return {
    type,
    error: code || description ? { code: code ?? "unknown", description: description ?? "" } : null,
  };
}
