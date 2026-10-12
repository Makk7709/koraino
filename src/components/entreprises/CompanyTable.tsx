import { ChevronRight } from "lucide-react";
import { BrandMark } from "@/components/kora/BrandMark";
import { CountBadge } from "@/components/kora/primitives";
import { DataTable, EmptyRow, Td, Th, Tr } from "@/components/veille/kit";
import type { Company } from "@/lib/api/types";
import { PriorityPill, ThemePills } from "./CompanyBits";

/** Vue table au style « Actualités détectées par l'IA ». */
export function CompanyTable({
  companies,
  selectedId,
  onOpen,
}: {
  companies: Company[];
  selectedId: string | undefined;
  onOpen: (id: string) => void;
}) {
  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Entreprise</Th>
          <Th>Secteur</Th>
          <Th>Territoire</Th>
          <Th>Thématiques</Th>
          <Th>Priorité</Th>
          <Th className="text-center">Sources</Th>
          <Th className="text-center">En échec</Th>
          <Th className="text-center">Signaux</Th>
          <Th className="w-8" aria-label="Ouvrir" />
        </tr>
      </thead>
      <tbody>
        {companies.length === 0 && (
          <EmptyRow colSpan={9}>Aucune entreprise ne correspond à ces filtres.</EmptyRow>
        )}
        {companies.map((c) => (
          <Tr key={c.id} interactive selected={c.id === selectedId} onClick={() => onOpen(c.id)}>
            <Td className="max-w-[260px]">
              <div className="flex items-center gap-3">
                <BrandMark name={c.name} brand={c.brand} size="md" />
                <div className="min-w-0">
                  <p className="truncate font-bold">{c.name}</p>
                  <p className="truncate text-[11px] text-kora-teal">{c.domain}</p>
                </div>
              </div>
            </Td>
            <Td className="max-w-[180px] truncate text-[12px] text-kora-ink-soft">{c.sector}</Td>
            <Td className="max-w-[160px] truncate text-[12px] text-kora-ink-soft">
              {c.territory || "—"}
            </Td>
            <Td className="max-w-[240px]">
              <ThemePills themes={c.themes} max={2} />
            </Td>
            <Td>
              <PriorityPill priority={c.priority} />
            </Td>
            <Td className="text-center font-semibold tabular-nums">{c.sourceCount}</Td>
            <Td className="text-center">
              {c.failingSourceCount > 0 ? (
                <CountBadge value={c.failingSourceCount} tone="rose" />
              ) : (
                <span className="text-[12px] text-muted-foreground">0</span>
              )}
            </Td>
            <Td className="text-center">
              <CountBadge value={c.signalCount} tone="blue" />
            </Td>
            <Td className="text-kora-ink-soft">
              <ChevronRight className="size-4" />
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
