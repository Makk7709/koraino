import {
  CircleCheck,
  Minus,
  Pencil,
  Send,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { UserFormDialog } from "@/components/auth/UserFormDialog";
import { CountBadge, KoraCard, Pill, PrimaryButton } from "@/components/kora/primitives";
import { ROLE, TONE_CLASSES, type Tone } from "@/components/kora/labels";
import {
  ConfirmDialog,
  DataTable,
  ErrorPanel,
  IconAction,
  Notice,
  TableSkeleton,
  Td,
  Th,
  Tr,
} from "@/components/veille/kit";
import { useDeleteUser, useMe, useResendInvitation, useUsers } from "@/lib/api/hooks";
import type { Role, User } from "@/lib/api/types";
import { accountError, invitationFeedback } from "@/lib/auth/accounts";
import { MAX_ACCOUNTS } from "@/lib/auth/limits";
import { useAuth } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { ROLE_TONE } from "./labels";

const ROLES: Role[] = ["admin", "redacteur", "validateur", "lecteur"];
const AVATAR_TONES: Tone[] = ["teal", "blue", "purple", "green", "orange", "rose"];

const RIGHTS = [
  { key: "lecture", label: "Lecture", hint: "Dashboard, signaux, articles, exports et journal." },
  {
    key: "redaction",
    label: "Rédaction",
    hint: "Registre, sources et collecte ; signaux, brouillons, imports humains, posts LinkedIn, newsletters.",
  },
  {
    key: "validation",
    label: "Validation",
    hint: "Approbation par canal et version, rejet motivé, publication et export.",
  },
  {
    key: "administration",
    label: "Administration",
    hint: "Suppression d'entreprise, grille de score, référentiel éditorial, comptes, réglages WordPress.",
  },
] as const;

const MATRIX: Record<Role, Record<(typeof RIGHTS)[number]["key"], boolean>> = {
  admin: { lecture: true, redaction: true, validation: true, administration: true },
  redacteur: { lecture: true, redaction: true, validation: false, administration: false },
  validateur: { lecture: true, redaction: false, validation: true, administration: false },
  lecteur: { lecture: true, redaction: false, validation: false, administration: false },
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function InitialsAvatar({ user }: { user: User }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className="size-9 rounded-full object-cover" />;
  }
  const hash = [...user.id].reduce((h, ch) => h + ch.charCodeAt(0), 0);
  const tone = TONE_CLASSES[AVATAR_TONES[hash % AVATAR_TONES.length] ?? "teal"];
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ring-2 ring-white",
        tone.bg,
        tone.fg,
      )}
    >
      {initials(user.name)}
    </span>
  );
}

function RolePills({ roles }: { roles: Role[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ROLES.filter((r) => roles.includes(r)).map((r) => (
        <Pill key={r} tone={ROLE_TONE[r]} size="sm">
          {ROLE[r]}
        </Pill>
      ))}
    </div>
  );
}

function AccountStatus({ user }: { user: User }) {
  if (user.hasAccount === undefined) return null;
  return (
    <Pill tone={user.hasAccount ? "green" : "amber"} size="sm" className="mt-1">
      {user.hasAccount ? "Compte activé" : "Invitation en attente"}
    </Pill>
  );
}

function AccountsCard() {
  const users = useUsers();
  const me = useMe();
  const { mode } = useAuth();
  const remove = useDeleteUser();
  const invite = useResendInvitation();
  const [dialog, setDialog] = useState<{ open: boolean; user: User | null }>({
    open: false,
    user: null,
  });
  const supabaseMode = mode === "supabase";
  const isAdmin = me.data?.roles.includes("admin") ?? false;
  const adminCount = (users.data ?? []).filter((u) => u.roles.includes("admin")).length;
  const accountCount = users.data?.length;
  const full = accountCount !== undefined && accountCount >= MAX_ACCOUNTS;

  const deleteUser = (u: User) =>
    remove.mutate(u.id, {
      onSuccess: () => toast.success(`${u.name} n'a plus accès à KORA.`),
      onError: (e) => {
        const err = accountError(e, "Suppression impossible");
        toast.error(err.title, { description: err.message });
      },
    });

  const resendInvitation = (u: User) =>
    invite.mutate(u.id, {
      onSuccess: (res) => {
        const feedback = invitationFeedback(res.invitation, u.email, res.message);
        if (feedback.tone === "warning") toast.warning(feedback.text);
        else toast.success(feedback.text);
      },
      onError: (e) => {
        const err = accountError(e, "Invitation non renvoyée");
        toast.error(err.title, { description: err.message });
      },
    });

  return (
    <KoraCard
      className="@container"
      title="Comptes nominatifs"
      badge={users.data && <CountBadge value={users.data.length} tone="teal" />}
      action={
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={cn(
              "text-[11px] text-muted-foreground",
              isAdmin && "hidden whitespace-nowrap @lg:inline",
            )}
          >
            {accountCount === undefined
              ? `${MAX_ACCOUNTS} comptes inclus dans l'abonnement`
              : `${accountCount} / ${MAX_ACCOUNTS} comptes inclus dans l'abonnement`}
          </span>
          {isAdmin && (
            <PrimaryButton
              className="h-8 px-3 text-[12px]"
              disabled={full}
              onClick={() => setDialog({ open: true, user: null })}
            >
              <UserPlus className="size-3.5" />
              Ajouter
            </PrimaryButton>
          )}
        </div>
      }
    >
      {users.error ? (
        <ErrorPanel
          title="Les comptes n'ont pas pu être chargés"
          error={users.error}
          onRetry={() => void users.refetch()}
        />
      ) : !users.data ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <Th>Utilisateur</Th>
              <Th>Équipe</Th>
              <Th>Rôles</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => {
              const current = u.id === me.data?.id;
              const lastAdmin = u.roles.includes("admin") && adminCount <= 1;
              const deleteBlocked = current
                ? "Vous ne pouvez pas supprimer votre propre compte"
                : lastAdmin
                  ? "Dernier administrateur : suppression impossible"
                  : null;
              return (
                <Tr key={u.id} selected={current}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <InitialsAvatar user={u} />
                      <div className="min-w-0">
                        <p className="truncate font-bold">{u.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
                        {supabaseMode && <AccountStatus user={u} />}
                      </div>
                    </div>
                  </Td>
                  <Td className="text-[12px] text-kora-ink-soft">{u.team}</Td>
                  <Td>
                    <RolePills roles={u.roles} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {current && (
                        <Pill tone="teal" size="sm" className="font-semibold">
                          Vous
                        </Pill>
                      )}
                      {isAdmin && (
                        <>
                          <IconAction
                            icon={Pencil}
                            label={`Modifier les rôles de ${u.name}`}
                            onClick={() => setDialog({ open: true, user: u })}
                          />
                          {supabaseMode && u.hasAccount === false && (
                            <IconAction
                              icon={Send}
                              label={`Renvoyer l'invitation à ${u.email}`}
                              disabled={invite.isPending && invite.variables === u.id}
                              onClick={() => resendInvitation(u)}
                            />
                          )}
                          <ConfirmDialog
                            title={`Supprimer le compte de ${u.name} ?`}
                            description={
                              <>
                                {u.name} ({u.email}) n&apos;aura plus accès à KORA et sa connexion
                                LinkedIn sera retirée. Ses contenus et le journal d&apos;audit sont
                                conservés.
                                {supabaseMode &&
                                  " Le compte de connexion n'est pas supprimé : il ne donne simplement plus accès à KORA."}
                              </>
                            }
                            confirmLabel="Supprimer"
                            onConfirm={() => deleteUser(u)}
                            trigger={
                              <IconAction
                                icon={Trash2}
                                tone="danger"
                                label={deleteBlocked ?? `Supprimer le compte de ${u.name}`}
                                disabled={!!deleteBlocked || remove.isPending}
                              />
                            }
                          />
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      {isAdmin && full && (
        <Notice tone="amber" icon={Users} title="Nombre de comptes atteint" className="mt-3">
          L&apos;abonnement inclut {MAX_ACCOUNTS} comptes et ils sont tous attribués, invitations en
          attente comprises. Supprimez un compte pour en ajouter un autre.
        </Notice>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        {supabaseMode ? (
          <>
            Chaque personne se connecte avec son propre compte. Un nouvel utilisateur reçoit une
            invitation par e-mail pour choisir son mot de passe.
          </>
        ) : (
          <>
            Pour vérifier les droits d&apos;un autre profil, utilisez « Changer de profil » dans le
            menu utilisateur en haut à droite.
          </>
        )}
      </p>
      {isAdmin && (
        <UserFormDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          user={dialog.user}
          currentUserId={me.data?.id}
          mode={mode}
        />
      )}
    </KoraCard>
  );
}

function RightsMatrix() {
  const me = useMe();
  const roles = me.data?.roles ?? [];
  const selfApproval = roles.includes("redacteur") && roles.includes("validateur");
  return (
    <KoraCard title="Droits par rôle">
      <DataTable>
        <thead>
          <tr>
            <Th>Rôle</Th>
            {RIGHTS.map((r) => (
              <Th key={r.key} className="text-center" title={r.hint}>
                {r.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROLES.map((role) => (
            <Tr key={role} selected={roles.includes(role)}>
              <Td>
                <Pill tone={ROLE_TONE[role]}>{ROLE[role]}</Pill>
              </Td>
              {RIGHTS.map((r) => (
                <Td key={r.key} className="text-center">
                  {MATRIX[role][r.key] ? (
                    <CircleCheck className="mx-auto size-[18px] fill-kora-green text-white" />
                  ) : (
                    <Minus className="mx-auto size-4 text-border" />
                  )}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </DataTable>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {RIGHTS.map((r) => (
          <div key={r.key}>
            <dt className="text-[12px] font-semibold text-kora-ink">{r.label}</dt>
            <dd className="text-[11px] text-kora-ink-soft">{r.hint}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 space-y-2">
        <Notice tone="blue" icon={Users} title="Cumul de rôles">
          Un cumul de rôles est possible sur décision d&apos;Inovallée ; il ne constitue pas une
          séparation à deux personnes. Le profil Lecteur reste en lecture seule.
        </Notice>
        {selfApproval && (
          <Notice tone="amber" icon={ShieldAlert}>
            Votre compte cumule <strong>Rédacteur</strong> et <strong>Validateur</strong> : une
            approbation donnée sur votre propre contenu ne vaut pas double contrôle.
          </Notice>
        )}
      </div>
    </KoraCard>
  );
}

/** Utilisateurs & rôles (§7). */
export function UsersRolesTab() {
  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-4">
      <AccountsCard />
      <RightsMatrix />
    </div>
  );
}
