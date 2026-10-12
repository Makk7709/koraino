import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell, Tag } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useKora, type Channel, type DraftStatus } from "@/lib/kora-store";

export const Route = createFileRoute("/studio")({
  validateSearch: (s: Record<string, unknown>) => ({ d: typeof s.d === "string" ? s.d : undefined }),
  head: () => ({ meta: [
    { title: "Studio éditorial — KORA Newsroom" },
    { name: "description", content: "Brouillons sourcés, versions et approbations éditoriales." },
    { property: "og:title", content: "Studio éditorial — KORA Newsroom" },
    { property: "og:description", content: "Brouillons sourcés, versions et approbations." },
  ] }),
  component: Studio,
});

export const STATUS: Record<DraftStatus, { l: string; t: "muted" | "warn" | "ok" | "primary" }> = {
  brouillon: { l: "Brouillon", t: "muted" }, en_revue: { l: "En revue", t: "warn" },
  approuve: { l: "Approuvé", t: "ok" }, publie: { l: "Publié", t: "primary" },
};

function Studio() {
  const { drafts, signals, editDraft, submit, approve } = useKora();
  const { d } = Route.useSearch();
  const [sel, setSel] = useState(d ?? drafts[0]?.id);
  useEffect(() => { if (d) setSel(d); }, [d]);
  const draft = drafts.find((x) => x.id === sel);
  const current = draft?.versions[draft.versions.length - 1];
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<Channel>("WordPress");
  useEffect(() => { setText(current?.text ?? ""); }, [current?.n, sel]);
  const sig = draft && signals.find((s) => s.id === draft.signalId);

  return (
    <Shell kicker="Studio · WF2 rédaction assistée" title="Salle de rédaction">
      {drafts.length === 0 ? <p className="text-muted-foreground">Aucun brouillon. Partez d'un signal du <Link to="/" className="text-primary underline">Radar</Link>.</p> : (
      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-1">
          {drafts.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)}
              className={`block w-full p-3 text-left ${sel === x.id ? "bg-foreground text-background" : "bg-card hover:bg-muted"}`}>
              <p className="text-sm font-medium leading-snug">{x.title}</p>
              <p className="label mt-1 opacity-70">{STATUS[x.status].l} · v{x.versions.length}</p>
            </button>
          ))}
        </aside>
        {draft && current && (
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={STATUS[draft.status].t}>{STATUS[draft.status].l}</Tag>
              <span className="font-mono text-xs text-muted-foreground">v{current.n} · {current.by} · {current.at}</span>
            </div>
            <h2 className="font-display mt-2 text-3xl">{draft.title}</h2>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className="mt-4 bg-card font-serif text-base leading-relaxed" />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={text === current.text} onClick={() => editDraft(draft.id, text, "Rédacteur")}>Enregistrer v{current.n + 1}</Button>
              {draft.status === "brouillon" && <Button variant="outline" onClick={() => submit(draft.id)}>Soumettre en revue</Button>}
              {draft.status === "en_revue" && (
                <>
                  <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="h-9 border bg-card px-2 text-sm">
                    <option>WordPress</option><option>LinkedIn</option><option>Newsletter</option>
                  </select>
                  <Button disabled={text !== current.text} onClick={() => approve(draft.id, "Validateur Inovallée", channel)}>Approuver v{current.n}</Button>
                </>
              )}
              {draft.status === "approuve" && <Link to="/publications"><Button>Aller à la publication</Button></Link>}
            </div>
            {draft.status === "approuve" && text !== current.text && (
              <p className="mt-2 text-sm text-destructive">Enregistrer une modification invalidera l'approbation.</p>
            )}
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div>
                <p className="label text-primary">Evidence Pack</p>
                <ul className="mt-2 space-y-1 font-mono text-sm">{sig?.sources.map((s) => <li key={s}>↳ {s}</li>)}</ul>
              </div>
              <div>
                <p className="label text-primary">Historique</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {[...draft.log].reverse().map((l, i) => <li key={i}><span className="font-mono text-xs text-muted-foreground">{l.at}</span> — {l.msg}</li>)}
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>)}
    </Shell>
  );
}
