/**
 * En-têtes de sécurité posés sur toute réponse du serveur (pages, API, pages d'erreur).
 * Les fichiers statiques sont servis par l'hébergeur : voir `public/_headers`.
 */

/**
 * La politique est d'abord émise en observation : le navigateur signale les écarts dans sa
 * console sans rien bloquer. Remplacer par `content-security-policy` pour l'appliquer, après
 * contrôle de l'aperçu de l'éditeur et du site publié.
 */
export const CSP_HEADER = "content-security-policy-report-only";

/** Origine Supabase appelée par le navigateur (authentification). */
function supabaseOrigin(): string | null {
  const raw = process.env["SUPABASE_URL"];
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(): string {
  const connect = ["'self'", supabaseOrigin()].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    // Les scripts d'hydratation de TanStack Start sont en ligne et sans nonce.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // L'aperçu de l'éditeur Lovable affiche l'application dans un cadre.
    "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev",
  ].join("; ");
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

/** Ajoute les en-têtes manquants sans remplacer ceux qu'une route a déjà posés. */
export function withSecurityHeaders(response: Response): Response {
  const wanted: [string, string][] = [["x-content-type-options", "nosniff"]];
  if (isHtml(response)) wanted.push([CSP_HEADER, contentSecurityPolicy()]);

  const missing = wanted.filter(([name]) => !response.headers.has(name));
  if (missing.length === 0) return response;

  try {
    for (const [name, value] of missing) response.headers.set(name, value);
    return response;
  } catch {
    // En-têtes immuables (redirection, réponse relayée d'un `fetch`) : copie de la réponse.
  }
  try {
    const headers = new Headers(response.headers);
    for (const [name, value] of missing) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}
