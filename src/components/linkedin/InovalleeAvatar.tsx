import { useId } from "react";
import { cn } from "@/lib/utils";

/** Avatar de la page Inovallée (anneau dégradé du logo sur fond pétrole). */
export function InovalleeAvatar({ className }: { className?: string }) {
  const id = useId();
  return (
    <span
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-kora-night",
        className,
      )}
    >
      <svg viewBox="0 0 40 40" className="size-[78%]" aria-hidden>
        <defs>
          <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5ed3d8" />
            <stop offset="0.55" stopColor="#2ee59d" />
            <stop offset="1" stopColor="#b6e33a" />
          </linearGradient>
        </defs>
        <path
          d="M29 9.5a13.5 13.5 0 1 0 3.6 15.5"
          fill="none"
          stroke={`url(#${id}-ring)`}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <text
          x="20"
          y="26"
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
          fontSize="16"
          fontWeight="600"
          fill="#e9fbf2"
        >
          i
        </text>
      </svg>
    </span>
  );
}
