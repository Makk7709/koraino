import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { CRITERIA } from "../labels";
import type { Weights } from "./weights";

const AXIS_LABEL = {
  importance: "Importance",
  nouveaute: "Nouveauté",
  territoire: "Territoire",
  lecteurs: "Lecteurs",
  diffusion: "Diffusion",
} as const;

/** Profil de la grille active vs le brouillon en cours (panneau sombre). */
export function GridRadar({
  active,
  draft,
  version,
  changed,
}: {
  active: Weights;
  draft: Weights;
  version: number;
  changed: boolean;
}) {
  const data = CRITERIA.map((k) => ({ axis: AXIS_LABEL[k], active: active[k], draft: draft[k] }));
  const max = Math.max(40, ...CRITERIA.map((k) => Math.max(active[k], draft[k])));
  return (
    <section className="kora-night-panel flex flex-col p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Profil de la grille</h2>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded bg-kora-line" /> Version active v{version}
            </span>
            {changed && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px] bg-kora-aurora" /> Brouillon
              </span>
            )}
          </div>
        </div>
        <span className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/80">
          Somme des poids = 100 %
        </span>
      </header>
      <div className="mt-1 h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="rgba(255,255,255,0.14)" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: "rgba(226,240,245,0.8)", fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, max]} tick={false} axisLine={false} />
            <Radar
              dataKey="active"
              stroke="var(--kora-line)"
              strokeWidth={2}
              fill="var(--kora-line)"
              fillOpacity={changed ? 0.06 : 0.22}
              strokeDasharray={changed ? "4 3" : undefined}
              dot={{ r: 2.5, fill: "var(--kora-line)", strokeWidth: 0 }}
              isAnimationActive={false}
            />
            {changed && (
              <Radar
                dataKey="draft"
                stroke="var(--kora-aurora)"
                strokeWidth={2}
                fill="var(--kora-aurora)"
                fillOpacity={0.28}
                dot={{ r: 3, fill: "var(--kora-aurora)", strokeWidth: 0 }}
                isAnimationActive={false}
              />
            )}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
