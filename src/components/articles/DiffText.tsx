import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { diffStats, diffWords, type DiffPart } from "./diff";

function Change({ part }: { part: DiffPart }) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(part.text);
  const [lead, core, trail] = [m?.[1] ?? "", m?.[2] ?? part.text, m?.[3] ?? ""];
  if (!core) return <>{part.text}</>;
  return (
    <>
      {lead}
      {part.type === "insert" ? (
        <ins className="rounded-[3px] bg-kora-green-bg px-0.5 font-medium text-kora-green no-underline">
          {core}
        </ins>
      ) : (
        <del className="rounded-[3px] bg-kora-rose-bg px-0.5 text-kora-rose decoration-kora-rose/70">
          {core}
        </del>
      )}
      {trail}
    </>
  );
}

/** Rendu d'une comparaison : ajouts verts, suppressions roses barrées. */
export function DiffParts({ parts, className }: { parts: DiffPart[]; className?: string }) {
  return (
    <div
      className={cn(
        "text-[13px] leading-relaxed break-words whitespace-pre-wrap text-kora-ink-soft",
        className,
      )}
    >
      {parts.map((p, i) =>
        p.type === "equal" ? <span key={i}>{p.text}</span> : <Change key={i} part={p} />,
      )}
    </div>
  );
}

export function DiffText({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return <DiffParts parts={parts} {...(className ? { className } : {})} />;
}

export function DiffLegend({ parts }: { parts: DiffPart[] }) {
  const { added, removed } = diffStats(parts);
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold tabular-nums">
      <span className="rounded-md bg-kora-green-bg px-1.5 py-0.5 text-kora-green">
        +{added} mot{added > 1 ? "s" : ""}
      </span>
      <span className="rounded-md bg-kora-rose-bg px-1.5 py-0.5 text-kora-rose">
        −{removed} mot{removed > 1 ? "s" : ""}
      </span>
    </span>
  );
}
