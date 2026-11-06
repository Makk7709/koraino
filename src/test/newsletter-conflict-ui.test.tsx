import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditionWorkspace } from "@/components/newsletter/EditionWorkspace";
import { api, ApiError } from "@/lib/api/client";
import { buildSeed } from "@/server/store/seed";
import { toNewsletter } from "@/server/services/view";
import type { NewsletterEdition } from "@/lib/api/types";

vi.mock("@/components/articles/hooks", () => ({
  usePermissions: () => ({ canWrite: true, canValidate: true }),
}));
vi.mock("@/components/newsletter/AddTopicsPanel", () => ({ AddTopicsPanel: () => null }));
vi.mock("@/lib/api/hooks", async (load) => ({
  ...(await load<typeof import("@/lib/api/hooks")>()),
  usePublications: () => ({ data: [] }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const edition = () =>
  toNewsletter(
    buildSeed(new Date("2026-11-05T12:00:00Z")).newsletters.find((n) => n.id === "nl_current")!,
  );
function mount(e: NewsletterEdition) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = (n: NewsletterEdition) => (
    <QueryClientProvider client={qc}>
      <EditionWorkspace edition={n} companies={new Map()} />
    </QueryClientProvider>
  );
  return { ...render(view(e)), view };
}

describe("P0-01 local newsletter draft", () => {
  it("preserves entered text when a newer edition arrives and requires explicit discard", () => {
    const before = edition();
    const result = mount(before);
    fireEvent.change(screen.getByLabelText("Titre de l'édition"), {
      target: { value: "Mon texte local" },
    });
    result.rerender(
      result.view({
        ...before,
        title: "Texte distant",
        version: before.version + 1,
        revision: before.revision + 1,
      }),
    );
    expect(screen.getByLabelText("Titre de l'édition")).toHaveValue("Mon texte local");
    expect(screen.getByRole("button", { name: /Enregistrer la version/ })).toBeDisabled();
    expect(screen.getByText("Enregistrement non effectué")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByLabelText("Titre de l'édition")).toHaveValue("Texte distant");
  });

  it("sends the displayed revision and retains the draft after an HTTP 409", async () => {
    const before = edition();
    const update = vi
      .spyOn(api, "updateNewsletter")
      .mockRejectedValue(new ApiError(409, "version_mismatch", "Conflict"));
    mount(before);
    fireEvent.change(screen.getByLabelText("Titre de l'édition"), {
      target: { value: "Mon texte local" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer la version/ }));
    await waitFor(() =>
      expect(screen.getByText("Enregistrement non effectué")).toBeInTheDocument(),
    );
    expect(update).toHaveBeenCalledWith(
      before.id,
      expect.objectContaining({ version: before.version, revision: before.revision }),
    );
    expect(screen.getByLabelText("Titre de l'édition")).toHaveValue("Mon texte local");
    expect(
      screen
        .getAllByRole("button", { name: "Retirer de l'édition" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByText("Enregistrement non effectué")).not.toBeInTheDocument();
  });
});
