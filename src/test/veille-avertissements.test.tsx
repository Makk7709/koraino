/**
 * Avertissement d'une collecte réussie : affiché à part des erreurs.
 *
 * Le serveur range au même endroit (`errorCode`, `errorMessage`) l'erreur d'une collecte en échec
 * et l'avertissement d'une collecte réussie. L'interface ne doit pas présenter le second comme
 * une erreur : pastille orange, libellé en français, décompte séparé.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionHistory } from "@/components/veille/CollectionHistory";
import { runNotice, summarizeRuns, topNotices } from "@/components/veille/runs";
import { toastRun } from "@/components/veille/useCollect";
import type { CollectionRun } from "@/lib/api/types";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const REJECTED =
  "Google News : 4 publications écartées par la vérification de la date (4 pages d'éditeur inaccessibles).";
const UNCHECKED =
  "Google News : 2 publications non examinées (limite de 15 vérifications ou de 60 s par source).";

let seq = 0;
function run(over: Partial<CollectionRun> = {}): CollectionRun {
  seq += 1;
  return {
    id: `run_${seq}`,
    sourceId: `src_${seq}`,
    companyId: "co_x",
    startedAt: `2026-11-13T08:${String(10 + seq).padStart(2, "0")}:00.000Z`,
    finishedAt: `2026-11-13T08:${String(10 + seq).padStart(2, "0")}:05.000Z`,
    status: "succes",
    newObservations: 1,
    errorCode: null,
    errorMessage: null,
    ...over,
  };
}

const rejected = (over: Partial<CollectionRun> = {}) =>
  run({ errorCode: "DATE_REJECTED", errorMessage: REJECTED, ...over });
const failed = (code = "HTTP_503") =>
  run({ status: "echec", newObservations: 0, errorCode: code, errorMessage: "Source injoignable" });

beforeEach(() => {
  seq = 0;
  for (const fn of Object.values(toast)) fn.mockClear();
});

describe("runNotice : erreur ou avertissement", () => {
  it("ne rend rien pour une collecte sans code", () => {
    expect(runNotice(run())).toBeNull();
  });

  it.each<[CollectionRun["status"]]>([["echec"], ["bloque_quota"]])(
    "statut %s : une erreur, désignée par son code",
    (status) => {
      expect(
        runNotice(run({ status, errorCode: "QUOTA", errorMessage: "Plafond atteint" })),
      ).toEqual({ kind: "erreur", code: "QUOTA", label: "QUOTA", message: "Plafond atteint" });
    },
  );

  it.each<[string, string, string]>([
    ["DATE_REJECTED", REJECTED, "Articles écartés"],
    ["DATE_UNCHECKED", UNCHECKED, "Vérification incomplète"],
    ["HTTP_503", "Google News : le flux a répondu 503", "Google News indisponible"],
    ["TIMEOUT", "Google News : délai dépassé", "Google News indisponible"],
    ["AUTRE", "Motif inconnu", "Avertissement"],
    ["AUTRE", "", "Avertissement"],
  ])("collecte réussie, code %s (%s) : avertissement « %s »", (code, message, label) => {
    for (const status of ["succes", "succes_sans_actualite"] as const) {
      expect(runNotice(run({ status, errorCode: code, errorMessage: message }))).toEqual({
        kind: "avertissement",
        code,
        label,
        message,
      });
    }
  });

  it("un même code est une erreur sur un échec et un avertissement sur un succès", () => {
    const error = runNotice(run({ status: "echec", errorCode: "HTTP_503", errorMessage: "x" }));
    const warning = runNotice(
      run({ errorCode: "HTTP_503", errorMessage: "Google News : le flux a répondu 503" }),
    );
    expect([error?.kind, warning?.kind]).toEqual(["erreur", "avertissement"]);
  });
});

describe("décomptes : les avertissements sont comptés à part", () => {
  it("topNotices sépare erreurs et avertissements, du plus au moins fréquent", () => {
    const runs = [
      failed("HTTP_503"),
      failed("HTTP_503"),
      failed("TIMEOUT"),
      rejected(),
      rejected({ status: "succes_sans_actualite", newObservations: 0 }),
      rejected(),
      run({ errorCode: "DATE_UNCHECKED", errorMessage: UNCHECKED }),
      run({ errorCode: "HTTP_503", errorMessage: "Google News : le flux a répondu 503" }),
      run({ errorCode: "TIMEOUT", errorMessage: "Google News : délai dépassé" }),
      run(),
    ];
    expect(topNotices(runs)).toEqual({
      errors: [
        { code: "HTTP_503", label: "HTTP_503", count: 2 },
        { code: "TIMEOUT", label: "TIMEOUT", count: 1 },
      ],
      warnings: [
        { code: "DATE_REJECTED", label: "Articles écartés", count: 3 },
        { code: "HTTP_503", label: "Google News indisponible", count: 2 },
        { code: "DATE_UNCHECKED", label: "Vérification incomplète", count: 1 },
      ],
    });
  });

  it("topNotices ne garde que les plus fréquents", () => {
    const runs = ["A", "B", "C", "D", "E"].flatMap((code, n) =>
      Array.from({ length: n + 1 }, () => failed(code)),
    );
    expect(topNotices(runs).errors.map((e) => e.code)).toEqual(["E", "D", "C", "B"]);
    expect(topNotices(runs, 2).errors.map((e) => e.code)).toEqual(["E", "D"]);
  });

  it("summarizeRuns compte l'avertissement sans retirer la collecte des succès", () => {
    const summary = summarizeRuns([run(), rejected(), failed()]);
    expect(summary).toMatchObject({ total: 3, ok: 2, failed: 1, blocked: 0, warnings: 1 });
    expect(summary.successRate).toBeCloseTo(2 / 3);
  });
});

describe("historique des collectes", () => {
  function renderHistory(runs: CollectionRun[]) {
    return render(
      <CollectionHistory
        runs={runs}
        sources={new Map()}
        companies={new Map()}
        isPending={false}
        error={null}
        onRetry={() => undefined}
        onSelectSource={() => undefined}
      />,
    );
  }
  const rowOf = (text: string) => screen.getByText(text).closest("tr")!;

  it("affiche l'avertissement en orange avec son libellé, l'erreur en rose avec son code", () => {
    renderHistory([rejected(), failed()]);
    expect(screen.getByRole("columnheader", { name: "Erreur ou avertissement" })).toBeTruthy();

    const warning = within(rowOf(REJECTED)).getByText("Articles écartés");
    expect(warning.className).toContain("kora-orange");
    expect(warning.className).not.toContain("kora-rose");
    expect(within(rowOf(REJECTED)).queryByText("DATE_REJECTED")).toBeNull();
    expect(within(rowOf(REJECTED)).getByText("Succès")).toBeTruthy();
    expect(warning.parentElement?.getAttribute("title")).toBe(
      "Avertissement DATE_REJECTED : la collecte a réussi.",
    );

    const error = within(rowOf("Source injoignable")).getByText("HTTP_503");
    expect(error.className).toContain("kora-rose");
  });

  it("garde le message complet au survol", () => {
    renderHistory([rejected()]);
    expect(screen.getByText(REJECTED).getAttribute("title")).toBe(REJECTED);
  });

  it.each(["date_rejected", "écartés"])("retrouve un avertissement en cherchant « %s »", (q) => {
    renderHistory([rejected(), failed(), run()]);
    fireEvent.change(screen.getByPlaceholderText(/avertissement/), { target: { value: q } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Articles écartés")).toBeTruthy();
  });
});

describe("notification d'une collecte", () => {
  it("succès sans avertissement : notification de succès", () => {
    toastRun(run({ newObservations: 2 }));
    expect(toast.success).toHaveBeenCalledWith("Collecte réussie", {
      description: "2 nouvelles observations",
    });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("succès avec avertissement : notification d'avertissement, avec le motif", () => {
    toastRun(rejected({ newObservations: 1 }));
    expect(toast.warning).toHaveBeenCalledWith("Collecte réussie · Articles écartés", {
      description: `1 nouvelle observation. ${REJECTED}`,
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("aucune actualité avec avertissement : ne dit pas que rien n'a été publié", () => {
    toastRun(rejected({ status: "succes_sans_actualite", newObservations: 0 }));
    expect(toast.warning).toHaveBeenCalledWith("Aucune nouvelle actualité · Articles écartés", {
      description: REJECTED,
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("aucune actualité sans avertissement : message inchangé", () => {
    toastRun(run({ status: "succes_sans_actualite", newObservations: 0 }));
    expect(toast.success).toHaveBeenCalledWith("Succès · aucune actualité", {
      description: "Source joignable, aucune nouvelle actualité publiée.",
    });
  });

  it("échec : notification d'erreur avec le code", () => {
    toastRun(failed());
    expect(toast.error).toHaveBeenCalledWith("Échec de collecte · HTTP_503", {
      description: "Source injoignable",
    });
  });
});
