import { createContext, useContext, useState, type ReactNode } from "react";

export type Category =
  | "Financement" | "Acquisition" | "Contrat" | "Partenariat" | "Innovation"
  | "Produit" | "Brevet" | "Recrutement" | "International" | "Distinction" | "Recherche";

export type SignalStatus = "nouveau" | "surveille" | "rejete" | "traite";
export type DraftStatus = "brouillon" | "en_revue" | "approuve" | "publie";
export type Channel = "WordPress" | "LinkedIn" | "Newsletter";

export interface Company {
  id: string; name: string; aliases: string[]; domain: string; sector: string;
  sources: { type: string; url: string; ok: boolean; lastSuccess: string; error?: string }[];
}
export interface Signal {
  id: string; companyId: string; title: string; category: Category; collectedAt: string;
  publishedAt?: string; sources: string[]; independent: number; status: SignalStatus;
  scores: { importance: number; nouveaute: number; territoire: number; lecteurs: number; diffusion: number };
}
export interface Version { n: number; text: string; at: string; by: string }
export interface Draft {
  id: string; signalId: string; title: string; versions: Version[]; status: DraftStatus;
  approval?: { by: string; at: string; version: number; channel: Channel };
  publishedOn: Channel[]; log: { at: string; msg: string }[];
}

export const WEIGHTS = { importance: 30, nouveaute: 20, territoire: 20, lecteurs: 20, diffusion: 10 } as const;
export const WEIGHT_LABELS: Record<keyof typeof WEIGHTS, string> = {
  importance: "Importance", nouveaute: "Nouveauté", territoire: "Adéquation territoriale",
  lecteurs: "Intérêt lecteurs", diffusion: "Potentiel de diffusion",
};

/** Score éditorial 0–100 : moyenne pondérée des sous-notes (0–100), poids sommant à 100 %. */
export function editorialScore(s: Signal["scores"]): number {
  const total = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[])
    .reduce((acc, k) => acc + s[k] * WEIGHTS[k], 0);
  return Math.round(total / 100);
}

/** Indicateur documentaire : état explicable, pas une probabilité. */
export function evidenceState(sig: Signal): { label: string; tone: "ok" | "warn" | "bad" } {
  if (sig.independent >= 2) return { label: "Corroboré", tone: "ok" };
  if (sig.independent === 1) return { label: "Source unique", tone: "warn" };
  return { label: "Non vérifié", tone: "bad" };
}

const now = () => new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

function seed(): { companies: Company[]; signals: Signal[]; drafts: Draft[] } {
  const companies: Company[] = [
    { id: "c1", name: "Isorg", aliases: ["ISORG SA"], domain: "isorg.fr", sector: "Électronique imprimée",
      sources: [{ type: "Actualités", url: "isorg.fr/news", ok: true, lastSuccess: "12/10/2026" },
                { type: "RSS", url: "isorg.fr/feed", ok: true, lastSuccess: "12/10/2026" }] },
    { id: "c2", name: "Enerbee", aliases: [], domain: "enerbee.fr", sector: "Énergie",
      sources: [{ type: "Communiqués", url: "enerbee.fr/press", ok: false, lastSuccess: "02/10/2026", error: "HTTP 403 — accès refusé" }] },
    { id: "c3", name: "Lynred", aliases: ["Sofradir", "ULIS"], domain: "lynred.com", sector: "Photonique",
      sources: [{ type: "Actualités", url: "lynred.com/news", ok: true, lastSuccess: "11/10/2026" }] },
    { id: "c4", name: "Pixstart", aliases: [], domain: "pixstart.io", sector: "Logiciel",
      sources: [{ type: "RSS", url: "pixstart.io/rss", ok: true, lastSuccess: "12/10/2026" }] },
    { id: "c5", name: "Aledia", aliases: [], domain: "aledia.com", sector: "Micro-LED",
      sources: [{ type: "Actualités", url: "aledia.com/actualites", ok: true, lastSuccess: "10/10/2026" }] },
  ];
  const signals: Signal[] = [
    { id: "s1", companyId: "c1", title: "Isorg lève 18 M€ pour industrialiser ses capteurs biométriques", category: "Financement",
      collectedAt: "12/10/2026", publishedAt: "11/10/2026", sources: ["isorg.fr", "lesechos.fr", "usine-nouvelle.com"], independent: 2, status: "nouveau",
      scores: { importance: 90, nouveaute: 85, territoire: 95, lecteurs: 80, diffusion: 85 } },
    { id: "s2", companyId: "c3", title: "Lynred signe un contrat pluriannuel avec un acteur spatial européen", category: "Contrat",
      collectedAt: "11/10/2026", sources: ["lynred.com"], independent: 1, status: "nouveau",
      scores: { importance: 80, nouveaute: 70, territoire: 85, lecteurs: 65, diffusion: 70 } },
    { id: "s3", companyId: "c5", title: "Aledia ouvre une ligne pilote à Champagnier", category: "Innovation",
      collectedAt: "10/10/2026", publishedAt: "09/10/2026", sources: ["aledia.com", "ledauphine.com"], independent: 2, status: "surveille",
      scores: { importance: 75, nouveaute: 60, territoire: 100, lecteurs: 70, diffusion: 60 } },
    { id: "s4", companyId: "c4", title: "Pixstart recrute 12 ingénieurs d'ici fin 2026", category: "Recrutement",
      collectedAt: "12/10/2026", sources: ["linkedin.com"], independent: 0, status: "nouveau",
      scores: { importance: 45, nouveaute: 60, territoire: 80, lecteurs: 55, diffusion: 50 } },
    { id: "s5", companyId: "c1", title: "Isorg présent au salon CES 2027", category: "International",
      collectedAt: "08/10/2026", sources: ["isorg.fr"], independent: 1, status: "rejete",
      scores: { importance: 30, nouveaute: 40, territoire: 40, lecteurs: 35, diffusion: 45 } },
  ];
  const drafts: Draft[] = [
    { id: "d1", signalId: "s3", title: "Aledia accélère avec une ligne pilote micro-LED", status: "en_revue", publishedOn: [],
      versions: [{ n: 1, by: "Assistant KORA", at: "10/10/2026 09:12",
        text: "Aledia, implantée sur le territoire d'Inovallée, annonce l'ouverture d'une ligne pilote dédiée à ses micro-LED 3D à Champagnier.\n\nSelon le communiqué de l'entreprise, corroboré par Le Dauphiné Libéré, cette étape prépare l'industrialisation de sa technologie.\n\n[À vérifier] Le calendrier de montée en cadence n'est pas précisé dans les sources." }],
      log: [{ at: "10/10/2026 09:12", msg: "Brouillon v1 généré à partir de 2 sources" }, { at: "10/10/2026 10:40", msg: "Soumis en revue" }] },
  ];
  return { companies, signals, drafts };
}

interface Store {
  companies: Company[]; signals: Signal[]; drafts: Draft[];
  setSignalStatus: (id: string, s: SignalStatus) => void;
  createDraft: (signalId: string) => string;
  editDraft: (id: string, text: string, by: string) => void;
  submit: (id: string) => void;
  approve: (id: string, by: string, channel: Channel) => void;
  publish: (id: string, channel: Channel) => { ok: boolean; reason?: string };
  addCompany: (c: Omit<Company, "id" | "sources">) => void;
}

const Ctx = createContext<Store | null>(null);

export function KoraProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(seed);
  const upd = (id: string, f: (d: Draft) => Draft) =>
    setState((s) => ({ ...s, drafts: s.drafts.map((d) => (d.id === id ? f(d) : d)) }));

  const store: Store = {
    ...state,
    setSignalStatus: (id, st) => setState((s) => ({ ...s, signals: s.signals.map((x) => (x.id === id ? { ...x, status: st } : x)) })),
    createDraft: (signalId) => {
      const sig = state.signals.find((x) => x.id === signalId)!;
      const co = state.companies.find((c) => c.id === sig.companyId)!;
      const id = "d" + (state.drafts.length + 1) + "-" + signalId;
      const text = `${co.name} — ${sig.title}.\n\nD'après ${sig.sources.join(", ")}, ${co.name} (${co.sector}) fait l'actualité dans la catégorie « ${sig.category} ».\n\n${sig.independent < 2 ? "[À vérifier] Information non corroborée par une source indépendante.\n\n" : ""}Angle proposé : l'impact pour l'écosystème d'Inovallée.`;
      setState((s) => ({
        ...s,
        signals: s.signals.map((x) => (x.id === signalId ? { ...x, status: "traite" } : x)),
        drafts: [{ id, signalId, title: sig.title, status: "brouillon", publishedOn: [],
          versions: [{ n: 1, text, by: "Assistant KORA", at: now() }],
          log: [{ at: now(), msg: `Brouillon v1 généré à partir de ${sig.sources.length} source(s)` }] }, ...s.drafts],
      }));
      return id;
    },
    editDraft: (id, text, by) => upd(id, (d) => {
      const n = d.versions.length + 1;
      const invalidated = d.status === "approuve";
      return { ...d, versions: [...d.versions, { n, text, by, at: now() }], status: invalidated ? "en_revue" : d.status,
        approval: invalidated ? undefined : d.approval,
        log: [...d.log, { at: now(), msg: `Version v${n} par ${by}${invalidated ? " — approbation invalidée" : ""}` }] };
    }),
    submit: (id) => upd(id, (d) => ({ ...d, status: "en_revue", log: [...d.log, { at: now(), msg: "Soumis en revue" }] })),
    approve: (id, by, channel) => upd(id, (d) => ({ ...d, status: "approuve",
      approval: { by, at: now(), version: d.versions.length, channel },
      log: [...d.log, { at: now(), msg: `Approuvé v${d.versions.length} par ${by} pour ${channel}` }] })),
    publish: (id, channel) => {
      const d = state.drafts.find((x) => x.id === id)!;
      if (!d.approval || d.approval.version !== d.versions.length) return { ok: false, reason: "Aucune approbation valide sur la version courante." };
      if (d.approval.channel !== channel) return { ok: false, reason: `Approbation limitée au canal ${d.approval.channel}.` };
      if (d.publishedOn.includes(channel)) return { ok: false, reason: "Déjà publié sur ce canal (clé d'idempotence)." };
      upd(id, (x) => ({ ...x, status: "publie", publishedOn: [...x.publishedOn, channel],
        log: [...x.log, { at: now(), msg: `Publié sur ${channel} (v${x.versions.length})` }] }));
      return { ok: true };
    },
    addCompany: (c) => setState((s) => ({ ...s, companies: [...s.companies, { ...c, id: "c" + (s.companies.length + 1), sources: [] }] })),
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useKora() {
  const v = useContext(Ctx);
  if (!v) throw new Error("KoraProvider missing");
  return v;
}
