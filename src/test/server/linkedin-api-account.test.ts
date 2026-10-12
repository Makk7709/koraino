import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import { getConnectionKeyForUser } from "@/server/appUserConnections.server";
import { publishViaUserAccount } from "@/server/handlers/distribution";

vi.mock("@/server/appUserConnections.server", () => ({
  getConnectionKeyForUser: vi.fn(),
  saveConnectionKeyForUser: vi.fn(),
  deleteConnectionKeyForUser: vi.fn(),
}));

vi.mock("@/integrations/lovable/appUserConnector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/lovable/appUserConnector")>()),
  callAsAppUser: vi.fn(),
}));

const KEY = "lovack_user_key_456";

beforeEach(() => {
  vi.mocked(getConnectionKeyForUser).mockReset();
  vi.mocked(callAsAppUser).mockReset();
  vi.stubGlobal("fetch", () => {
    throw new Error("aucun appel réseau réel dans les tests");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("publishViaUserAccount", () => {
  it("sans clé stockée : not_connected, sans appel à LinkedIn", async () => {
    vi.mocked(getConnectionKeyForUser).mockResolvedValue(null);
    expect(await publishViaUserAccount("u_lucas", "Bonjour Grenoble !")).toEqual({
      kind: "not_connected",
    });
    expect(getConnectionKeyForUser).toHaveBeenCalledWith("u_lucas", "linkedin");
    expect(callAsAppUser).not.toHaveBeenCalled();
  });

  it("sans clé, not_connected prime sur la validation du texte (repli sur l'export)", async () => {
    vi.mocked(getConnectionKeyForUser).mockResolvedValue(null);
    expect(await publishViaUserAccount("u_lucas", "x".repeat(5000))).toEqual({
      kind: "not_connected",
    });
  });

  it("avec clé : publie avec la clé de l'utilisateur", async () => {
    vi.mocked(getConnectionKeyForUser).mockResolvedValue(KEY);
    vi.mocked(callAsAppUser)
      .mockResolvedValueOnce(Response.json({ sub: "782bbtaQ" }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:7383000000000000001" },
        }),
      );
    expect(
      await publishViaUserAccount("u_claire", "Bonjour Grenoble !\n\n#Innovation #Inovallée"),
    ).toEqual({
      kind: "published",
      remoteId: "urn:li:share:7383000000000000001",
      url: "https://www.linkedin.com/feed/update/urn:li:share:7383000000000000001",
    });
    expect(getConnectionKeyForUser).toHaveBeenCalledWith("u_claire", "linkedin");
    const calls = vi.mocked(callAsAppUser).mock.calls.map(([params]) => params);
    expect(calls.map((c) => [c.path, c.connectionAPIKey])).toEqual([
      ["/v2/userinfo", KEY],
      ["/v2/ugcPosts", KEY],
    ]);
  });

  it("avec clé mais autorisation expirée : reconnect_required", async () => {
    vi.mocked(getConnectionKeyForUser).mockResolvedValue(KEY);
    vi.mocked(callAsAppUser).mockResolvedValueOnce(
      Response.json({ type: "credential_refresh_token_expired" }, { status: 401 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await publishViaUserAccount("u_claire", "Bonjour")).toMatchObject({
      kind: "reconnect_required",
    });
  });
});
