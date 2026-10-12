import { cn } from "@/lib/utils";

type Brand = { initials: string; bg: string; fg: string };

const SIZES = {
  xs: "size-6 rounded-md text-[9px]",
  sm: "size-8 rounded-lg text-[11px]",
  md: "size-10 rounded-lg text-xs",
  lg: "size-14 rounded-xl text-base",
} as const;

/** Constellation (maquette Pasqal). */
function Constellation() {
  const dots = [
    [12, 8, "#c8f560"],
    [20, 6, "#7ee787"],
    [27, 10, "#c8f560"],
    [8, 15, "#7ee787"],
    [16, 14, "#e9ff7a"],
    [24, 16, "#7ee787"],
    [31, 18, "#c8f560"],
    [11, 22, "#c8f560"],
    [19, 21, "#7ee787"],
    [27, 24, "#e9ff7a"],
    [14, 29, "#7ee787"],
    [22, 29, "#c8f560"],
    [30, 30, "#7ee787"],
    [18, 34, "#c8f560"],
    [6, 26, "#7ee787"],
  ] as const;
  return (
    <svg viewBox="0 0 38 40" className="size-[78%]">
      {dots.map(([x, y, c], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.9 : 1.4} fill={c} />
      ))}
    </svg>
  );
}

function SpecialGlyph({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.startsWith("pasqal")) return <Constellation />;
  if (n.startsWith("wattpark"))
    return (
      <svg viewBox="0 0 40 40" className="size-[86%]">
        <path
          d="M33 6C17 6 7 14 7 26c0 3 1 6 3 8 2-9 8-15 17-19-7 5-12 11-14 20 2 1 4 1 6 1 12 0 16-12 14-30z"
          fill="#3fb84a"
        />
      </svg>
    );
  if (n.startsWith("sinano"))
    return (
      <svg viewBox="0 0 40 40" className="size-[88%]">
        <path d="M20 3l14.7 8.5v17L20 37 5.3 28.5v-17z" fill="#e3263a" />
        <path
          d="M25 14.5c-1.4-1.4-3.2-2-5.2-2-3 0-5.2 1.6-5.2 4 0 5.2 10.6 3 10.6 7.4 0 1.9-2 3.4-5 3.4-2.3 0-4.3-.9-5.6-2.4"
          stroke="#fff"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    );
  if (n.startsWith("araymond"))
    return (
      <svg viewBox="0 0 40 40" className="size-[86%]">
        <path d="M20 5L6 35h7l7-16 7 16h7z" fill="#1d6fd1" />
      </svg>
    );
  if (n.startsWith("verkor"))
    return (
      <svg viewBox="0 0 40 40" className="size-[90%]">
        <path d="M4 8h7l7 17V8h6v24h-6z" fill="#0f5c4a" />
        <path d="M24 20l10-12h6L29 21l11 11h-7z" fill="#12866a" />
      </svg>
    );
  if (n === "european commission" || n.startsWith("commission europ"))
    return (
      <svg viewBox="0 0 40 40" className="size-[80%]">
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <circle
              key={i}
              cx={20 + Math.cos(a) * 11}
              cy={20 + Math.sin(a) * 11}
              r="2"
              fill="#ffd617"
            />
          );
        })}
      </svg>
    );
  return null;
}

const WITH_GLYPH = [
  "pasqal",
  "wattpark",
  "sinano",
  "araymond",
  "verkor",
  "european commission",
  "commission europ",
];
/** Marques affichées sans fond (logo posé sur la carte, comme dans la maquette). */
const TRANSPARENT = ["wattpark", "sinano", "araymond", "verkor"];

/**
 * Logo d'entreprise ou de média : glyphe dédié pour les marques connues,
 * sinon monogramme aux couleurs `brand`.
 */
export function BrandMark({
  name,
  brand,
  size = "md",
  className,
}: {
  name: string;
  brand: Brand;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const n = name.toLowerCase();
  const hasGlyph = WITH_GLYPH.some((k) => n.startsWith(k));
  const transparent = TRANSPARENT.some((k) => n.startsWith(k));
  const serif = n === "les echos" || n === "le figaro";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden font-bold leading-none",
        SIZES[size],
        className,
      )}
      style={transparent ? undefined : { background: brand.bg, color: brand.fg }}
      aria-label={name}
      title={name}
    >
      {hasGlyph ? (
        <SpecialGlyph name={name} />
      ) : (
        <span
          className={cn(serif && "font-serif text-[1.35em]")}
          style={serif ? { fontFamily: "Georgia, serif" } : undefined}
        >
          {brand.initials}
        </span>
      )}
    </span>
  );
}
