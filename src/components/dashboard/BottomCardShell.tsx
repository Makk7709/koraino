import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Logo WordPress (cercle navy « W »). */
export function WordPressIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#21466e" />
      <circle cx="12" cy="12" r="9.3" fill="none" stroke="#fff" strokeWidth="0.9" />
      <path
        d="M5.4 8.6h3.1l2.3 7.1 1.4-4.2-1-2.9h3.1l2.3 7.1 1.3-4c.4-1.3-.1-2.4-.7-3.1h1.5c.6.9.8 2.1.4 3.4l-2.6 7.8h-.6L13 11.6 11 17.8h-.6z"
        fill="#fff"
      />
    </svg>
  );
}

/** Coque commune des 4 cartes basses du dashboard. */
export function BottomCardShell({
  icon,
  title,
  right,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("kora-card flex min-w-0 flex-col px-3.5 pt-3 pb-3", className)}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <h2 className="truncate text-[13px] font-bold text-kora-ink">{title}</h2>
        </div>
        {right}
      </header>
      <div className="mt-2.5 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

export function BottomCardSkeletonBody() {
  return (
    <div className="flex animate-pulse gap-3">
      <span className="h-[46px] w-[66px] shrink-0 rounded-md bg-primary/10" />
      <span className="flex-1 space-y-2 pt-1">
        <span className="block h-3 w-[85%] rounded bg-primary/10" />
        <span className="block h-3 w-[50%] rounded bg-primary/10" />
      </span>
    </div>
  );
}
