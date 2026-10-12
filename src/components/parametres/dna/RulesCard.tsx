import { Check, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CountBadge,
  GhostButton,
  IconTile,
  KoraCard,
  PrimaryButton,
} from "@/components/kora/primitives";
import { formatRelative } from "@/components/kora/labels";
import { IconAction, fieldClass } from "@/components/veille/kit";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { EditorialRule, RuleKind } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { RULE_KIND, RULE_KINDS } from "../labels";

function RuleRow({ rule, readOnly }: { rule: EditorialRule; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  const update = useKoraMutation(
    (input: { text?: string; active?: boolean }) => api.updateRule(rule.id, input),
    {
      success: (r) =>
        r.active !== rule.active
          ? `Règle ${r.active ? "activée" : "désactivée"}`
          : `Règle mise à jour (v${r.version})`,
      onSuccess: () => setEditing(false),
    },
  );

  return (
    <li className="group flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-secondary/50">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim() && text.trim() !== rule.text) update.mutate({ text: text.trim() });
              else setEditing(false);
            }}
          >
            <Textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              className={cn(fieldClass, "min-h-[3.5rem] resize-y")}
            />
            <div className="flex justify-end gap-1.5">
              <GhostButton
                className="h-7 px-2.5 text-[12px]"
                onClick={() => {
                  setText(rule.text);
                  setEditing(false);
                }}
              >
                <X className="size-3.5" /> Annuler
              </GhostButton>
              <PrimaryButton
                type="submit"
                className="h-7 px-3 text-[12px]"
                disabled={update.isPending}
              >
                <Check className="size-3.5" /> Enregistrer
              </PrimaryButton>
            </div>
          </form>
        ) : (
          <p
            className={cn(
              "text-[13px] leading-snug text-kora-ink",
              !rule.active && "text-muted-foreground",
            )}
          >
            {rule.text}
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          v{rule.version} · modifiée {formatRelative(rule.updatedAt)} par {rule.updatedBy}
        </p>
      </div>
      {!editing && (
        <IconAction
          icon={Pencil}
          label="Modifier la règle"
          disabled={readOnly}
          onClick={() => {
            setText(rule.text);
            setEditing(true);
          }}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      )}
      <Switch
        checked={rule.active}
        disabled={readOnly || update.isPending}
        onCheckedChange={(v) => update.mutate({ active: v })}
        aria-label={rule.active ? "Désactiver la règle" : "Activer la règle"}
        className="mt-1"
      />
    </li>
  );
}

function AddRuleForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<RuleKind>("ton");
  const [text, setText] = useState("");
  const create = useKoraMutation(
    (input: { kind: RuleKind; text: string }) => api.createRule(input),
    { success: "Règle ajoutée au référentiel éditorial", onSuccess: onDone },
  );
  return (
    <form
      className="mb-3 space-y-2.5 rounded-xl border border-kora-teal-light/60 bg-kora-teal-bg/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) create.mutate({ kind, text: text.trim() });
      }}
    >
      <div className="flex gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as RuleKind)}>
          <SelectTrigger aria-label="Type de règle" className={cn(fieldClass, "h-9 w-44")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RULE_KINDS.map((k) => (
              <SelectItem key={k} value={k} className="text-[13px]">
                {RULE_KIND[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="self-center text-[11px] text-kora-ink-soft">{RULE_KIND[kind].hint}</p>
      </div>
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="ex. Toujours citer la commune d'implantation de l'entreprise dans le chapô."
        className={cn(fieldClass, "min-h-[3.5rem] resize-y")}
      />
      <div className="flex justify-end gap-2">
        <GhostButton className="h-8 text-[12px]" onClick={onDone}>
          Annuler
        </GhostButton>
        <PrimaryButton
          type="submit"
          className="h-8 text-[12px]"
          disabled={!text.trim() || create.isPending}
        >
          <Plus className="size-3.5" /> Ajouter la règle
        </PrimaryButton>
      </div>
    </form>
  );
}

export function RulesCard({ rules, readOnly }: { rules: EditorialRule[]; readOnly: boolean }) {
  const [adding, setAdding] = useState(false);
  const activeCount = rules.filter((r) => r.active).length;
  return (
    <KoraCard
      title="Règles éditoriales"
      badge={<CountBadge value={activeCount} tone="teal" />}
      action={
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {activeCount} active{activeCount > 1 ? "s" : ""} sur {rules.length}
          </span>
          <GhostButton
            className="h-8 px-3 text-[12px]"
            disabled={readOnly || adding}
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" /> Ajouter une règle
          </GhostButton>
        </div>
      }
    >
      {adding && <AddRuleForm onDone={() => setAdding(false)} />}
      <div className="space-y-3">
        {RULE_KINDS.map((kind) => {
          const meta = RULE_KIND[kind];
          const list = rules.filter((r) => r.kind === kind);
          return (
            <section key={kind} className="rounded-xl border border-border/70 bg-white/70 p-2.5">
              <header className="flex items-center gap-2.5 px-1 pb-1.5">
                <IconTile icon={meta.icon} tone={meta.tone} size="sm" />
                <h3 className="text-[13px] font-bold text-kora-ink">{meta.label}</h3>
                <CountBadge value={list.length} tone={meta.tone} />
                <span className="truncate text-[11px] text-muted-foreground">{meta.hint}</span>
              </header>
              {list.length === 0 ? (
                <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
                  Aucune règle de ce type.
                </p>
              ) : (
                <ul>
                  {list.map((r) => (
                    <RuleRow key={`${r.id}-${r.version}`} rule={r} readOnly={readOnly} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </KoraCard>
  );
}
