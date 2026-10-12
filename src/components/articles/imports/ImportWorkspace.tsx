import { useImports } from "@/lib/api/hooks";
import { usePermissions } from "../hooks";
import { DetailSkeleton, LoadError } from "../ui";
import { ImportUpload } from "./ImportUpload";
import { ImportView } from "./ImportView";

/** Zone principale de l'onglet « Imports humains » (WF3). */
export function ImportWorkspace({
  importId,
  onSelectImport,
  onOpenArticle,
}: {
  importId: string | undefined;
  onSelectImport: (id: string | undefined) => void;
  onOpenArticle: (id: string) => void;
}) {
  const { canWrite } = usePermissions();
  const imports = useImports();
  if (!importId)
    return <ImportUpload canWrite={canWrite} onImported={(id) => onSelectImport(id)} />;
  if (imports.isPending) return <DetailSkeleton />;
  if (imports.isError)
    return <LoadError error={imports.error} onRetry={() => void imports.refetch()} />;
  const imp = imports.data.find((i) => i.id === importId);
  if (!imp)
    return (
      <LoadError
        title="Import introuvable"
        error={new Error("Cet import n'existe plus ou n'est pas accessible.")}
      />
    );
  return (
    <ImportView
      imp={imp}
      canWrite={canWrite}
      onNew={() => onSelectImport(undefined)}
      onOpenArticle={onOpenArticle}
    />
  );
}
