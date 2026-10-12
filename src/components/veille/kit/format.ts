import type { Tone } from "@/components/kora/labels";

const numberFmt = new Intl.NumberFormat("fr-FR");

export function formatNumber(n: number, digits = 0): string {
  return digits === 0
    ? numberFmt.format(Math.round(n))
    : new Intl.NumberFormat("fr-FR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(n);
}

/** « 1 échec » / « 3 échecs ». */
export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n > 1 ? many : one}`;
}

/** Ton d'une jauge de quota : vert < 80 %, ambre ≥ 80 %, rose à 100 %. */
export function ratioTone(ratio: number): Tone {
  if (ratio >= 1) return "rose";
  if (ratio >= 0.8) return "amber";
  return "green";
}
