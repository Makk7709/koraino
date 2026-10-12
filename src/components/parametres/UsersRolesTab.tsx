import { CircleCheck, Minus, ShieldAlert, Users } from "lucide-react";
import { CountBadge, KoraCard, Pill } from "@/components/kora/primitives";
import { ROLE, TONE_CLASSES, type Tone } from "@/components/kora/labels";
import { DataTable, ErrorPanel, Notice, TableSkeleton, Td, Th, Tr } from "@/components/veille/kit";
import { useMe, useUsers } from "@/lib/api/hooks";
import type { Role, User } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ROLE_TONE } from "./labels";

const INCLUDED_ACCOUNTS = 5;
const ROLES: Role[] = ["admin", "redacteur", "validateur", "lecteur"];
const AVATAR_TONES: Tone[] = ["teal", "blue", "purple", "green", "orange", "rose"];

const RIGHTS = [
  { key: "lecture", label: "Lecture", hint: "Dashboard, signaux, articles, exports et journal." },
  {
    key: "redaction",
    label: "Rédaction",
    hint: "Brouillons, imports humains, posts LinkedIn, newsletters.",
  },
  {
    key: "validation",
    label: "Validation",
    hint: "Approbation par canal et version, rejet motivé.",
  },
  {
    key: "administration",
    label: "Administration",
    hint: "Registre, sources, grille de score, référentiel, comptes et quotas.",
  },
] as const;

const MATRIX: Record<Role, Record<(typeof RIGHTS)[number]["key"], boolean>> = {
  admin: { lecture: true, redaction: false, validation: false, administration: true },
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

function AccountsCard() {
  const users = useUsers();
  const me = useMe();
  return (
    <KoraCard
      title="Comptes nominatifs"
      badge={users.data && <CountBadge value={users.data.length} tone="teal" />}
      action={
        <span className="text-[11px] text-muted-foreground">
          {INCLUDED_ACCOUNTS} comptes inclus dans l&apos;abonnement
        </span>
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
              return (
                <Tr key={u.id} selected={current}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <InitialsAvatar user={u} />
                      <div className="min-w-0">
                        <p className="truncate font-bold">{u.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-[12px] text-kora-ink-soft">{u.team}</Td>
                  <Td>
                    <RolePills roles={u.roles} />
                  </Td>
                  <Td className="text-right">
                    {current && (
                      <Pill tone="teal" size="sm" className="font-semibold">
                        Vous
                      </Pill>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Pour vérifier les droits d&apos;un autre profil, utilisez « Changer de profil » dans le menu
        utilisateur en haut à droite.
      </p>
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
