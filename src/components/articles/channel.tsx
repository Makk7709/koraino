import { Mail } from "lucide-react";
import type { Channel } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Carré bleu « in » de la maquette (Post LinkedIn à valider). */
export function LinkedInMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-kora-linkedin text-[12px] leading-none font-bold tracking-tight text-white",
        className,
      )}
    >
      in
    </span>
  );
}

/** Logo WordPress navy de la maquette (Brouillon WordPress). */
export function WordPressMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6 shrink-0", className)}>
      <circle cx="12" cy="12" r="11.5" className="fill-kora-ink" />
      <circle cx="12" cy="12" r="9.4" fill="none" stroke="white" strokeWidth="0.9" />
      <text
        x="12"
        y="16.3"
        textAnchor="middle"
        fontSize="11.5"
        fontWeight="700"
        fontFamily="Georgia, 'Times New Roman', serif"
        fill="white"
      >
        W
      </text>
    </svg>
  );
}

export function NewsletterMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-kora-teal-bg text-kora-teal",
        className,
      )}
    >
      <Mail className="size-3.5" strokeWidth={2.2} />
    </span>
  );
}

export function ChannelMark({ channel, className }: { channel: Channel; className?: string }) {
  const props = className ? { className } : {};
  if (channel === "wordpress") return <WordPressMark {...props} />;
  if (channel === "linkedin") return <LinkedInMark {...props} />;
  return <NewsletterMark {...props} />;
}
