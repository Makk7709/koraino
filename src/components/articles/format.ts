import type { Tone } from "@/components/kora/labels";
import type { Channel, PublicationStatus } from "@/lib/api/types";
import type { BannerTone } from "./ui";

export const CHANNELS: Channel[] = ["wordpress", "linkedin", "newsletter"];

export const CHANNEL_INFO: Record<
  Channel,
  { label: string; action: string; detail: string; mode: string }
> = {
  wordpress: {
    label: "WordPress",
    action: "Créer le brouillon WordPress",
    detail: "Brouillon distant : titre, corps, extrait, catégories, tags.",
    mode: "Brouillon distant",
  },
  linkedin: {
    label: "LinkedIn",
    action: "Exporter",
    detail: "Export du texte pour la page Inovallée (API conditionnelle aux accès).",
    mode: "Export",
  },
  newsletter: {
    label: "Newsletter",
    action: "Exporter",
    detail: "Export HTML simple + texte ; aucun envoi de campagne.",
    mode: "Export",
  },
};

export const PUBLICATION_STATUS: Record<
  PublicationStatus,
  { label: string; tone: Tone; banner: BannerTone }
> = {
  succes: { label: "Succès", tone: "green", banner: "success" },
  echec: { label: "Échec", tone: "rose", banner: "danger" },
  bloque: { label: "Bloqué", tone: "rose", banner: "danger" },
  verification_requise: { label: "Vérification requise", tone: "amber", banner: "warning" },
};

/** Marqueur posé par KORA sur un élément non corroboré : « [À vérifier] » ou « [À vérifier : …] ». */
export const MARKER_SOURCE = String.raw`\[\s*[àÀaA]\s+v[ée]rifier[^\]]*\]`;

export function countMarkers(text: string): number {
  return text.match(new RegExp(MARKER_SOURCE, "g"))?.length ?? 0;
}

/** Phrases du texte contenant un marqueur « [À vérifier] ». */
export function markerSentences(text: string): string[] {
  const re = new RegExp(MARKER_SOURCE);
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => re.test(s));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}
