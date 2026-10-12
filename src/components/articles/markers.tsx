import type { ReactNode } from "react";
import { MARKER_SOURCE } from "./format";

/** Texte avec les marqueurs « [À vérifier] » surlignés en ambre. */
export function HighlightMarkers({ text }: { text: string }): ReactNode {
  const parts = text.split(new RegExp(`(${MARKER_SOURCE})`, "g"));
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded-[4px] bg-kora-amber-bg px-1 py-px text-[0.92em] font-semibold text-kora-amber ring-1 ring-kora-amber/30"
      >
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

type Block =
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "p"; text: string };

/** Découpe un corps d'article (texte brut, titres « ## », listes « - », citations « > »). */
function parseBody(body: string): Block[] {
  return body
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b): Block => {
      const lines = b.split("\n");
      if (/^#{1,4}\s/.test(b) && lines.length === 1)
        return { kind: "h", text: b.replace(/^#{1,4}\s+/, "") };
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l)))
        return { kind: "ul", items: lines.map((l) => l.replace(/^\s*[-*•]\s+/, "")) };
      if (lines.every((l) => /^\s*>/.test(l)))
        return { kind: "quote", text: lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n") };
      return { kind: "p", text: b };
    });
}

export function RichBody({ body }: { body: string }) {
  const blocks = parseBody(body);
  return (
    <div className="flex flex-col gap-3.5 text-[14px] leading-7 text-kora-ink-soft">
      {blocks.map((b, i) => {
        if (b.kind === "h")
          return (
            <h3 key={i} className="mt-1 text-[16px] font-bold text-kora-ink">
              <HighlightMarkers text={b.text} />
            </h3>
          );
        if (b.kind === "ul")
          return (
            <ul key={i} className="ml-5 list-disc space-y-1 marker:text-kora-teal">
              {b.items.map((it, j) => (
                <li key={j}>
                  <HighlightMarkers text={it} />
                </li>
              ))}
            </ul>
          );
        if (b.kind === "quote")
          return (
            <blockquote
              key={i}
              className="border-l-[3px] border-kora-teal-light pl-3.5 text-kora-ink italic"
            >
              <HighlightMarkers text={b.text} />
            </blockquote>
          );
        return (
          <p key={i} className="whitespace-pre-line">
            <HighlightMarkers text={b.text} />
          </p>
        );
      })}
    </div>
  );
}
