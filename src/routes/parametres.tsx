import { createFileRoute } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { PageTitle, UnderlineTabs } from "@/components/kora/primitives";
import { AuditTab } from "@/components/parametres/AuditTab";
import { EditorialDnaTab } from "@/components/parametres/EditorialDnaTab";
import { ExportsTab } from "@/components/parametres/ExportsTab";
import { QuotasTab } from "@/components/parametres/QuotasTab";
import { ScoringGridTab } from "@/components/parametres/ScoringGridTab";
import { UsersRolesTab } from "@/components/parametres/UsersRolesTab";
import { Notice, usePermissions } from "@/components/veille/kit";

const TABS = [
  { value: "grille", label: "Grille de score" },
  { value: "dna", label: "Editorial DNA" },
  { value: "utilisateurs", label: "Utilisateurs & rôles" },
  { value: "quotas", label: "Quotas & budget" },
  { value: "exports", label: "Exports & réversibilité" },
  { value: "audit", label: "Journal d'audit" },
] as const;
type ParamTab = (typeof TABS)[number]["value"];
const isTab = (v: unknown): v is ParamTab => TABS.some((t) => t.value === v);

export const Route = createFileRoute("/parametres")({
  validateSearch: (s: Record<string, unknown>): { tab?: ParamTab | undefined } => ({
    tab: isTab(s["tab"]) ? s["tab"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Paramètres — Inovallée Newsroom IA" },
      { name: "description", content: "Grille de score, Editorial DNA, rôles, quotas et exports." },
    ],
  }),
  component: ParametresPage,
});

function ParametresPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: ParamTab = search.tab ?? "grille";
  const { readOnly } = usePermissions();

  return (
    <div className="space-y-4">
      <PageTitle
        title="Paramètres"
        subtitle="Pilotage & conformité · grille de score, référentiel éditorial, rôles, quotas, exports et journal"
      />
      <UnderlineTabs
        tabs={[...TABS]}
        value={tab}
        onChange={(t) =>
          void navigate({ search: { tab: t === "grille" ? undefined : t }, replace: true })
        }
      />
      {readOnly && (tab === "grille" || tab === "dna") && (
        <Notice tone="gray" icon={Eye}>
          Profil lecteur : les paramètres sont consultables mais non modifiables.
        </Notice>
      )}
      {tab === "grille" && <ScoringGridTab readOnly={readOnly} />}
      {tab === "dna" && <EditorialDnaTab readOnly={readOnly} />}
      {tab === "utilisateurs" && <UsersRolesTab />}
      {tab === "quotas" && <QuotasTab />}
      {tab === "exports" && <ExportsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}
