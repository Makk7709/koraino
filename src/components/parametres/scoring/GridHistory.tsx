import { CountBadge, KoraCard, Pill } from "@/components/kora/primitives";
import { CRITERION, formatDateTime } from "@/components/kora/labels";
import { DataTable, EmptyRow, Td, Th, Tr } from "@/components/veille/kit";
import type { ScoringGrid } from "@/lib/api/types";
import { CRITERIA, CRITERION_META } from "../labels";

export function GridHistory({ grids }: { grids: ScoringGrid[] }) {
  const sorted = [...grids].sort((a, b) => b.version - a.version);
  return (
    <KoraCard
      title="Historique des versions"
      badge={<CountBadge value={grids.length} tone="purple" />}
    >
      <DataTable>
        <thead>
          <tr>
            <Th>Version</Th>
            <Th>Poids</Th>
            <Th>Motif</Th>
            <Th>Auteur</Th>
            <Th>Date</Th>
            <Th>Statut</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <EmptyRow colSpan={6}>Aucune version enregistrée.</EmptyRow>}
          {sorted.map((g) => (
            <Tr key={g.version} selected={g.active}>
              <Td className="text-[14px] font-bold">v{g.version}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {CRITERIA.map((k) => (
                    <Pill key={k} tone={CRITERION_META[k].tone} size="sm" className="tabular-nums">
                      <span title={CRITERION[k]}>{CRITERION_META[k].short}</span> {g.weights[k]}
                    </Pill>
                  ))}
                </div>
              </Td>
              <Td className="max-w-[260px] text-[12px] text-kora-ink-soft">
                <span className="line-clamp-2">{g.note ?? "—"}</span>
              </Td>
              <Td className="text-[12px] whitespace-nowrap">{g.createdBy}</Td>
              <Td className="text-[12px] whitespace-nowrap text-kora-ink-soft tabular-nums">
                {formatDateTime(g.createdAt)}
              </Td>
              <Td>
                {g.active ? <Pill tone="green">Active</Pill> : <Pill tone="gray">Archivée</Pill>}
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
    </KoraCard>
  );
}
