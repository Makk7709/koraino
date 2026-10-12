import { useId } from "react";
import { cn } from "@/lib/utils";

function useSvgId() {
  return useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Vignette « architecture verre » (brouillon WordPress). */
export function ArchitectureThumb({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg
      viewBox="0 0 80 56"
      preserveAspectRatio="xMidYMid slice"
      className={cn("block", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8cc7ec" />
          <stop offset="1" stopColor="#dff1fb" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2c5f8f" />
          <stop offset="1" stopColor="#0f2e4f" />
        </linearGradient>
      </defs>
      <rect width="80" height="56" fill={`url(#${id}-sky)`} />
      <path d="M6 56V24l14-8v40z" fill={`url(#${id}-glass)`} />
      <path d="M20 56V16l18 6v34z" fill="#3a78ad" />
      <path d="M44 56V10h16v46z" fill={`url(#${id}-glass)`} />
      <path d="M60 56V20l14 5v31z" fill="#4c8cc0" />
      {[14, 22, 30, 38, 46].map((y) => (
        <path key={y} d={`M44 ${y}h16`} stroke="#9fd2f5" strokeWidth="0.6" opacity="0.7" />
      ))}
      {[48, 52, 56].map((x) => (
        <path key={x} d={`M${x} 10v46`} stroke="#9fd2f5" strokeWidth="0.5" opacity="0.5" />
      ))}
      <path
        d="M22 24l14 4M22 32l14 4M22 40l14 4"
        stroke="#bfe4fb"
        strokeWidth="0.6"
        opacity="0.6"
      />
      <rect y="50" width="80" height="6" fill="#1d3b57" opacity="0.65" />
    </svg>
  );
}

/** Vignette « laboratoire quantique » (post LinkedIn). */
export function QuantumThumb({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg
      viewBox="0 0 80 56"
      preserveAspectRatio="xMidYMid slice"
      className={cn("block", className)}
      aria-hidden
    >
      <defs>
        <radialGradient id={`${id}-bg`} cx="0.5" cy="0.45" r="0.7">
          <stop offset="0" stopColor="#3f8fd8" />
          <stop offset="1" stopColor="#0a2140" />
        </radialGradient>
      </defs>
      <rect width="80" height="56" fill={`url(#${id}-bg)`} />
      <ellipse
        cx="40"
        cy="26"
        rx="20"
        ry="7"
        fill="none"
        stroke="#9ad8ff"
        strokeWidth="1"
        opacity="0.8"
      />
      <ellipse
        cx="40"
        cy="34"
        rx="15"
        ry="5"
        fill="none"
        stroke="#7cc4ff"
        strokeWidth="1"
        opacity="0.7"
      />
      <path d="M28 12v32M52 12v32M40 8v38" stroke="#cfe9ff" strokeWidth="1.2" opacity="0.55" />
      <circle cx="40" cy="22" r="3.2" fill="#e8f6ff" />
      <circle cx="40" cy="22" r="7" fill="#9ad8ff" opacity="0.25" />
      <path d="M0 50h80v6H0z" fill="#081a33" opacity="0.8" />
      {[10, 18, 62, 70].map((x) => (
        <rect key={x} x={x} y="18" width="4" height="30" rx="1" fill="#1d4f86" opacity="0.9" />
      ))}
    </svg>
  );
}
