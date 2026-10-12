import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell, Tag } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKora } from "@/lib/kora-store";

export const Route = createFileRoute("/entreprises")({
  head: () => ({ meta: [
    { title: "Registre des entreprises — KORA Newsroom" },
    { name: "description", content: "Entreprises suivies, alias et sources de collecte approuvées." },
    { property: "og:title", content: "Registre des entreprises — KORA Newsroom" },
    { property: "og:description", content: "Entreprises suivies et sources de collecte." },
  ] }),
  component: Entreprises,
});

function Entreprises() {
  const { companies, addCompany } = useKora();
  const [f, setF] = useState({ name: "", domain: "", sector: "" });
  return (
    <Shell kicker={`Registre · ${companies.length} / 30 au pilote`} title="Entreprises suivies">
      <form className="mb-8 flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault(); if (!f.name) return;
        addCompany({ ...f, aliases: [] }); setF({ name: "", domain: "", sector: "" });
      }}>
        <Input placeholder="Raison sociale" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="max-w-xs" />
        <Input placeholder="Domaine officiel" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} className="max-w-xs" />
        <Input placeholder="Secteur" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} className="max-w-xs" />
        <Button type="submit">Ajouter</Button>
      </form>
      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((c) => (
          <article key={c.id} className="bg-card p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-2xl">{c.name}</h3>
              <span className="font-mono text-xs text-muted-foreground">{c.domain}</span>
            </div>
            <p className="label mt-1 text-muted-foreground">{c.sector}{c.aliases.length ? ` · alias : ${c.aliases.join(", ")}` : ""}</p>
            <ul className="mt-4 space-y-2">
              {c.sources.length === 0 && <li className="text-sm text-muted-foreground">Aucune source rattachée — à valider au cadrage.</li>}
              {c.sources.map((s) => (
                <li key={s.url} className="flex items-center justify-between gap-2 text-sm">
                  <span><Tag>{s.type}</Tag> <span className="font-mono">{s.url}</span></span>
                  {s.ok ? <Tag tone="ok">OK · {s.lastSuccess}</Tag> : <Tag tone="bad">{s.error}</Tag>}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Shell>
  );
}
