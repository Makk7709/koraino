/**
 * « Share on LinkedIn » (produit self-serve, scope w_member_social) :
 * POST /v2/ugcPosts, texte brut dans shareCommentary.text.
 * https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 *
 * Fonctions pures : aucune I/O ici.
 */

export const USERINFO_PATH = "/v2/userinfo";
export const UGC_POSTS_PATH = "/v2/ugcPosts";

/** Scopes vérifiés par la passerelle avant chaque appel (401 credential_scopes_stale sinon). */
export const USERINFO_SCOPES = ["openid", "profile"];
export const PUBLISH_SCOPES = ["w_member_social"];

/** Limite documentée de shareCommentary.text (UGC Post API). */
export const MAX_COMMENTARY_LENGTH = 3000;

export const UGC_POST_HEADERS = {
  "Content-Type": "application/json",
  "X-Restli-Protocol-Version": "2.0.0",
} as const;

export interface UgcPostBody {
  author: string;
  lifecycleState: "PUBLISHED";
  specificContent: {
    "com.linkedin.ugc.ShareContent": {
      shareCommentary: { text: string };
      shareMediaCategory: "NONE";
    };
  };
  visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" };
}

/**
 * Texte envoyé tel quel : contrairement au format « little » de /rest/posts,
 * shareCommentary.text n'interprète ni ( ) ni [ ] ni @, donc aucun échappement.
 */
export function prepareCommentary(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

/** Message d'erreur si le texte (déjà préparé) ne peut pas être publié, sinon null. */
export function validateCommentary(text: string): string | null {
  if (!text) return "Le texte du post est vide : rien à publier sur LinkedIn.";
  // LinkedIn compte en unités UTF-16 (String Java), comme `length` en JavaScript.
  if (text.length > MAX_COMMENTARY_LENGTH) {
    return `Le post fait ${text.length.toLocaleString("fr-FR")} caractères : LinkedIn en accepte ${MAX_COMMENTARY_LENGTH.toLocaleString("fr-FR")} au maximum. Raccourcissez la variante ou retirez des hashtags.`;
  }
  return null;
}

/** `sub` OpenID Connect : identifiant opaque du membre, base de son URN urn:li:person. */
export function isMemberId(sub: unknown): sub is string {
  return typeof sub === "string" && /^[A-Za-z0-9_-]+$/.test(sub);
}

export function buildUgcPostBody(memberId: string, text: string): UgcPostBody {
  return {
    author: `urn:li:person:${memberId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };
}

function decodeId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Identifiant du post créé : en-tête x-restli-id (documenté), sinon champ `id` du corps. */
export function readPostId(headers: Headers, bodyText: string): string | null {
  const header = headers.get("x-restli-id")?.trim();
  if (header) return decodeId(header);
  try {
    const body = JSON.parse(bodyText) as { id?: unknown } | null;
    if (typeof body?.id === "string" && body.id.trim()) return body.id.trim();
  } catch {
    // corps vide ou non JSON
  }
  return null;
}

const FEED_URN = /^urn:li:(?:share|ugcPost|activity):\d+$/;

export function postUrl(urn: string): string | null {
  return FEED_URN.test(urn) ? `https://www.linkedin.com/feed/update/${urn}` : null;
}
