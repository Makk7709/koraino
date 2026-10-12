import { decryptConnectionKey, encryptConnectionKey } from "./connectionKeyCrypto";
import { HttpError } from "./http";

/**
 * Stockage de la clé de connexion App User Connector, chiffrée, par utilisateur
 * de l'app et par connecteur. Accès serveur uniquement (service_role) — le
 * navigateur ne voit jamais la clé.
 */

/** True quand la base est utilisable (ni Vitest, ni env manquante). */
function dbAvailable(): boolean {
  return !process.env["VITEST"] && !!process.env["SUPABASE_URL"];
}

export async function saveConnectionKeyForUser(
  userId: string,
  connectorId: string,
  connectionAPIKey: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_user_connections").upsert(
    {
      user_id: userId,
      connector_id: connectorId,
      connection_key_ciphertext: encryptConnectionKey(connectionAPIKey),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id" },
  );
  if (error) throw error;
}

/**
 * Lecture ou déchiffrement impossible : surtout pas « non connecté », qui ferait basculer la
 * publication sur l'export manuel. Répondu 503 tel quel par le routeur.
 */
export class ConnectionKeyUnavailableError extends HttpError {
  constructor() {
    super(
      503,
      "linkedin_unavailable",
      "Impossible de lire votre connexion LinkedIn pour le moment : réessayez plus tard.",
    );
  }
}

/**
 * Null seulement s'il n'existe aucune connexion (toujours hors base, p. ex. Vitest) ;
 * lève `ConnectionKeyUnavailableError` si la ligne ne peut être lue ou déchiffrée.
 */
export async function getConnectionKeyForUser(
  userId: string,
  connectorId: string,
): Promise<string | null> {
  if (!dbAvailable()) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_user_connections")
      .select("connection_key_ciphertext")
      .eq("user_id", userId)
      .eq("connector_id", connectorId)
      .maybeSingle();
    if (error) throw error;
    return data ? decryptConnectionKey(data.connection_key_ciphertext) : null;
  } catch (error) {
    console.error("[app_user_connections] lecture impossible :", error);
    throw new ConnectionKeyUnavailableError();
  }
}

export async function deleteConnectionKeyForUser(
  userId: string,
  connectorId: string,
): Promise<void> {
  if (!dbAvailable()) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("app_user_connections")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
  if (error) throw error;
}
