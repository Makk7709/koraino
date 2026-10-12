import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { accountError, invitationFeedback } from "@/lib/auth/accounts";
import { parseAuthCallback } from "@/lib/auth/callback";
import { passwordErrorMessage, signInErrorMessage } from "@/lib/auth/messages";

describe("messages de connexion", () => {
  it("traduit les identifiants invalides et les erreurs réseau", () => {
    expect(
      signInErrorMessage(new AuthApiError("Invalid login credentials", 400, "invalid_credentials")),
    ).toBe("E-mail ou mot de passe incorrect.");
    expect(signInErrorMessage(new AuthRetryableFetchError("Failed to fetch", 0))).toMatch(
      /injoignable/,
    );
    expect(
      signInErrorMessage(new AuthApiError("Too many", 429, "over_request_rate_limit")),
    ).toMatch(/Trop de tentatives/);
  });

  it("détaille un mot de passe trop faible", () => {
    const error = new AuthWeakPasswordError("weak", 422, ["length", "pwned"]);
    expect(passwordErrorMessage(error)).toBe(
      "Mot de passe trop faible : il est trop court ; il figure dans une fuite de données connue.",
    );
  });
});

describe("parseAuthCallback", () => {
  it("détecte un lien d'invitation", () => {
    const info = parseAuthCallback(
      "https://kora.test/connexion/nouveau-mot-de-passe#access_token=a&refresh_token=b&type=invite",
    );
    expect(info).toEqual({ type: "invite", error: null });
  });

  it("détecte un lien expiré", () => {
    const info = parseAuthCallback(
      "https://kora.test/connexion/nouveau-mot-de-passe#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(info.error).toEqual({
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
  });

  it("ignore une URL sans paramètre d'authentification", () => {
    expect(parseAuthCallback("https://kora.test/connexion")).toEqual({ type: null, error: null });
  });
});

describe("comptes", () => {
  it("donne un titre clair aux refus du serveur", () => {
    const err = accountError(
      new ApiError(422, "self_demotion", "Vous ne pouvez pas retirer votre rôle admin."),
      "Modification impossible",
    );
    expect(err).toEqual({
      title: "Votre rôle administrateur est conservé",
      message: "Vous ne pouvez pas retirer votre rôle admin.",
    });
    expect(
      accountError(new ApiError(409, "email_taken", "email_taken"), "Ajout impossible"),
    ).toEqual({
      title: "Adresse e-mail déjà utilisée",
      message: "Un utilisateur KORA utilise déjà cette adresse e-mail.",
    });
  });

  it("signale un échec d'invitation", () => {
    expect(invitationFeedback("failed", "a@b.fr", "Adresse non confirmée.")).toEqual({
      tone: "warning",
      text: "L'invitation n'a pas pu être envoyée à a@b.fr : Adresse non confirmée. Réessayez avec « Renvoyer l'invitation ».",
    });
    expect(invitationFeedback("sent", "a@b.fr").tone).toBe("success");
  });
});
