import { Download, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { CountBadge, KoraCard, Pill } from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import {
  ALL,
  DataTable,
  DownloadLink,
  EmptyRow,
  ErrorPanel,
  FilterBar,
  FilterSelect,
  Notice,
  Pager,
  SearchField,
  TableSkeleton,
  Td,
  Th,
  Tr,
  usePaged,
  type WithAll,
} from "@/components/veille/kit";
import { downloadUrl } from "@/lib/api/client";
import { useAudit } from "@/lib/api/hooks";
import type { AuditEvent } from "@/lib/api/types";
import { AUDIT_ENTITY } from "./labels";

type Entity = AuditEvent["entity"];

const ENTITY_OPTIONS = (Object.keys(AUDIT_ENTITY) as Entity[]).map((value) => ({
  value,
  label: AUDIT_ENTITY[value].label,
}));
const LIMIT = 500;
const PAGE_SIZE = 25;

/** Journal d'audit (§6). */
export function AuditTab() {
  const [entity, setEntity] = useState<WithAll<Entity>>(ALL);
  const [q, setQ] = useState("");
  const audit = useAudit(entity === ALL ? { limit: LIMIT } : { entity, limit: LIMIT });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (audit.data ?? [])
      .filter(
        (e) =>
          !needle ||
          [e.actor, e.action, e.details, e.entityId].some((v) => v.toLowerCase().includes(needle)),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [audit.data, q]);
  const paged = usePaged(rows, PAGE_SIZE, { resetKey: `${entity}|${q}` });

  return (
    <div className="space-y-4">
      <KoraCard
        title="Journal d'audit"
        badge={audit.data && <CountBadge value={audit.data.length} tone="gray" />}
        action={
          <FilterBar>
            <SearchField value={q} onChange={setQ} placeholder="Acteur, action, détail…" />
            <FilterSelect
              value={entity}
              onChange={setEntity}
              options={ENTITY_OPTIONS}
              allLabel="Toutes les entités"
            />
            <DownloadLink href={downloadUrl.export("audit", "csv")}>
              <Download className="size-3.5" /> Exporter (CSV)
            </DownloadLink>
          </FilterBar>
        }
      >
        {audit.error ? (
          <ErrorPanel
            title="Le journal d'audit n'a pas pu être chargé"
            error={audit.error}
            onRetry={() => void audit.refetch()}
          />
        ) : audit.isPending ? (
          <TableSkeleton rows={10} cols={5} />
        ) : (
          <>
            <DataTable>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Acteur</Th>
                  <Th>Action</Th>
                  <Th>Entité</Th>
                  <Th>Détails</Th>
                </tr>
              </thead>
              <tbody>
                {paged.slice.length === 0 && (
                  <EmptyRow colSpan={5}>Aucun événement ne correspond à ces filtres.</EmptyRow>
                )}
                {paged.slice.map((e) => {
                  const ent = AUDIT_ENTITY[e.entity];
                  return (
                    <Tr key={e.id}>
                      <Td className="text-[12px] whitespace-nowrap text-kora-ink-soft tabular-nums">
                        {formatDateTime(e.at)}
                      </Td>
                      <Td className="text-[12.5px] font-semibold whitespace-nowrap">{e.actor}</Td>
                      <Td className="max-w-[220px] text-[12.5px]">
                        <span className="line-clamp-2">{e.action}</span>
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-0.5">
                          <Pill tone={ent.tone} size="sm">
                            {ent.label}
                          </Pill>
                          <span className="max-w-[140px] truncate font-mono text-[10px] text-muted-foreground">
                            {e.entityId}
                          </span>
                        </div>
                      </Td>
                      <Td className="max-w-[420px] text-[12px] text-kora-ink-soft">
                        <span className="line-clamp-2" title={e.details}>
                          {e.details || "—"}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
            <Pager {...paged} unit="événements" />
          </>
        )}
      </KoraCard>
      <Notice tone="gray" icon={ScrollText}>
        Versions, décisions, motifs de rejet et identifiants de publication sont journalisés et
        exportables. La journalisation n&apos;est pas présentée comme inviolable ; les journaux
        techniques sont conservés 90 jours glissants et excluent textes complets, secrets et pièces
        jointes.
      </Notice>
    </div>
  );
}
