import { Braces, FileArchive, FileSpreadsheet, KeyRound, LogOut, Scale } from "lucide-react";
import { IconTile, KoraCard } from "@/components/kora/primitives";
import { DownloadLink, Notice } from "@/components/veille/kit";
import { downloadUrl } from "@/lib/api/client";
import type { ExportEntity } from "@/lib/api/types";
import { EXPORT_ENTITY } from "./labels";

const ENTITIES = Object.keys(EXPORT_ENTITY) as ExportEntity[];

function ExportCard({ entity }: { entity: ExportEntity }) {
  const meta = EXPORT_ENTITY[entity];
  return (
    <div className="kora-card flex flex-col p-4">
      <div className="flex items-start gap-3">
        <IconTile icon={meta.icon} tone={meta.tone} size="lg" />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-kora-ink">{meta.label}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-kora-ink-soft">{meta.description}</p>
        </div>
      </div>
      <div className="min-h-3 flex-1" />
      <div className="flex gap-2 border-t border-border/70 pt-3">
        <DownloadLink href={downloadUrl.export(entity, "csv")} className="flex-1">
          <FileSpreadsheet className="size-3.5 text-kora-green" /> CSV
        </DownloadLink>
        <DownloadLink href={downloadUrl.export(entity, "json")} className="flex-1">
          <Braces className="size-3.5 text-kora-blue" /> JSON
        </DownloadLink>
      </div>
    </div>
  );
}

/** Exports & réversibilité (§13). */
export function ExportsTab() {
  return (
    <div className="space-y-4">
      <KoraCard>
        <div className="flex items-center gap-4">
          <IconTile icon={FileArchive} tone="teal" size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-kora-ink">Réversibilité opérationnelle</h2>
            <p className="mt-0.5 text-[12px] text-kora-ink-soft">
              Export standard inclus à la recette et à la sortie : CSV/JSON pour chaque entité. Le
              manifeste décrit les fichiers, leurs relations et le dictionnaire des champs.
            </p>
          </div>
          <DownloadLink
            href={downloadUrl.exportManifest()}
            variant="primary"
            className="h-9 px-4 text-[13px]"
          >
            <FileArchive className="size-4" /> Télécharger le manifeste
          </DownloadLink>
        </div>
      </KoraCard>

      <div className="grid grid-cols-3 gap-4">
        {ENTITIES.map((e) => (
          <ExportCard key={e} entity={e} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Notice tone="gray" icon={KeyRound} title="Secrets exclus">
          Les secrets et identifiants techniques ne figurent pas dans les exports ordinaires ; leur
          restitution ou révocation suit un canal sécurisé.
        </Notice>
        <Notice tone="gray" icon={Scale} title="Droits des tiers">
          Les extraits de tiers ne sont exportés que dans la limite des droits de conservation et de
          redistribution.
        </Notice>
        <Notice tone="gray" icon={LogOut} title="Fin de service">
          Export fourni sous dix jours ouvrés, accès de récupération pendant trente jours, puis
          suppression des données actives. La réversibilité porte sur les données et configurations
          documentées, pas sur la plateforme.
        </Notice>
      </div>
    </div>
  );
}
