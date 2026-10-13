import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseAuth = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: supabaseAuth } }));

import { updatePassword } from "@/lib/auth/session";

afterEach(() => {
  vi.clearAllMocks();
});

const PASSWORD = "Un-mot-de-passe-solide-42";

describe("E1 — page « nouveau mot de passe » (invitation, réinitialisation)", () => {
  it("ferme les autres sessions du compte une fois le mot de passe enregistré", async () => {
    supabaseAuth.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    supabaseAuth.signOut.mockResolvedValue({ error: null });
    await expect(updatePassword(PASSWORD)).resolves.toEqual({ ok: true });
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(supabaseAuth.signOut).toHaveBeenCalledTimes(1);
    expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(supabaseAuth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      supabaseAuth.signOut.mock.invocationCallOrder[0]!,
    );
  });

  it("n'échoue pas si la fermeture des autres sessions échoue", async () => {
    supabaseAuth.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    supabaseAuth.signOut.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(updatePassword(PASSWORD)).resolves.toEqual({ ok: true });
  });

  it("ne ferme aucune session quand le mot de passe est refusé", async () => {
    supabaseAuth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error("refusé") });
    const result = await updatePassword(PASSWORD);
    expect(result.ok).toBe(false);
    expect(supabaseAuth.signOut).not.toHaveBeenCalled();
  });
});
