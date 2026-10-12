import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Shell, Tag } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { useKora, type Channel } from "@/lib/kora-store";

export const Route = createFileRoute("/publications")({
  head: () => ({ meta: [
    { title: "Publications — KORA Newsroom" },
    { name: "description", content: "Diffusion contrôlée sur WordPress, LinkedIn et newsletter." },
    { property: "og:title", content: "Publications — KORA Newsroom" },
    { property: "og:description", content: "Diffusion contrôlée, uniquement sur versions approuvées." },
  ] }),
  component: Publications,
});

const channels: Channel[] = ["WordPress", "LinkedIn", "Newsletter"];

function Publications() {
  const { drafts, publish } = useKora();
  const ready = drafts.filter((d) => d.status === "approuve" || d.status === "publie");
  return (
    <Shell kicker="Diffusion · WF4 / WF5" title="File de publication">
      <p className="mb-6 max-w-2xl text-muted-foreground">Seule une version approuvée peut partir. Les droits et l'état sont revérifiés juste avant l'envoi.</p>
      {ready.length === 0 && <p className="text-muted-foreground">Aucun contenu approuvé pour l'instant.</p>}
      <div className="space-y-4">
        {ready.map((d) => (
          <article key={d.id} className="bg-card p-5">
            <h3 className="font-display text-2xl">{d.title}</h3>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {d.approval ? `Approuvé v${d.approval.version} par ${d.approval.by} · ${d.approval.at} · canal ${d.approval.channel}` : "Approbation invalidée"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {channels.map((c) => d.publishedOn.includes(c) ? <Tag key={c} tone="ok">{c} · publié</Tag> : (
                <Button key={c} variant="outline" size="sm" onClick={() => {
                  const r = publish(d.id, c);
                  r.ok ? toast.success(`Publié sur ${c}`) : toast.error(`Envoi bloqué : ${r.reason}`);
                }}>Publier sur {c}</Button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Shell>
  );
}
