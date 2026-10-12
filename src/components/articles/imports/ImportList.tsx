import { FileText, Plus } from "lucide-react";
import { EmptyState, IconTile, Pill, SolidBadge } from "@/components/kora/primitives";
import { formatRelative } from "@/components/kora/labels";
import { useImports } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { formatBytes } from "../format";
import { ListSkeleton, LoadError } from "../ui";
import { fileKind, importState } from "./labels";

/** Colonne gauche de l'onglet « Imports humains ». */
export function ImportList({
  selectedId,
  onSelect,
  onNew,
}: {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const imports = useImports();
  const list = [...(imports.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="kora-card flex flex-col lg:max-h-[calc(100vh-2rem)]">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="text-[15px] font-bold text-kora-ink">Imports humains</h2>
        <SolidBadge value={list.length} tone="purple" />
        <button
          type="button"
          onClick={onNew}
          className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-kora-teal hover:text-kora-teal-dark"
        >
          <Plus className="size-3.5" /> Nouvel import
        </button>
      </header>
      <div className="kora-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {imports.isPending ? (
          <ListSkeleton rows={4} />
        ) : imports.isError ? (
          <LoadError error={imports.error} onRetry={() => void imports.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState title="Aucun import">
            Déposez un article DOCX ou TXT rédigé par l&apos;équipe.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((imp) => {
              const state = importState(imp);
              const selected = imp.id === selectedId;
              return (
                <li key={imp.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(imp.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition",
                      selected
                        ? "border-kora-blue/35 bg-kora-blue-bg/70"
                        : "border-border bg-white/80 hover:border-kora-teal-light hover:bg-white",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconTile
                        icon={FileText}
                        tone={fileKind(imp.filename) === "DOCX" ? "blue" : "gray"}
                      />
                      <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-kora-ink">
                        {imp.filename}
                      </p>
                      <Pill tone={state.tone} size="sm">
                        {state.label}
                      </Pill>
                    </div>
                    <p className="mt-1.5 text-[12px] text-kora-ink-soft">
                      Auteur : <span className="font-semibold text-kora-ink">{imp.author}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {fileKind(imp.filename)} · {formatBytes(imp.sizeBytes)} · importé{" "}
                      {formatRelative(imp.createdAt)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
