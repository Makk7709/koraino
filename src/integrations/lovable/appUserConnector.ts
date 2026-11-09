/**
 * App User Connector helpers.
 *
 * Server-only. Read by TanStack Start server functions (`createServerFn`)
 * to start per-user OAuth and to make authenticated provider calls on
 * behalf of the end user that completed the OAuth flow.
 *
 * Never import this from a browser bundle — these functions read
 * server-side secrets from `process.env` and call the connector gateway
 * directly. Exposing them to the browser leaks credentials for
 * every app user in the workspace.
 *
 * The gateway base URL is passed in by the caller (Lovable's connector
 * knowledge files render the correct URL for the current environment).
 * One value works for both endpoints: the connector gateway's ingress
 * exposes the OAuth endpoints under `/api/*` and the proxy under the
 * connector-id path, with environment-specific path stripping handled
 * by the upstream router.
 */

function requireApiKey(): string {
  const key = process.env['LOVABLE_API_KEY'];
  if (!key) {
    throw new Error(
      "LOVABLE_API_KEY is not set. App User Connector calls require a server-side workspace token.",
    );
  }
  return key;
}

export interface AppUserOAuthAuthorizeParams {
  gatewayBaseUrl: string;
  connectorId: string;
  appUserId: string;
  clientAPIKey: string;
  returnUrl: string;
  credentialsConfiguration?: Record<string, unknown>;
  /** Reconnect: pass the stored lovack_* key so the gateway confirms ownership. */
  connectionAPIKey?: string;
}

export interface AppUserOAuthAuthorizeResponse {
  authorizationUrl: string;
  sessionId: string;
}

export async function authorizeAppUserOAuth(
  params: AppUserOAuthAuthorizeParams,
): Promise<AppUserOAuthAuthorizeResponse> {
  const bearer = requireApiKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    "X-Client-Api-Key": params.clientAPIKey,
  };
  if (params.connectionAPIKey) {
    headers["X-Connection-Api-Key"] = params.connectionAPIKey;
  }
  const res = await fetch(`${params.gatewayBaseUrl}/api/v1/app-users/oauth2/authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      connector_id: params.connectorId,
      app_user_id: params.appUserId,
      return_url: params.returnUrl,
      credentials_configuration: params.credentialsConfiguration,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`App User OAuth start failed (${res.status}): ${text || res.statusText}`);
  }

  let body: { authorization_url?: string; session_id?: string };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`App User OAuth start returned invalid JSON: ${text.slice(0, 200)}`);
  }
  if (!body.authorization_url) {
    throw new Error("App User OAuth start response missing authorization_url");
  }
  return {
    authorizationUrl: body.authorization_url,
    sessionId: body.session_id ?? "",
  };
}
export interface CallAsAppUserParams {
  gatewayBaseUrl: string;
  connectionAPIKey: string;
  connectorId: string;
  /** Path under the connector, e.g. "/v2/userinfo". Leading slash optional. */
  path: string;
  init?: RequestInit;
  /** Scopes this call needs (names without spaces or commas, at most 64); a grant missing one is answered 401 credential_scopes_stale instead of reaching the provider. */
  requiredScopes?: string[];
}

export async function callAsAppUser({
  gatewayBaseUrl,
  connectionAPIKey,
  connectorId,
  path,
  init,
  requiredScopes,
}: CallAsAppUserParams): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${requireApiKey()}`);
  headers.set("X-Connection-Api-Key", connectionAPIKey);
  if (requiredScopes?.length) {
    headers.set("X-Lovable-Required-Scopes", requiredScopes.join(" "));
  }
  return fetch(`${gatewayBaseUrl}/${connectorId}${normalizedPath}`, {
    ...init,
    headers,
  });
}

/**
 * A gateway 401 whose body type starts with "credential_" means this user's
 * connection must be re-authorized. No other 401 is a reconnect.
 */
export async function appUserReconnectRequired(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = (await res.clone().json().catch(() => null)) as { type?: unknown } | null;
  return typeof body?.type === "string" && body.type.startsWith("credential_");
}
export interface DisconnectAppUserParams {
  gatewayBaseUrl: string;
  connectionAPIKey: string;
  connectorId: string;
}

export async function disconnectAppUser({
  gatewayBaseUrl,
  connectionAPIKey,
  connectorId,
}: DisconnectAppUserParams): Promise<void> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${requireApiKey()}`);
  headers.set("X-Connection-Api-Key", connectionAPIKey);
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/connection`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ connector_id: connectorId }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`App User disconnect failed (${res.status}): ${text || res.statusText}`);
  }
}

export interface ExchangeAppUserOAuthCodeResult {
  connectionAPIKey: string;
  connectorId: string;
}

/**
 * Swap the one-time `code` from a redirect landing page for the per-user
 * connection key (`lovack_*`). Server-only — it authenticates the redeem
 * call to the gateway with a server-side secret. Call it from a createServerFn
 * handler, then persist the returned connectionAPIKey server-side against the
 * signed-in app user. The code is single-use and short-lived, so exchange it as
 * soon as the redirect lands.
 */
export async function exchangeAppUserOAuthCode(
  gatewayBaseUrl: string,
  code: string,
): Promise<ExchangeAppUserOAuthCodeResult> {
  const bearer = requireApiKey();
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/oauth2/exchange`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`App User OAuth exchange failed (${res.status}): ${text || res.statusText}`);
  }

  let body: { api_key?: string; connector_id?: string };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`App User OAuth exchange returned invalid JSON: ${text.slice(0, 200)}`);
  }
  if (!body.api_key) {
    throw new Error("App User OAuth exchange response missing api_key");
  }
  if (!body.connector_id) {
    throw new Error("App User OAuth exchange response missing connector_id");
  }
  return { connectionAPIKey: body.api_key, connectorId: body.connector_id };
}
