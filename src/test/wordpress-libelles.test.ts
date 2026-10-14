import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));

import {
  WORDPRESS_NOT_CONFIGURED,
  hasRemoteDraft,
  isRemoteLocked,
  safeHttpUrl,
  verificationCandidates,
  wordpressActionLabel,
  wordpressErrorView,
  wordpressSendState,
} from "@/components/articles/wordpress";
import { wordpressDraftBadge } from "@/components/dashboard/dashboard-style";
import { WORDPRESS_MODE, WORDPRESS_STATUS } from "@/components/kora/labels";
import {
  NO_CATEGORY,
  buildWordPressSettings,
  categoryOptions,
  checkVerdict,
  decodeSlug,
  initialMapping,
  sameSettings,
  setupVariables,
  wordpressRoleLabel,
} from "@/components/parametres/wordpress";
import { ApiError } from "@/lib/api/client";
import type { WordPressRemoteStatus } from "@/lib/api/types";

const ALL_STATUSES: WordPressRemoteStatus[] = [
  "aucun",
  "brouillon",
  "en_attente",
  "programme",
  "publie",
  "supprime",
];

describe("libellés des statuts WordPress", () => {
  it("couvre les six statuts avec les libellés du contrat", () => {
    expect(Object.keys(WORDPRESS_STATUS).sort()).toEqual([...ALL_STATUSES].sort());
    expect(WORDPRESS_STATUS.brouillon.label).toBe("Brouillon WordPress");
    expect(WORDPRESS_STATUS.en_attente.label).toBe("En attente de relecture");
    expect(WORDPRESS_STATUS.supprime.label).toBe("Supprimé sur WordPress");
    expect(WORDPRESS_STATUS.programme.label).toMatch(/programmé/i);
    expect(WORDPRESS_STATUS.publie.label).toMatch(/publié/i);
    for (const s of ALL_STATUSES) expect(WORDPRESS_STATUS[s].hint).not.toBe("");
  });

  it("nomme les trois modes de configuration", () => {
    expect(WORDPRESS_MODE.reel.label).toBe("Site configuré");
    expect(WORDPRESS_MODE.simule.label).toBe("Mode démonstration");
    expect(WORDPRESS_MODE.non_configure.label).toBe("Non configuré");
  });
});

describe("bouton d'envoi WordPress", () => {
  const status = (mode: "reel" | "simule" | "non_configure") => ({ mode });

  it("est désactivé avec l'explication du contrat quand WordPress n'est pas configuré", () => {
    const state = wordpressSendState(status("non_configure"), null);
    expect(state).toEqual({
      disabledReason: WORDPRESS_NOT_CONFIGURED,
      notConfigured: true,
      demo: false,
    });
    expect(WORDPRESS_NOT_CONFIGURED).toBe(
      "WordPress n'est pas configuré : voir Paramètres > WordPress.",
    );
  });

  it("la configuration absente l'emporte sur les autres raisons", () => {
    const state = wordpressSendState(status("non_configure"), "Approbation valide requise.");
    expect(state.disabledReason).toBe(WORDPRESS_NOT_CONFIGURED);
  });

  it("reprend la raison du canal sinon, et signale le mode démonstration", () => {
    expect(wordpressSendState(status("reel"), null)).toEqual({
      disabledReason: null,
      notConfigured: false,
      demo: false,
    });
    expect(wordpressSendState(status("simule"), "Réservé aux validateurs.")).toEqual({
      disabledReason: "Réservé aux validateurs.",
      notConfigured: false,
      demo: true,
    });
  });

  it("ne bloque rien tant que le statut n'est pas connu (chargement, erreur, ancien serveur)", () => {
    expect(wordpressSendState(undefined, null).disabledReason).toBeNull();
    expect(wordpressSendState(undefined, "Raison du canal").disabledReason).toBe("Raison du canal");
  });

  it("adapte son libellé à l'état distant", () => {
    expect(wordpressActionLabel({ remoteId: null, status: "aucun" })).toBe(
      "Créer le brouillon WordPress",
    );
    expect(wordpressActionLabel({ remoteId: "12", status: "brouillon" })).toBe(
      "Mettre à jour le brouillon WordPress",
    );
    expect(wordpressActionLabel({ remoteId: "12", status: "en_attente" })).toBe(
      "Mettre à jour le brouillon WordPress",
    );
    expect(wordpressActionLabel({ remoteId: "12", status: "supprime" })).toBe(
      "Recréer le brouillon WordPress",
    );
    expect(wordpressActionLabel({ remoteId: "12", status: "publie" })).toBe("Envoyer à WordPress");
  });
});

describe("état du brouillon distant", () => {
  it("n'offre l'actualisation que s'il existe un brouillon", () => {
    const withId = (status: WordPressRemoteStatus) => hasRemoteDraft({ remoteId: "42", status });
    expect(ALL_STATUSES.filter(withId)).toEqual(["brouillon", "en_attente", "programme", "publie"]);
    expect(hasRemoteDraft({ remoteId: null, status: "brouillon" })).toBe(false);
  });

  it("considère publié et programmé comme verrouillés côté WordPress", () => {
    const locked = ALL_STATUSES.filter((status) => isRemoteLocked({ remoteId: "42", status }));
    expect(locked).toEqual(["programme", "publie"]);
  });
});

describe("refus de l'API pour WordPress", () => {
  const err = (code: string, details?: unknown) => new ApiError(409, code, "Message", details);

  it("donne un titre clair aux cas du contrat", () => {
    expect(wordpressErrorView(err("wordpress_remote_published"))).toMatchObject({
      code: "wordpress_remote_published",
      tone: "warning",
      title: expect.stringMatching(/déjà en ligne ou programmé.*dans WordPress/),
    });
    expect(wordpressErrorView(err("publication_verification_required")).tone).toBe("warning");
    expect(wordpressErrorView(err("publication_in_progress")).tone).toBe("info");
    expect(wordpressErrorView(err("wordpress_unavailable")).tone).toBe("danger");
  });

  it("garde le titre générique pour les autres refus", () => {
    expect(wordpressErrorView(err("approval_required"))).toEqual({
      code: "approval_required",
      tone: "danger",
      title: "Envoi bloqué par l'API",
    });
    expect(wordpressErrorView(new Error("réseau"))).toMatchObject({ code: null, tone: "danger" });
  });
});

describe("brouillons candidats d'une reprise", () => {
  it("lit une liste directe ou rangée sous candidates / drafts / posts", () => {
    const item = { id: 12, title: "Levée de fonds", date: "2026-10-14T08:00:00Z" };
    expect(verificationCandidates([item])).toHaveLength(1);
    expect(verificationCandidates({ candidates: [item] })).toHaveLength(1);
    expect(verificationCandidates({ drafts: [item] })).toHaveLength(1);
    expect(verificationCandidates({ posts: [item] })).toHaveLength(1);
  });

  it("normalise identifiant, titre, date et lien d'édition", () => {
    const [a, b] = verificationCandidates({
      candidates: [
        {
          id: 12,
          title: "Levée de fonds",
          modifiedGmt: "2026-10-14T08:00:00",
          editUrl: "https://site.test/wp-admin/post.php?post=12&action=edit",
        },
        { remoteId: "13", titre: "Autre", link: "https://site.test/?p=13" },
      ],
    });
    expect(a).toEqual({
      id: "12",
      title: "Levée de fonds",
      date: "2026-10-14T08:00:00Z",
      editUrl: "https://site.test/wp-admin/post.php?post=12&action=edit",
    });
    expect(b).toEqual({ id: "13", title: "Autre", date: null, editUrl: "https://site.test/?p=13" });
  });

  it("écarte les entrées sans identifiant, les dates illisibles et les liens non http(s)", () => {
    const list = verificationCandidates([
      { title: "Sans id" },
      "texte",
      null,
      { id: 7, date: "pas une date", editUrl: "javascript:alert(1)" },
    ]);
    expect(list).toEqual([{ id: "7", title: "", date: null, editUrl: null }]);
    expect(verificationCandidates(undefined)).toEqual([]);
    expect(verificationCandidates({ message: "rien" })).toEqual([]);
  });

  it("n'accepte que les liens http(s)", () => {
    expect(safeHttpUrl("https://site.test/a")).toBe("https://site.test/a");
    expect(safeHttpUrl("http://localhost:8080/a")).toBe("http://localhost:8080/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("/relatif")).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});

describe("carte « Brouillon WordPress » du dashboard", () => {
  it("n'affiche jamais « Prêt à publier » pour un brouillon déjà envoyé", () => {
    expect(wordpressDraftBadge({ ready: true }).label).toBe("Brouillon envoyé");
    expect(wordpressDraftBadge({ ready: true }).hint).toMatch(/WordPress/);
    expect(wordpressDraftBadge({ ready: false }).label).toBe("En préparation");
    for (const ready of [true, false])
      expect(wordpressDraftBadge({ ready }).label).not.toMatch(/prêt à publier/i);
  });
});

describe("correspondance des catégories", () => {
  const cats = [
    { id: 3, slug: "levees", name: "Levées de fonds", parent: 1 },
    { id: 1, slug: "actualites", name: "Actualités", parent: 0 },
    { id: 2, slug: "agenda", name: "Agenda", parent: 0 },
    { id: 4, slug: "seed", name: "Amorçage", parent: 3 },
    { id: 5, slug: "orpheline", name: "Orpheline", parent: 99 },
    { id: 6, slug: "boucle-a", name: "Boucle A", parent: 7 },
    { id: 7, slug: "boucle-b", name: "Boucle B", parent: 6 },
  ];

  it("ordonne la hiérarchie (parents puis enfants) avec la profondeur et le chemin", () => {
    const opts = categoryOptions(cats);
    expect(opts.map((o) => [o.slug, o.depth])).toEqual([
      ["actualites", 0],
      ["levees", 1],
      ["seed", 2],
      ["agenda", 0],
      ["orpheline", 0],
      ["boucle-a", 0],
      ["boucle-b", 1],
    ]);
    expect(opts.find((o) => o.slug === "seed")?.path).toBe(
      "Actualités › Levées de fonds › Amorçage",
    );
    expect(categoryOptions([])).toEqual([]);
  });

  it("reprend les réglages existants sans tenir compte de la casse des libellés", () => {
    expect(
      initialMapping(["Levée de fonds", "Brevet"], { "levée de fonds": "levees", Autre: "x" }),
    ).toEqual({ "Levée de fonds": "levees", Brevet: NO_CATEGORY });
  });

  it("n'envoie que des slugs, pour les seules catégories KORA, sans « aucune »", () => {
    const settings = buildWordPressSettings(
      ["Levée de fonds", "Brevet"],
      { "Levée de fonds": "levees", Brevet: NO_CATEGORY, Inconnue: "x" },
      NO_CATEGORY,
    );
    expect(settings).toEqual({
      categoryMap: { "Levée de fonds": "levees" },
      defaultCategory: null,
    });
    expect(buildWordPressSettings([], {}, "actualites").defaultCategory).toBe("actualites");
  });

  it("détecte les modifications à enregistrer", () => {
    const a = { categoryMap: { Brevet: "brevets" }, defaultCategory: null };
    expect(sameSettings(a, { categoryMap: { Brevet: "brevets" }, defaultCategory: null })).toBe(
      true,
    );
    expect(sameSettings(a, { categoryMap: {}, defaultCategory: null })).toBe(false);
    expect(sameSettings(a, { categoryMap: { Brevet: "brevets" }, defaultCategory: "x" })).toBe(
      false,
    );
  });

  it("affiche les slugs encodés de façon lisible", () => {
    expect(decodeSlug("actualit%c3%a9s")).toBe("actualités");
    expect(decodeSlug("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("configuration et test de connexion", () => {
  it("liste les trois variables et marque celles signalées manquantes", () => {
    const vars = setupVariables(["WORDPRESS_APP_PASSWORD", "WORDPRESS_URL"]);
    expect(vars.map((v) => [v.name, v.missing])).toEqual([
      ["WORDPRESS_URL", true],
      ["WORDPRESS_USERNAME", false],
      ["WORDPRESS_APP_PASSWORD", true],
    ]);
    expect(setupVariables(["AUTRE"]).at(-1)).toEqual({ name: "AUTRE", hint: "", missing: true });
  });

  it("avertit quand le compte peut publier (Contributeur recommandé)", () => {
    const account = { id: 3, name: "kora", roles: ["editor"] };
    const v = checkVerdict({ ok: true, account, canPublish: true, error: null });
    expect(v.tone).toBe("amber");
    expect(v.title).toMatch(/rôle du compte est trop élevé/);
    expect(v.detail).toMatch(/Contributeur/);
  });

  it("confirme un compte Contributeur et rapporte l'erreur sinon", () => {
    const account = { id: 3, name: "kora", roles: ["contributor"] };
    expect(checkVerdict({ ok: true, account, canPublish: false, error: null }).tone).toBe("green");
    expect(checkVerdict({ ok: true, account, canPublish: null, error: null }).tone).toBe("blue");
    const failed = checkVerdict({
      ok: false,
      account: null,
      canPublish: null,
      error: { code: "wordpress_auth_failed", message: "Identifiants refusés." },
    });
    expect(failed).toEqual({
      tone: "rose",
      title: "Connexion impossible",
      detail: "Identifiants refusés.",
    });
  });

  it("traduit les rôles WordPress usuels", () => {
    expect(wordpressRoleLabel("contributor")).toBe("Contributeur");
    expect(wordpressRoleLabel("administrator")).toBe("Administrateur");
    expect(wordpressRoleLabel("shop_manager")).toBe("shop_manager");
  });
});
