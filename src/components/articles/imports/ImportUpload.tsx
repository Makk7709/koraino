import { FileText, FileUp, ShieldCheck, Upload, X } from "lucide-react";
import { useState, type DragEvent } from "react";
import { PrimaryButton } from "@/components/kora/primitives";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api/client";
import { errorMessage, useKoraMutation } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { formatBytes } from "../format";
import { Banner, CheckItem, Field, inputClass, MintPanel } from "../ui";
import { useUpsertImport } from "./cache";
import { checkImportFile } from "./labels";

function serverMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 413)
    return "Fichier refusé par le serveur : 10 Mo maximum par fichier.";
  if (e instanceof ApiError && e.status === 415)
    return "Format refusé par le serveur : seuls DOCX et texte UTF-8 sont acceptés.";
  return errorMessage(e);
}

/** Dépôt d'un article humain (WF3) : DOCX ou TXT ≤ 10 Mo, auteur obligatoire. */
export function ImportUpload({
  onImported,
  canWrite,
}: {
  onImported: (id: string) => void;
  canWrite: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [author, setAuthor] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const upsert = useUpsertImport();
  const upload = useKoraMutation(
    (v: { file: File; author: string }) => api.importFile(v.file, v.author),
    {
      success: (imp) =>
        `« ${imp.filename} » importé : ${imp.proposals.length} proposition(s) à valider`,
      onSuccess: (imp) => {
        upsert(imp);
        onImported(imp.id);
      },
    },
  );

  const pick = (f: File | undefined) => {
    upload.reset();
    if (!f) return;
    const err = checkImportFile(f);
    setClientError(err);
    setFile(err ? null : f);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    if (canWrite) pick(e.dataTransfer.files[0]);
  };

  const error = clientError ?? (upload.isError ? serverMessage(upload.error) : null);

  return (
    <div className="grid gap-4 min-[1400px]:grid-cols-[minmax(0,1fr)_320px]">
      <section className="kora-card p-4">
        <h2 className="text-[15px] font-bold text-kora-ink">Importer un article humain</h2>
        <p className="mt-0.5 text-[12.5px] text-kora-ink-soft">
          L&apos;original, le texte extrait et les propositions restent distincts ; aucune
          modification n&apos;est appliquée sans votre accord.
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (canWrite) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-9 text-center transition",
            dragging
              ? "border-kora-teal bg-kora-teal-bg"
              : "border-kora-teal-light/60 bg-kora-teal-bg/40 hover:border-kora-teal-light hover:bg-kora-teal-bg/70",
            !canWrite && "pointer-events-none opacity-60",
          )}
        >
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-white text-kora-teal shadow-sm">
            <FileUp className="size-5" />
          </span>
          <p className="mt-3 text-[13.5px] font-semibold text-kora-ink">
            Glissez-déposez le fichier ici, ou{" "}
            <span className="text-kora-teal underline-offset-2 hover:underline">parcourez</span>
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            DOCX ou texte UTF-8 (.txt) · 10 Mo maximum · sans OCR
          </p>
          <input
            type="file"
            accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="sr-only"
            disabled={!canWrite}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>

        {file && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5">
            <FileText className="size-5 text-kora-blue" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-kora-ink">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              aria-label="Retirer le fichier"
              onClick={() => setFile(null)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-kora-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {error && (
          <Banner tone="danger" className="mt-3">
            {error}
          </Banner>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field
            label="Auteur (obligatoire)"
            htmlFor="import-author"
            hint="Nom de la personne qui a rédigé l'article ; il ne sera jamais remplacé."
            className="min-w-[240px] flex-1"
          >
            <Input
              id="import-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              disabled={!canWrite}
              placeholder="Prénom Nom"
              className={inputClass}
            />
          </Field>
          <PrimaryButton
            className="mb-[22px]"
            disabled={!canWrite || !file || !author.trim() || upload.isPending}
            onClick={() => file && upload.mutate({ file, author: author.trim() })}
          >
            <Upload className="size-4" />
            {upload.isPending ? "Analyse en cours…" : "Importer et analyser"}
          </PrimaryButton>
        </div>
      </section>

      <MintPanel title="Human Content Guard" icon={ShieldCheck} className="self-start">
        <ul className="flex flex-col gap-2">
          <CheckItem>Original conservé tel que déposé</CheckItem>
          <CheckItem>Texte extrait présenté séparément</CheckItem>
          <CheckItem>Toute différence textuelle soumise à validation</CheckItem>
          <CheckItem>Auteur nommé jamais remplacé par une attribution automatique</CheckItem>
          <CheckItem>Mise en forme WordPress limitée aux blocs convenus</CheckItem>
        </ul>
      </MintPanel>
    </div>
  );
}
