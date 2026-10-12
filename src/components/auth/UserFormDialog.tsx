import { Save, UserCog, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { ROLE } from "@/components/kora/labels";
import { ROLE_TONE } from "@/components/parametres/labels";
import { Field, InlineError, KoraDialog, Notice, fieldClass } from "@/components/veille/kit";
import { ApiError } from "@/lib/api/client";
import { useCreateUser, useUpdateUser } from "@/lib/api/hooks";
import type { AuthMode, Role, User } from "@/lib/api/types";
import { accountError, invitationFeedback } from "@/lib/auth/accounts";
import { emailProblem } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";

const ROLES: Role[] = ["admin", "redacteur", "validateur", "lecteur"];

const ROLE_HINT: Record<Role, string> = {
  admin: "Registre, sources, grille de score, comptes et quotas.",
  redacteur: "Brouillons, imports humains, posts LinkedIn, newsletters.",
  validateur: "Approbation par canal et version, rejet motivé.",
  lecteur: "Consultation seule.",
};

interface FormState {
  name: string;
  email: string;
  team: string;
  roles: Role[];
}

const fromUser = (user: User | null): FormState => ({
  name: user?.name ?? "",
  email: user?.email ?? "",
  team: user?.team ?? "",
  roles: user?.roles ?? ["redacteur"],
});

/** Ajout (invitation) ou modification d'un compte KORA. */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
  currentUserId,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` : création. */
  user: User | null;
  currentUserId: string | undefined;
  mode: AuthMode | null;
}) {
  const editing = user !== null;
  const self = editing && user.id === currentUserId;
  const [form, setForm] = useState<FormState>(() => fromUser(user));
  const [submitted, setSubmitted] = useState(false);
  const create = useCreateUser();
  const update = useUpdateUser();
  const mutation = editing ? update : create;
  const resetCreate = create.reset;
  const resetUpdate = update.reset;

  useEffect(() => {
    if (!open) return;
    setForm(fromUser(user));
    setSubmitted(false);
    resetCreate();
    resetUpdate();
  }, [open, user, resetCreate, resetUpdate]);

  const emailTaken = create.error instanceof ApiError && create.error.code === "email_taken";
  const errors = {
    name: form.name.trim() ? null : "Le nom est obligatoire.",
    email: editing
      ? null
      : (emailProblem(form.email) ?? (emailTaken ? "Adresse déjà utilisée par un compte." : null)),
    roles: form.roles.length ? null : "Attribuez au moins un rôle.",
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const lockedAdmin = self && user.roles.includes("admin");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (mutation.error) mutation.reset();
  };
  const toggleRole = (role: Role, checked: boolean) =>
    set("roles", checked ? [...form.roles, role] : form.roles.filter((r) => r !== role));

  const submit = () => {
    setSubmitted(true);
    if (errors.name || errors.roles || (!editing && emailProblem(form.email))) return;
    const roles = ROLES.filter((r) => form.roles.includes(r));
    const name = form.name.trim();
    const team = form.team.trim();
    if (editing) {
      update.mutate(
        { id: user.id, input: { name, team, roles } },
        {
          onSuccess: (u) => {
            toast.success(`Compte de ${u.name} mis à jour.`);
            onOpenChange(false);
          },
        },
      );
      return;
    }
    const email = form.email.trim().toLowerCase();
    create.mutate(
      { name, email, roles, ...(team ? { team } : {}) },
      {
        onSuccess: (res) => {
          const feedback = invitationFeedback(res.invitation, res.user.email, res.message);
          const title = `${res.user.name} a été ajouté(e) à KORA.`;
          if (feedback.tone === "warning") toast.warning(title, { description: feedback.text });
          else toast.success(title, { description: feedback.text });
          onOpenChange(false);
        },
      },
    );
  };

  const serverError = mutation.error
    ? accountError(mutation.error, editing ? "Modification impossible" : "Ajout impossible")
    : null;

  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={editing ? UserCog : UserPlus}
      tone="purple"
      title={editing ? `Modifier ${user.name}` : "Ajouter un utilisateur"}
      description={
        editing
          ? "Nom, équipe et rôles. L'adresse e-mail identifie le compte et ne se modifie pas."
          : mode === "supabase"
            ? "La personne reçoit un e-mail d'invitation pour choisir son mot de passe."
            : "Mode démonstration : le compte est créé sans invitation par e-mail."
      }
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={() => onOpenChange(false)}>Annuler</GhostButton>
          <PrimaryButton type="submit" disabled={mutation.isPending}>
            {editing ? <Save className="size-4" /> : <UserPlus className="size-4" />}
            {mutation.isPending
              ? "Enregistrement…"
              : editing
                ? "Enregistrer"
                : mode === "supabase"
                  ? "Ajouter et inviter"
                  : "Ajouter"}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Nom complet" htmlFor="user-name" required error={show("name")}>
          <Input
            id="user-name"
            autoComplete="off"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ex. Camille Martin"
            aria-invalid={show("name") ? true : undefined}
            className={cn(fieldClass, show("name") && "border-kora-rose/60")}
          />
        </Field>
        <Field label="Équipe" htmlFor="user-team">
          <Input
            id="user-team"
            autoComplete="off"
            value={form.team}
            onChange={(e) => set("team", e.target.value)}
            placeholder="ex. Communication"
            className={fieldClass}
          />
        </Field>
        <Field
          label="Adresse e-mail"
          htmlFor="user-email"
          required={!editing}
          error={show("email")}
          className="col-span-2"
          hint={editing ? undefined : "Adresse professionnelle utilisée pour se connecter."}
        >
          <Input
            id="user-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            value={form.email}
            readOnly={editing}
            disabled={editing}
            onChange={(e) => set("email", e.target.value)}
            placeholder="prenom.nom@inovallee.fr"
            aria-invalid={show("email") ? true : undefined}
            className={cn(fieldClass, show("email") && "border-kora-rose/60")}
          />
        </Field>

        <fieldset className="col-span-2 space-y-1.5" aria-describedby="user-roles-help">
          <legend className="text-[12px] font-semibold text-kora-ink">
            Rôles<span className="ml-0.5 text-kora-rose">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((role) => {
              const checked = form.roles.includes(role);
              const disabled = role === "admin" && lockedAdmin;
              return (
                <label
                  key={role}
                  htmlFor={`user-role-${role}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border bg-white px-3 py-2.5 transition",
                    checked ? "border-kora-teal-light bg-kora-teal-bg/60" : "border-border",
                    disabled && "cursor-not-allowed opacity-70",
                  )}
                >
                  <Checkbox
                    id={`user-role-${role}`}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(v) => toggleRole(role, v === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <Pill tone={ROLE_TONE[role]} size="sm">
                      {ROLE[role]}
                    </Pill>
                    <span className="mt-1 block text-[11px] leading-snug text-kora-ink-soft">
                      {ROLE_HINT[role]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p
            id="user-roles-help"
            className={cn(
              "text-[11px]",
              show("roles") ? "font-medium text-kora-rose" : "text-muted-foreground",
            )}
          >
            {show("roles") ??
              (lockedAdmin
                ? "Vous ne pouvez pas retirer votre propre rôle d'administrateur."
                : "Un cumul de rôles est possible ; le profil Lecteur reste en lecture seule.")}
          </p>
        </fieldset>
      </div>

      <div className="mt-4 space-y-2.5">
        {serverError && <InlineError title={serverError.title}>{serverError.message}</InlineError>}
        {!editing && mode === "supabase" && (
          <Notice tone="gray" icon={UserPlus}>
            Si un compte de connexion existe déjà pour cette adresse, il est rattaché sans nouvel
            e-mail, à condition que l&apos;adresse ait été confirmée.
          </Notice>
        )}
      </div>
    </KoraDialog>
  );
}
