import { callAsAppUser, type CallAsAppUserParams } from "@/integrations/lovable/appUserConnector";
import { GATEWAY_BASE_URL, LINKEDIN_CONNECTOR_ID } from "../handlers/connectors";
import {
  excerpt,
  mapFailure,
  missingMemberId,
  networkFailure,
  unreadableResponse,
  type LinkedInFailure,
  type LinkedInStep,
} from "./errors";
import {
  buildUgcPostBody,
  isMemberId,
  postUrl,
  prepareCommentary,
  PUBLISH_SCOPES,
  readPostId,
  UGC_POST_HEADERS,
  UGC_POSTS_PATH,
  USERINFO_PATH,
  USERINFO_SCOPES,
  validateCommentary,
} from "./ugcPost";

export type LinkedInPostOutcome =
  LinkedInFailure | { kind: "published"; remoteId: string; url?: string };

export interface PublishDeps {
  callAsAppUser?: (params: CallAsAppUserParams) => Promise<Response>;
  /** Journal serveur (console.error par défaut). */
  log?: (line: string) => void;
}

const TIMEOUT_MS: Record<LinkedInStep, number> = { identification: 10_000, publication: 20_000 };

function redact(text: string, connectionKey: string): string {
  const masked = connectionKey ? text.split(connectionKey).join("[clé masquée]") : text;
  return masked
    .replace(/lovack_[\w-]+/g, "lovack_[masqué]")
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [masqué]");
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Publie `text` (texte brut : variante + hashtags) sur le compte LinkedIn relié à
 * `connectionKey` : identité via /v2/userinfo, puis POST /v2/ugcPosts.
 * Ne lève pas : tout échec est traduit en résultat avec un message en français.
 */
export async function publishWithConnectionKey(
  connectionKey: string,
  text: string,
  deps: PublishDeps = {},
): Promise<LinkedInPostOutcome> {
  const call = deps.callAsAppUser ?? callAsAppUser;
  const log = deps.log ?? ((line: string) => console.error(line));

  const commentary = prepareCommentary(text);
  const invalid = validateCommentary(commentary);
  if (invalid) return { kind: "api_error", message: invalid };

  async function send(
    step: LinkedInStep,
    path: string,
    requiredScopes: string[],
    init: RequestInit,
  ): Promise<{ res: Response; body: string } | { failure: LinkedInFailure }> {
    const where = `[linkedin] ${step} ${init.method ?? "GET"} ${path}`;
    let res: Response;
    let body: string;
    try {
      res = await call({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: connectionKey,
        connectorId: LINKEDIN_CONNECTOR_ID,
        path,
        requiredScopes,
        init: { ...init, signal: AbortSignal.timeout(TIMEOUT_MS[step]) },
      });
      body = redact(await res.text(), connectionKey);
    } catch (error) {
      log(redact(`${where} : échec réseau (${describe(error)})`, connectionKey));
      return { failure: networkFailure(step) };
    }
    if (!res.ok) {
      log(`${where} → HTTP ${res.status} : ${excerpt(body) || "(corps vide)"}`);
      return { failure: mapFailure(step, res.status, body, res.headers) };
    }
    return { res, body };
  }

  const me = await send("identification", USERINFO_PATH, USERINFO_SCOPES, { method: "GET" });
  if ("failure" in me) return me.failure;
  let profile: unknown;
  try {
    profile = JSON.parse(me.body);
  } catch {
    log(`[linkedin] identification → HTTP ${me.res.status} illisible : ${excerpt(me.body)}`);
    return unreadableResponse("identification", me.res.status);
  }
  const sub = profile && typeof profile === "object" ? (profile as { sub?: unknown }).sub : null;
  if (!isMemberId(sub)) {
    log(`[linkedin] identification → HTTP ${me.res.status} sans « sub » exploitable`);
    return missingMemberId();
  }

  const post = await send("publication", UGC_POSTS_PATH, PUBLISH_SCOPES, {
    method: "POST",
    headers: { ...UGC_POST_HEADERS },
    body: JSON.stringify(buildUgcPostBody(sub, commentary)),
  });
  if ("failure" in post) return post.failure;
  const remoteId = readPostId(post.res.headers, post.body);
  if (!remoteId) {
    log(
      `[linkedin] publication → HTTP ${post.res.status} sans identifiant de post : ${excerpt(post.body) || "(corps vide)"}`,
    );
    return unreadableResponse("publication", post.res.status);
  }
  const url = postUrl(remoteId);
  return url ? { kind: "published", remoteId, url } : { kind: "published", remoteId };
}
