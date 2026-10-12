import { Power, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { CountBadge, KoraCard, Pill } from "@/components/kora/primitives";
import {
  SOURCE_ACCESS,
  SOURCE_TYPE,
  formatDateTime,
  formatRelative,
} from "@/components/kora/labels";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { Company, Source, SourceAccess, SourceType } from "@/lib/api/types";
import {
  ALL,
  ConfirmDialog,
  DataTable,
  EmptyRow,
  ErrorPanel,
  ExternalAnchor,
  FilterBar,
  FilterSelect,
  IconAction,
  Pager,
  SearchField,
  TableSkeleton,
  Td,
  Th,
  Tr,
  usePaged,
  type WithAll,
} from "./kit";
import { FREQUENCY, SOURCE_ACCESS_OPTIONS, SOURCE_TYPE_OPTIONS } from "./labels";
import { displayUrl } from "./runs";
import { useCollectSource } from "./useCollect";

const PAGE_SIZE = 20;
const ACCESS_ORDER: Record<SourceAccess, number> = {
  erreur: 0,
  en_attente: 1,
  ok: 2,
  desactivee: 3,
};

function RunDate({ iso, empty }: { iso: string | null; empty: string }) {
  if (!iso) return <span className="text-[12px] text-muted-foreground">{empty}</span>;
  return (
    <span className="text-[12px] whitespace-nowrap text-kora-ink-soft" title={formatDateTime(iso)}>
      {formatRelative(iso)}
    </span>
  );
}

export function SourceRegistry({
  sources,
  companies,
  isPending,
  error,
  onRetry,
  access,
  onAccessChange,
  highlightId,
  readOnly,
}: {
  sources: Source[] | undefined;
  companies: Map<string, Company>;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  access: WithAll<SourceAccess>;
  onAccessChange: (v: WithAll<SourceAccess>) => void;
  highlightId: string | undefined;
  readOnly: boolean;
}) {
  const [type, setType] = useState<WithAll<SourceType>>(ALL);
  const [q, setQ] = useState("");
  const collect = useCollectSource();
  const toggle = useKoraMutation(
    ({ id, next }: { id: string; next: SourceAccess }) => api.updateSource(id, { access: next }),
    {
      success: (s) =>
        s.access === "desactivee"
          ? `Source « ${s.label} » désactivée`
          : `Source « ${s.label} » réactivée — en attente de la prochaine collecte`,
    },
  );
  const remove = useKoraMutation((id: string) => api.deleteSource(id), {
    success: "Source supprimée du registre",
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (sources ?? [])
      .filter((s) => access === ALL || s.access === access)
      .filter((s) => type === ALL || s.type === type)
      .filter((s) => {
        if (!needle) return true;
        const c = companies.get(s.companyId);
        return [s.label, s.url, c?.name ?? "", ...(c?.aliases ?? [])].some((v) =>
          v.toLowerCase().includes(needle),
        );
      })
      .sort(
        (a, b) =>
          ACCESS_ORDER[a.access] - ACCESS_ORDER[b.access] ||
          (companies.get(a.companyId)?.name ?? "").localeCompare(
            companies.get(b.companyId)?.name ?? "",
            "fr",
          ),
      );
  }, [sources, companies, access, type, q]);

  const focusIndex = highlightId ? rows.findIndex((s) => s.id === highlightId) : -1;
  const paged = usePaged(rows, PAGE_SIZE, { focusIndex, resetKey: `${access}|${type}|${q}` });

  return (
    <KoraCard
      title="Registre des sources"
      badge={sources && <CountBadge value={sources.length} tone="teal" />}
      action={
        <FilterBar>
          <SearchField value={q} onChange={setQ} placeholder="Entreprise, libellé, URL…" />
          <FilterSelect
            value={access}
            onChange={onAccessChange}
            options={SOURCE_ACCESS_OPTIONS}
            allLabel="Tous les statuts"
          />
          <FilterSelect
            value={type}
            onChange={setType}
            options={SOURCE_TYPE_OPTIONS}
            allLabel="Tous les types"
          />
        </FilterBar>
      }
    >
      {error ? (
        <ErrorPanel
          title="Le registre des sources n'a pas pu être chargé"
          error={error}
          onRetry={onRetry}
        />
      ) : isPending ? (
        <TableSkeleton rows={8} cols={7} />
      ) : (
        <>
          <DataTable>
            <thead>
              <tr>
                <Th>Entreprise</Th>
                <Th>Type</Th>
                <Th>URL</Th>
                <Th>Fréquence</Th>
                <Th>Statut d&apos;accès</Th>
                <Th>Dernière réussite</Th>
                <Th>Dernier passage</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.length === 0 && (
                <EmptyRow colSpan={8}>Aucune source ne correspond à ces filtres.</EmptyRow>
              )}
              {paged.slice.map((s) => {
                const company = companies.get(s.companyId);
                const status = SOURCE_ACCESS[s.access];
                const collecting = collect.isPending && collect.variables === s.id;
                const disabled = s.access === "desactivee";
                return (
                  <Tr key={s.id} id={`source-${s.id}`} selected={s.id === highlightId}>
                    <Td className="max-w-[230px]">
                      <div className="flex items-center gap-2.5">
                        {company ? (
                          <BrandMark name={company.name} brand={company.brand} size="md" />
                        ) : (
                          <span className="size-10 shrink-0 rounded-lg bg-muted" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-bold">
                            {company?.name ?? "Entreprise inconnue"}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{s.label}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-[12px] whitespace-nowrap text-kora-ink-soft">
                      {SOURCE_TYPE[s.type]}
                    </Td>
                    <Td className="max-w-[220px]">
                      <ExternalAnchor
                        href={s.url}
                        className="block truncate font-mono text-[11.5px]"
                      >
                        {displayUrl(s.url)}
                      </ExternalAnchor>
                    </Td>
                    <Td className="text-[12px] text-kora-ink-soft">{FREQUENCY[s.frequency]}</Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <Pill tone={status.tone} className="min-w-[6.5rem]">
                          {status.label}
                        </Pill>
                        {s.access === "erreur" && s.failureCode && (
                          <span
                            className="font-mono text-[10px] text-kora-rose"
                            title={s.failureReason ?? undefined}
                          >
                            {s.failureCode} · {Math.min(s.attempts, 3)}/3
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <RunDate iso={s.lastSuccessAt} empty="Aucune réussite" />
                    </Td>
                    <Td>
                      <RunDate iso={s.lastRunAt} empty="Jamais collectée" />
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        <IconAction
                          icon={RefreshCw}
                          label={disabled ? "Source désactivée" : "Collecter maintenant"}
                          disabled={readOnly || disabled || collecting}
                          spinning={collecting}
                          onClick={() => collect.mutate(s.id)}
                        />
                        <IconAction
                          icon={disabled ? Power : PowerOff}
                          label={disabled ? "Réactiver la source" : "Désactiver la source"}
                          disabled={readOnly || toggle.isPending}
                          onClick={() =>
                            toggle.mutate({
                              id: s.id,
                              next: disabled ? "en_attente" : "desactivee",
                            })
                          }
                        />
                        <ConfirmDialog
                          title="Supprimer cette source ?"
                          description={
                            <>
                              « {s.label} » ({company?.name ?? "entreprise inconnue"}) ne sera plus
                              collectée. Les observations déjà rattachées et l&apos;historique des
                              collectes sont conservés.
                            </>
                          }
                          confirmLabel="Supprimer"
                          onConfirm={() => remove.mutate(s.id)}
                          trigger={
                            <IconAction
                              icon={Trash2}
                              label="Supprimer la source"
                              tone="danger"
                              disabled={readOnly}
                            />
                          }
                        />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
          <Pager {...paged} unit="sources" />
        </>
      )}
    </KoraCard>
  );
}
