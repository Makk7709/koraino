/**
 * Origine publique de l'application (liens d'invitation, retour OAuth) : `KORA_PUBLIC_URL`
 * si elle est définie, sinon l'origine de la requête. Les en-têtes `x-forwarded-*` sont
 * ignorés : n'importe quel client peut les fournir.
 */
export function publicOrigin(ctx: { request: Request }): string {
  const configured = process.env["KORA_PUBLIC_URL"]?.trim();
  if (!configured) return new URL(ctx.request.url).origin;
  let url: URL | null = null;
  try {
    url = new URL(configured);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error(
      "KORA_PUBLIC_URL doit être une URL absolue http(s), par exemple https://kora.example.org",
    );
  }
  return url.origin;
}
