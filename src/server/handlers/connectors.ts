import type { LinkedInConnectStart } from "@/lib/api/types";
import type { Handler } from "../context";
import { badRequest, conflict, json } from "../http";
import { consumePendingConnect, openPendingConnect } from "../linkedin/pendingConnect";
import { audit } from "../services/journal";
import {
  appUserReconnectRequired,
  authorizeAppUserOAuth,
  callAsAppUser,
  disconnectAppUser,
  exchangeAppUserOAuthCode,
} from "@/integrations/lovable/appUserConnector";
import {
  deleteConnectionKeyForUser,
  getConnectionKeyForUser,
  saveConnectionKeyForUser,
} from "../appUserConnections.server";
import { publicOrigin } from "../publicUrl";

/**
 * Connecteurs « par utilisateur » : chaque utilisateur de l'app relie son
 * propre compte LinkedIn (App User Connector via la passerelle Lovable).
 * La clé de connexion (lovack_*) reste côté serveur, chiffrée en base ;
 * le navigateur ne reçoit que des informations d'affichage.
 */

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
export const LINKEDIN_CONNECTOR_ID = "linkedin";
/** openid + profile : identité du membre ; w_member_social : publier des posts. */
export const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"];

function clientApiKey(): string {
  const key = process.env['LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY'];
  if (!key) {
    throw new Error("LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");
  }
  return key;
}

/** Statut de la connexion LinkedIn de l'utilisateur courant. */
export const getLinkedInConnection: Handler = async (ctx) => {
  const key = await getConnectionKeyForUser(ctx.user.id, LINKEDIN_CONNECTOR_ID);
  if (!key) return json({ connected: false });

  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: key,
    connectorId: LINKEDIN_CONNECTOR_ID,
    path: "/v2/userinfo",
    requiredScopes: LINKEDIN_SCOPES,
  });
  if (await appUserReconnectRequired(res)) {
    return json({ connected: false, reconnectRequired: true });
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`LinkedIn userinfo failed [${res.status}]: ${body}`);
    return json({ connected: false, error: "linkedin_unavailable" });
  }
  const profile = (await res.json()) as { name?: string; sub?: string };
  return json({
    connected: true,
    name: profile.name ?? null,
    memberId: profile.sub ?? null,
  });
};

/** Démarre le consentement OAuth LinkedIn (popup) et renvoie l'URL d'autorisation. */
export const startLinkedInConnect: Handler = async (ctx) => {
  const returnUrl = new URL(
    "/api/oauth/linkedin/return",
    publicOrigin(ctx),
  ).toString();
  const existing = await getConnectionKeyForUser(ctx.user.id, LINKEDIN_CONNECTOR_ID);
  const { authorizationUrl } = await authorizeAppUserOAuth({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectorId: LINKEDIN_CONNECTOR_ID,
    appUserId: ctx.user.id,
    clientAPIKey: clientApiKey(),
    returnUrl,
    ...(existing ? { connectionAPIKey: existing } : {}),
    credentialsConfiguration: { scopes: LINKEDIN_SCOPES },
  });
  const state = await openPendingConnect(ctx.repo, ctx.user.id);
  return json({ authorizationUrl, state } satisfies LinkedInConnectStart);
};

/**
 * Échange le code à usage unique contre la clé de connexion, puis la stocke chiffrée.
 * Exige la connexion en attente ouverte par CET utilisateur (`state`), consommée ici.
 */
export const completeLinkedInConnection: Handler = async (ctx) => {
  const body = ctx.body as { code?: unknown; state?: unknown } | undefined;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code) throw badRequest("missing_code", "Code OAuth manquant.");
  const state = typeof body?.state === "string" ? body.state : "";
  if (!(await consumePendingConnect(ctx.repo, ctx.user.id, state))) {
    throw conflict(
      "linkedin_connect_not_pending",
      "Aucune connexion LinkedIn n'est en attente pour votre compte (demande expirée ou déjà utilisée) : relancez « Connecter mon compte LinkedIn ».",
    );
  }
  const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
    GATEWAY_BASE_URL,
    code,
  );
  if (connectorId !== LINKEDIN_CONNECTOR_ID) {
    throw badRequest("connector_mismatch", "Le retour OAuth ne correspond pas à LinkedIn.");
  }
  await saveConnectionKeyForUser(ctx.user.id, LINKEDIN_CONNECTOR_ID, connectionAPIKey);
  await audit(ctx, "linkedin.connect", "user", ctx.user.id, "Compte LinkedIn connecté");
  return json({ ok: true });
};

/** Révocation côté LinkedIn, puis suppression de la clé stockée. */
export const disconnectLinkedIn: Handler = async (ctx) => {
  const key = await getConnectionKeyForUser(ctx.user.id, LINKEDIN_CONNECTOR_ID);
  if (key) {
    await disconnectAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: key,
      connectorId: LINKEDIN_CONNECTOR_ID,
    });
  }
  await deleteConnectionKeyForUser(ctx.user.id, LINKEDIN_CONNECTOR_ID);
  await audit(ctx, "linkedin.disconnect", "user", ctx.user.id, "Compte LinkedIn déconnecté");
  return json({ ok: true });
};
