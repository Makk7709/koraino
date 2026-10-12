import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Table au style « Actualités détectées par l'IA » de la maquette :
 * en-tête gris clair arrondi, lignes aérées séparées d'un filet, ligne
 * sélectionnée sur fond bleu très clair bordé de bleu.
 */
export function DataTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("kora-scrollbar overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-left text-[13px] text-kora-ink">
        {children}
      </table>
    </div>
  );
}

export function Th({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={cn(
        "bg-secondary px-3 py-2 text-[12px] font-medium whitespace-nowrap text-kora-ink-soft first:rounded-l-lg last:rounded-r-lg",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...props} className={cn("border-b border-border/70 px-3 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

export function Tr({
  selected = false,
  interactive = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; interactive?: boolean }) {
  return (
    <tr
      {...props}
      data-selected={selected || undefined}
      className={cn(
        "transition-colors",
        interactive && "cursor-pointer [&:hover>td]:bg-kora-teal-bg/45",
        selected &&
          "[&>td]:border-t [&>td]:border-kora-blue/25 [&>td]:bg-kora-blue-bg/60 [&:hover>td]:bg-kora-blue-bg/70 [&>td:first-child]:rounded-l-lg [&>td:first-child]:border-l [&>td:last-child]:rounded-r-lg [&>td:last-child]:border-r",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/** Ligne vide occupant toute la largeur de la table. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export function Pager({
  page,
  pageCount,
  pageSize,
  total,
  setPage,
  unit = "éléments",
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  setPage: (p: number) => void;
  unit?: string;
}) {
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-[12px] text-kora-ink-soft">
      <span className="tabular-nums">
        {from}–{to} sur {total} {unit}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <PagerButton
            label="Page précédente"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </PagerButton>
          <span className="px-2 font-medium text-kora-ink tabular-nums">
            {page + 1} / {pageCount}
          </span>
          <PagerButton
            label="Page suivante"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="size-4" />
          </PagerButton>
        </div>
      )}
    </div>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-lg border border-border bg-white text-kora-ink transition hover:border-kora-teal-light hover:bg-kora-teal-bg disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
