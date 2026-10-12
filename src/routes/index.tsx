import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shell, Tag } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { editorialScore, evidenceState, useKora, WEIGHTS, WEIGHT_LABELS, type SignalStatus } from "@/lib/kora-store";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Radar — KORA Newsroom Inovallée" },
    { name: "description", content: "Signaux d'actualité des entreprises d'Inovallée, scorés et sourcés." },
    { property: "og:title", content: "Radar — KORA Newsroom Inovallée" },
    { property: "og:description", content: "Signaux d'actualité des entreprises, scorés et sourcés." },
  ] }),
  component: Radar,
});

const tabs: { k: SignalStatus; l: string }[] = [
  { k: "nouveau", l: "Nouveautés" }, { k: "surveille", l: "Surveillés" }, { k: "traite", l: "Traités" }, { k: "rejete", l: "Rejetés" },
];

function Radar() {
  const { signals, companies, setSignalStatus, createDraft } = useKora();
  const [tab, setTab] = useState<SignalStatus>("nouveau");
  const [open, setOpen] = useState<string | null>(null);
  const nav = useNavigate();
  const list = signals.filter((s) => s.status === tab).sort((a, b) => editorialScore(b.scores) - editorialScore(a.scores));
  const failing = companies.flatMap((c) => c.sources.filter((s) => !s.ok).map((s) => ({ c, s })));

  return (
    <Shell kicker="KORA Radar · Signal Engine" title="Ce qui mérite d'être raconté">
      {failing.length > 0 && (
        <div className="mb-6 border-l-4 border-destructive bg-card p-4 text-sm">
          <span className="label text-destructive">Échec de collecte</span>
          {failing.map(({ c, s }) => <p key={s.url} className="mt-1">{c.name} · {s.url} — {s.error}</p>)}
        </div>
      )}
      <div className="mb-6 flex gap-6 border-b">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`label -mb-px border-b-2 pb-3 ${tab === t.k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
            {t.l} <span className="ml-1 font-mono">{signals.filter((s) => s.status === t.k).length}</span>
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="text-muted-foreground">Aucun signal dans cette catégorie.</p>}
      <ul className="divide-y">
        {list.map((s) => {
          const co = companies.find((c) => c.id === s.companyId)!;
          const ev = evidenceState(s);
          const score = editorialScore(s.scores);
          return (
            <li key={s.id} className="grid grid-cols-[5rem_1fr_auto] gap-6 py-6">
              <div className="font-display text-5xl leading-none text-primary">{score}</div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label">{co.name}</span><Tag>{s.category}</Tag><Tag tone={ev.tone}>{ev.label}</Tag>
                </div>
                <h3 className="font-display mt-2 text-2xl">{s.title}</h3>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  Collecté {s.collectedAt} · Publié {s.publishedAt ?? "date inconnue"} · {s.sources.join(" · ")}
                </p>
                <button onClick={() => setOpen(open === s.id ? null : s.id)} className="label mt-2 text-primary underline-offset-4 hover:underline">
                  {open === s.id ? "Masquer" : "Pourquoi ce score ?"}
                </button>
                {open === s.id && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-5">
                    {(Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => (
                      <div key={k} className="bg-card p-3">
                        <p className="label text-muted-foreground">{WEIGHT_LABELS[k]} · {WEIGHTS[k]}%</p>
                        <p className="font-display text-2xl">{s.scores[k]}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {s.status !== "traite" && (
                  <Button onClick={() => { const id = createDraft(s.id); nav({ to: "/studio", search: { d: id } }); }}>Rédiger</Button>
                )}
                {s.status === "nouveau" && <Button variant="outline" onClick={() => setSignalStatus(s.id, "surveille")}>Surveiller</Button>}
                {s.status !== "rejete" && s.status !== "traite" && <Button variant="ghost" onClick={() => setSignalStatus(s.id, "rejete")}>Rejeter</Button>}
                {s.status === "rejete" && <Button variant="ghost" onClick={() => setSignalStatus(s.id, "nouveau")}>Restaurer</Button>}
              </div>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}
