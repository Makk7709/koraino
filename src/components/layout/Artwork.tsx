import { useId } from "react";
import { cn } from "@/lib/utils";

/** Identifiant SVG sûr pour `url(#…)` (les ids React peuvent contenir « : »). */
function useSvgId() {
  return useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Logo Inovallée (anneau dégradé + « inovallée » + signature). */
export function InovalleeLogo({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg
      viewBox="0 0 200 64"
      className={className}
      role="img"
      aria-label="Inovallée — Tech Human Engaged"
    >
      <defs>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ed3d8" />
          <stop offset="0.55" stopColor="#2ee59d" />
          <stop offset="1" stopColor="#b6e33a" />
        </linearGradient>
      </defs>
      <path
        d="M44 12a26 26 0 1 0 6 33"
        fill="none"
        stroke={`url(#${id}-ring)`}
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path
        d="M50 45a26 26 0 0 1-21 9"
        fill="none"
        stroke="#b6e33a"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
      <text
        x="20"
        y="40"
        fontFamily="Inter, sans-serif"
        fontSize="27"
        fontWeight="500"
        letterSpacing="-0.5"
        fill="#e9fbf2"
      >
        ino
        <tspan fill="#c9f25e">vallée</tspan>
      </text>
      <text
        x="76"
        y="54"
        fontFamily="Inter, sans-serif"
        fontSize="7.2"
        fontWeight="700"
        letterSpacing="0.6"
        fill="#b6e33a"
      >
        TECH HUMAN ENGAGED
      </text>
    </svg>
  );
}

/** Massif alpin de la sidebar (pics enneigés, versants verts éclairés par l'aurore). */
export function SidebarMountains({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg
      viewBox="0 0 240 190"
      preserveAspectRatio="xMidYMax slice"
      className={cn("block w-full", className)}
      aria-hidden
    >
      <defs>
        <radialGradient id={`${id}-glow`} cx="0.68" cy="0.3" r="0.6">
          <stop offset="0" stopColor="#3ee08a" stopOpacity="0.45" />
          <stop offset="1" stopColor="#3ee08a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-far`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4f1f8" />
          <stop offset="0.35" stopColor="#7cc3dc" />
          <stop offset="1" stopColor="#1f6585" />
        </linearGradient>
        <linearGradient id={`${id}-mid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c9aa6" />
          <stop offset="1" stopColor="#0d4651" />
        </linearGradient>
        <linearGradient id={`${id}-near`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3fd07c" />
          <stop offset="0.45" stopColor="#1b8a52" />
          <stop offset="1" stopColor="#0a3a30" />
        </linearGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.35" stopColor="#021f2b" stopOpacity="0" />
          <stop offset="1" stopColor="#021f2b" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="240" height="190" fill={`url(#${id}-glow)`} />
      <path
        d="M0 100 L18 78 L30 86 L52 44 L64 58 L76 50 L96 70 L112 60 L134 30 L150 50 L162 44 L184 72 L204 56 L224 74 L240 66 V190 H0 Z"
        fill={`url(#${id}-far)`}
      />
      <path
        d="M18 78 L30 86 L32 130 L14 130 Z M52 44 L64 58 L66 130 L44 130 L50 80 Z M76 50 L96 70 L98 130 L72 130 L75 84 Z M134 30 L150 50 L152 130 L126 130 L132 70 Z M162 44 L184 72 L186 130 L158 130 L161 84 Z M204 56 L224 74 L226 130 L200 130 L203 90 Z"
        fill="#164f6b"
        opacity="0.42"
      />
      <path
        d="M52 44 L60.5 54 L57 52.5 L54 55.5 L51 52 L47 54.5 Z M134 30 L145 44 L140.5 41.5 L137 46 L132.5 41 L128 45 L124 44 Z M76 50 L82 56 L79 55 L77 57.5 L74 55 L67 56 Z M204 56 L210.5 62 L207 61 L205 63.5 L202 61 L196.5 62 Z M162 44 L165 48 L163 47.5 L161 49 L158 47 L154 48 Z"
        fill="#ffffff"
        opacity="0.95"
      />
      <path
        d="M0 122 L22 104 L40 112 L66 92 L90 108 L116 96 L140 110 L170 90 L196 106 L222 98 L240 104 V190 H0 Z"
        fill={`url(#${id}-mid)`}
      />
      <path
        d="M0 150 C30 128 62 126 96 138 C128 150 168 124 206 128 C222 130 232 134 240 136 V190 H0 Z"
        fill={`url(#${id}-near)`}
      />
      <path
        d="M0 150 C30 128 62 126 96 138 C128 150 168 124 206 128 C222 130 232 134 240 136"
        fill="none"
        stroke="#8af5b4"
        strokeWidth="1"
        opacity="0.45"
      />
      <path
        d="M0 168 C40 152 80 154 120 162 C150 168 190 160 240 156 V190 H0 Z"
        fill="#0b3b34"
        opacity="0.85"
      />
      <rect x="0" y="0" width="240" height="190" fill={`url(#${id}-fade)`} />
    </svg>
  );
}

/** Mini paysage pour la carte « L'IA au service des écosystèmes d'innovation ». */
export function CardHills({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg
      viewBox="0 0 160 60"
      preserveAspectRatio="xMaxYMax slice"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-h`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#46d27f" />
          <stop offset="1" stopColor="#0f6b4a" />
        </linearGradient>
      </defs>
      <path
        d="M40 40 L70 18 L86 28 L104 10 L124 26 L160 14 V60 H40 Z"
        fill="#3c8fae"
        opacity="0.55"
      />
      <path d="M104 10 L110 18 L105 17 L100 22 Z" fill="#e6f6fa" opacity="0.8" />
      <path d="M20 60 C60 40 100 34 160 38 V60 Z" fill={`url(#${id}-h)`} />
    </svg>
  );
}

/** Paysage « Grenoble — Alpes d'innovation » du header, fondu vers la gauche. */
export function HeaderLandscape({ className }: { className?: string }) {
  const id = useSvgId();
  const pines = [
    [222, 52],
    [229, 49],
    [236, 47],
    [243, 45],
    [250, 43],
    [257, 41],
    [264, 40],
    [271, 38],
    [279, 37],
    [287, 35],
    [295, 34],
    [303, 33],
    [311, 32],
    [319, 31],
    [327, 30],
    [240, 52],
    [254, 49],
    [268, 46],
    [283, 44],
    [298, 42],
    [313, 40],
    [326, 39],
  ] as const;
  return (
    <svg
      viewBox="0 0 330 78"
      preserveAspectRatio="xMaxYMax slice"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d3eef6" />
          <stop offset="1" stopColor="#eef9f7" />
        </linearGradient>
        <linearGradient id={`${id}-rock`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef7fb" />
          <stop offset="0.45" stopColor="#b9d5e3" />
          <stop offset="1" stopColor="#86aec4" />
        </linearGradient>
        <linearGradient id={`${id}-forest`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f7d4a" />
          <stop offset="1" stopColor="#174f33" />
        </linearGradient>
        <linearGradient id={`${id}-meadow`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b5e27c" />
          <stop offset="0.6" stopColor="#6cc35d" />
          <stop offset="1" stopColor="#3f9a4e" />
        </linearGradient>
        <radialGradient id={`${id}-shade`} cx="0.92" cy="0.95" r="0.42">
          <stop offset="0" stopColor="#0c3a25" stopOpacity="0.78" />
          <stop offset="1" stopColor="#0c3a25" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-mask`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.3" stopColor="white" stopOpacity="0.65" />
          <stop offset="0.55" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}-m`}>
          <rect width="330" height="78" fill={`url(#${id}-mask)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-m)`}>
        <rect width="330" height="78" fill={`url(#${id}-sky)`} />
        <path
          d="M60 62 L92 44 L108 50 L130 34 L146 42 L160 36 L178 46 L196 30 L214 12 L232 30 L246 24 L262 36 L280 20 L300 30 L330 22 V78 H60 Z"
          fill={`url(#${id}-rock)`}
        />
        <path
          d="M92 44 L108 50 L110 78 L88 78 Z M130 34 L146 42 L148 78 L124 78 L128 56 Z M160 36 L178 46 L180 78 L156 78 L159 58 Z M214 12 L232 30 L236 78 L206 78 L212 44 Z M246 24 L262 36 L264 78 L242 78 L245 50 Z M280 20 L300 30 L304 78 L274 78 L279 50 Z"
          fill="#5f88a1"
          opacity="0.32"
        />
        <path
          d="M214 12 L224 22 L220 21 L217 24 L213 20.5 L209 23 L204 22 Z M280 20 L294 27 L289 26 L285 29 L281 26 L276 28.5 L272 27 Z M130 34 L142 40 L138 39.5 L135 41.5 L131 39 L126 41 L122 40 Z"
          fill="#ffffff"
        />
        <path
          d="M180 78 C200 60 212 53 232 48 C262 41 292 35 330 30 V78 Z"
          fill={`url(#${id}-forest)`}
        />
        {pines.map(([x, y]) => (
          <path key={`${x}-${y}`} d={`M${x} ${y - 10} l4.2 11 h-8.4 z`} fill="#16482c" />
        ))}
        <path
          d="M104 78 C150 70 196 62 238 57 C268 54 296 55 330 60 V78 Z"
          fill={`url(#${id}-meadow)`}
        />
        <rect width="330" height="78" fill={`url(#${id}-shade)`} />
      </g>
    </svg>
  );
}

/** Glyphe « in » LinkedIn (lucide n'a plus de logos de marque fiables). */
export function LinkedInIcon({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <rect x="3" y="9" width="4" height="12" rx="0.6" />
      <circle cx="5" cy="4.6" r="2.3" />
      <path d="M10 9h3.8v1.8c.6-1.1 2-2.1 4-2.1 3.3 0 4.2 2.1 4.2 5.2V21h-4v-6.2c0-1.5-.3-2.8-1.9-2.8-1.7 0-2.1 1.3-2.1 2.8V21h-4z" />
    </svg>
  );
}

/** Maison pleine de la navigation (maquette : icône « Dashboard »). */
export function HomeSolidIcon({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M11.3 2.6a1.1 1.1 0 0 1 1.4 0l8.6 7.2c.7.6.3 1.7-.6 1.7H19v8.3c0 .7-.5 1.2-1.2 1.2h-3.6v-5.6a1 1 0 0 0-1-1h-2.4a1 1 0 0 0-1 1V21H6.2C5.5 21 5 20.5 5 19.8v-8.3H3.3c-.9 0-1.3-1.1-.6-1.7z" />
    </svg>
  );
}

/** Vignette paysage (newsletter, aperçus). */
export function LandscapeThumb({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 80 56" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe6f2" />
          <stop offset="1" stopColor="#eaf8f4" />
        </linearGradient>
      </defs>
      <rect width="80" height="56" fill={`url(#${id}-s)`} />
      <path d="M0 40 L18 22 L28 30 L44 12 L58 28 L68 20 L80 30 V56 H0 Z" fill="#6f98ae" />
      <path d="M44 12 L50 20 L45 19 L40 24 Z" fill="#fff" />
      <path d="M0 48 C20 38 50 40 80 42 V56 H0 Z" fill="#4fae5a" />
    </svg>
  );
}
