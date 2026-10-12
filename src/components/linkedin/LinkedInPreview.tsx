import { Globe2, MessageSquare, Repeat2, Send, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { InovalleeAvatar } from "./InovalleeAvatar";
import { hashtag } from "./text";

const FOLD = 260;

const ACTIONS = [
  { icon: ThumbsUp, label: "J'aime" },
  { icon: MessageSquare, label: "Commenter" },
  { icon: Repeat2, label: "Republier" },
  { icon: Send, label: "Envoyer" },
] as const;

/** Aperçu du post tel qu'il apparaîtra sur la page LinkedIn d'Inovallée. */
export function LinkedInPreview({ text, hashtags }: { text: string; hashtags: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > FOLD;
  const shown = long && !expanded ? `${text.slice(0, FOLD).trimEnd()}…` : text;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_3px_oklch(0.289_0.062_263.9/6%)]">
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <InovalleeAvatar />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13.5px] font-semibold text-kora-ink">Inovallée</p>
          <p className="text-[11.5px] text-muted-foreground">Tech Human Engaged · Page</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            Aperçu · <Globe2 className="size-3" />
          </p>
        </div>
        <span className="text-[13px] font-semibold text-kora-linkedin">+ Suivre</span>
      </div>
      <div className="px-4 pt-3 pb-3 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-kora-ink">
        {shown || <span className="text-muted-foreground">Texte vide.</span>}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="ml-1 text-[13px] font-medium text-muted-foreground hover:text-kora-linkedin hover:underline"
          >
            {expanded ? "voir moins" : "voir plus"}
          </button>
        )}
        {hashtags.length > 0 && (!long || expanded) && (
          <p className="mt-3 font-semibold text-kora-linkedin">{hashtags.map(hashtag).join(" ")}</p>
        )}
      </div>
      <div className="mx-4 flex items-center justify-between border-t border-border py-1.5 text-[12px] font-medium text-kora-ink-soft">
        {ACTIONS.map(({ icon: Icon, label }) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5">
            <Icon className="size-4" /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
