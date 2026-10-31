/** CDN Logo API : hôte fixe, paramètres bornés, aucun téléchargement. */
const DOMAIN_PATTERN =
  /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,128}$/;

export function companyLogoUrl(
  domain: string | null | undefined,
  clientId: string | null | undefined,
): string | null {
  const host = domain?.trim().toLowerCase();
  const id = clientId?.trim();
  if (!host || !DOMAIN_PATTERN.test(host) || !id || !CLIENT_ID_PATTERN.test(id)) return null;
  return `https://cdn.brandfetch.io/domain/${host}/fallback/404?c=${encodeURIComponent(id)}`;
}
