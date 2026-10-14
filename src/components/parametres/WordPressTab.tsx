import {
  CircleAlert,
  CircleCheck,
  FlaskConical,
  Info,
  ListTree,
  PlugZap,
  RotateCcw,
  Save,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { GhostButton, KoraCard, Pill, PrimaryButton } from "@/components/kora/primitives";
import { CATEGORY, WORDPRESS_MODE, formatDateTime, type Tone } from "@/components/kora/labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BlockSkeleton,
  DataTable,
  ErrorPanel,
  ExternalAnchor,
  InlineError,
  Notice,
  TableSkeleton,
  Td,
  Th,
  Tr,
  usePermissions,
} from "@/components/veille/kit";
import {
  errorMessage,
  useSaveWordPressSettings,
  useWordPressCategories,
  useWordPressCheck,
  useWordPressStatus,
} from "@/lib/api/hooks";
import type { WordPressCheck, WordPressStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  NO_CATEGORY,
  buildWordPressSettings,
  categoryOptions,
  checkVerdict,
  decodeSlug,
  initialMapping,
  sameSettings,
  setupVariables,
  wordpressRoleLabel,
  type CategoryOption,
} from "./wordpress";

const VERDICT_ICON: Partial<Record<Tone, ComponentType<{ className?: string }>>> = {
  green: CircleCheck,
  amber: ShieldAlert,
  rose: CircleAlert,
  blue: Info,
};

const CATEGORY_TONE = new Map(Object.values(CATEGORY).map((c) => [c.label, c.tone]));

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-white/80 px-1.5 py-px font-mono text-[11px] text-kora-ink ring-1 ring-border/70">
      {children}
    </code>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-kora-teal-bg text-[11px] font-bold text-kora-teal"
      >
        {n}
      </span>
      <div className="min-w-0 text-[12px] leading-relaxed text-kora-ink-soft">
        <p className="text-[12.5px] font-semibold text-kora-ink">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** Procédure de mise en route quand la configuration serveur est absente ou incomplète. */
function SetupProcedure({ missing }: { missing: string[] }) {
  const variables = setupVariables(missing);
  return (
    <div className="space-y-3">
      <Notice tone="rose" icon={TriangleAlert} title="Envoi vers WordPress désactivé">
        Tant que la connexion au site n&apos;est pas configurée, aucun brouillon ne peut être
        envoyé. Procédure à suivre par un administrateur :
      </Notice>
      <ol className="space-y-3" aria-label="Procédure de configuration">
        <Step n={1} title="Créer un compte WordPress dédié à KORA">
          Dans l&apos;administration WordPress (Comptes ou Utilisateurs › Ajouter), créez un
          utilisateur réservé à KORA avec le rôle <strong>Contributeur</strong> : il peut créer des
          brouillons, mais ni publier, ni programmer, ni téléverser de médias.
        </Step>
        <Step n={2} title="Générer un mot de passe d'application">
          Connecté avec ce compte, ouvrez <strong>Profil › Mots de passe d&apos;application</strong>
          , donnez un nom (par exemple « KORA ») puis générez le mot de passe. Il n&apos;est affiché
          qu&apos;une fois : copiez-le directement dans le secret de l&apos;étape 3, sans le
          transmettre par e-mail ni messagerie.
        </Step>
        <Step n={3} title="Renseigner les secrets de l'hébergement">
          Dans les secrets du serveur (console de l&apos;hébergement), renseignez :
          <ul className="mt-1.5 space-y-1.5">
            {variables.map((v) => (
              <li key={v.name} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Code>{v.name}</Code>
                <Pill tone={v.missing ? "rose" : "green"} size="sm">
                  {v.missing ? "Manquante ou invalide" : "Renseignée"}
                </Pill>
                {v.hint && <span className="basis-full text-[11.5px]">{v.hint}</span>}
              </li>
            ))}
          </ul>
        </Step>
        <Step n={4} title="Vérifier la connexion">
          Une fois les secrets enregistrés (et l&apos;application redéployée si l&apos;hébergement
          l&apos;exige), rechargez cette page : le mode doit indiquer « Site configuré ». Lancez
          ensuite « Tester la connexion ».
        </Step>
      </ol>
    </div>
  );
}

function CheckResult({ check, at }: { check: WordPressCheck; at: number }) {
  const verdict = checkVerdict(check);
  return (
    <Notice
      tone={verdict.tone}
      icon={VERDICT_ICON[verdict.tone] ?? Info}
      title={verdict.title}
      className={cn(verdict.tone === "amber" && "border-kora-amber/40")}
    >
      {check.account && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Compte</dt>
          <dd className="font-medium text-kora-ink">
            {check.account.name}{" "}
            <span className="font-normal text-muted-foreground">(n° {check.account.id})</span>
          </dd>
          <dt className="text-muted-foreground">Rôles</dt>
          <dd className="flex flex-wrap gap-1">
            {check.account.roles?.length ? (
              check.account.roles.map((r) => (
                <Pill key={r} tone={r === "contributor" ? "green" : "gray"} size="sm">
                  {wordpressRoleLabel(r)}
                </Pill>
              ))
            ) : (
              <span className="text-muted-foreground">non communiqués par le site</span>
            )}
          </dd>
        </dl>
      )}
      {verdict.detail && <p className="mt-1.5">{verdict.detail}</p>}
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {check.error?.code && <Code>{check.error.code}</Code>}
        <span>Test effectué le {formatDateTime(new Date(at).toISOString())}</span>
      </p>
    </Notice>
  );
}

/** Test réel du compte sur le site : lancé uniquement par le bouton (aucun appel automatique). */
function ConnectionTest() {
  const [requested, setRequested] = useState(false);
  const check = useWordPressCheck(requested);
  const run = () => (requested ? void check.refetch() : setRequested(true));
  return (
    <section aria-labelledby="wp-check-title" className="mt-4 border-t border-border/70 pt-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="wp-check-title" className="text-[13px] font-bold text-kora-ink">
            Test de connexion
          </h3>
          <p className="text-[11.5px] text-muted-foreground">
            Vérifie l&apos;identifiant, le mot de passe d&apos;application et le rôle du compte,
            sans rien écrire sur le site.
          </p>
        </div>
        <PrimaryButton
          className="h-8 px-3 text-[12px]"
          disabled={check.isFetching}
          aria-busy={check.isFetching || undefined}
          onClick={run}
        >
          <PlugZap className="size-3.5" aria-hidden />
          {check.isFetching ? "Test en cours…" : "Tester la connexion"}
        </PrimaryButton>
      </div>
      <div aria-live="polite" className="mt-2.5 empty:hidden">
        {check.isFetching ? null : check.error ? (
          <ErrorPanel title="Le test n'a pas pu être lancé" error={check.error} />
        ) : check.data ? (
          <CheckResult check={check.data} at={check.dataUpdatedAt} />
        ) : null}
      </div>
    </section>
  );
}

function ConnectionCard({ status, isAdmin }: { status: WordPressStatus; isAdmin: boolean }) {
  const mode = WORDPRESS_MODE[status.mode];
  return (
    <KoraCard
      title="Connexion au site"
      badge={
        <Pill tone={mode.tone} size="sm">
          {mode.label}
        </Pill>
      }
    >
      {status.mode === "reel" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Site</dt>
          <dd className="min-w-0 truncate font-medium">
            {status.site ? <ExternalAnchor href={status.site}>{status.site}</ExternalAnchor> : "—"}
          </dd>
          <dt className="text-muted-foreground">Envoi</dt>
          <dd className="text-kora-ink-soft">Brouillons uniquement, avec le compte configuré.</dd>
        </dl>
      )}
      {status.mode === "simule" && (
        <Notice tone="amber" icon={FlaskConical} title="Mode démonstration">
          Aucun appel au site : les brouillons sont simulés en mémoire, avec quelques catégories
          fictives.
        </Notice>
      )}
      {status.mode === "non_configure" && <SetupProcedure missing={status.missing} />}
      {isAdmin ? (
        <ConnectionTest />
      ) : (
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Le test de connexion et la correspondance des catégories sont réservés aux
          administrateurs.
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        KORA ne publie jamais : il crée et met à jour des brouillons, la mise en ligne reste
        humaine, dans WordPress.
      </p>
    </KoraCard>
  );
}

function CategorySelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  options: CategoryOption[];
  onChange: (slug: string) => void;
}) {
  const known = options.find((o) => o.slug === value);
  const unknown = value !== NO_CATEGORY && !known;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        aria-label={label}
        className="h-8 w-full min-w-[13rem] rounded-lg border-border bg-white px-3 text-[12px] font-medium text-kora-ink focus:ring-kora-teal/40"
      >
        <SelectValue>
          {value === NO_CATEGORY ? (
            <span className="text-muted-foreground">— aucune —</span>
          ) : known ? (
            known.path
          ) : (
            `${decodeSlug(value)} (introuvable sur le site)`
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-lg">
        <SelectItem value={NO_CATEGORY} className="text-[12px] text-muted-foreground">
          — aucune —
        </SelectItem>
        {unknown && (
          <SelectItem value={value} className="text-[12px] text-kora-rose">
            {decodeSlug(value)} (introuvable sur le site)
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem
            key={o.slug}
            value={o.slug}
            aria-label={o.path}
            className={cn("text-[12px]", o.depth === 0 && "font-medium")}
            style={{ paddingLeft: `${0.5 + o.depth * 1}rem` }}
          >
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SlugText({ slug }: { slug: string | null | undefined }) {
  if (!slug || slug === NO_CATEGORY)
    return <span className="text-muted-foreground">— aucune —</span>;
  return <span className="font-mono text-[11.5px] text-kora-ink">{decodeSlug(slug)}</span>;
}

/**
 * Correspondance catégories KORA → catégories WordPress (par slug, résolu à l'envoi : les
 * identifiants diffèrent entre préproduction et production). Édition réservée aux admins.
 */
function CategoryMappingCard({ status, isAdmin }: { status: WordPressStatus; isAdmin: boolean }) {
  const kora = status.koraCategories;
  const [mapping, setMapping] = useState(() => initialMapping(kora, status.settings.categoryMap));
  const [fallback, setFallback] = useState(status.settings.defaultCategory ?? NO_CATEGORY);
  const [requested, setRequested] = useState(false);
  const categories = useWordPressCategories(isAdmin && requested);
  const save = useSaveWordPressSettings();
  const options = useMemo(() => categoryOptions(categories.data ?? []), [categories.data]);

  const saved = buildWordPressSettings(
    kora,
    initialMapping(kora, status.settings.categoryMap),
    status.settings.defaultCategory ?? NO_CATEGORY,
  );
  const next = buildWordPressSettings(kora, mapping, fallback);
  const dirty = !sameSettings(saved, next);
  const editing = isAdmin && requested && !!categories.data;
  const notConfigured = status.mode === "non_configure";

  const reset = (s: WordPressStatus) => {
    setMapping(initialMapping(s.koraCategories, s.settings.categoryMap));
    setFallback(s.settings.defaultCategory ?? NO_CATEGORY);
  };

  const action = isAdmin ? (
    editing ? (
      <div className="flex shrink-0 items-center gap-2">
        {dirty && (
          <GhostButton
            className="h-8 px-3 text-[12px]"
            disabled={save.isPending}
            onClick={() => reset(status)}
          >
            <RotateCcw className="size-3.5" aria-hidden /> Annuler
          </GhostButton>
        )}
        <PrimaryButton
          className="h-8 px-3 text-[12px]"
          disabled={!dirty || save.isPending}
          aria-busy={save.isPending || undefined}
          onClick={() => save.mutate(next, { onSuccess: reset })}
        >
          <Save className="size-3.5" aria-hidden />
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </PrimaryButton>
      </div>
    ) : (
      <GhostButton
        className="h-8 px-3 text-[12px]"
        disabled={notConfigured || categories.isFetching}
        title={
          notConfigured
            ? "Configurez d'abord la connexion au site : les catégories WordPress ne peuvent pas être lues."
            : undefined
        }
        onClick={() => (requested ? void categories.refetch() : setRequested(true))}
      >
        <ListTree className="size-3.5" aria-hidden />
        {categories.isFetching ? "Chargement…" : "Modifier la correspondance"}
      </GhostButton>
    )
  ) : null;

  return (
    <KoraCard title="Correspondance des catégories" action={action}>
      <p className="mb-3 text-[11.5px] leading-snug text-muted-foreground">
        À l&apos;envoi, chaque catégorie de l&apos;article est convertie en catégorie WordPress.
        Sans correspondance, KORA cherche une catégorie WordPress de même nom ou de même slug, puis
        applique la catégorie par défaut.
      </p>

      {isAdmin && requested && categories.error ? (
        <ErrorPanel
          className="mb-3"
          title="Les catégories WordPress n'ont pas pu être chargées"
          error={categories.error}
          onRetry={() => void categories.refetch()}
        />
      ) : null}
      {isAdmin && requested && categories.isPending && !categories.error ? (
        <TableSkeleton rows={4} cols={2} />
      ) : kora.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-white/60 px-4 py-5 text-center text-[12.5px] text-muted-foreground">
          Aucune catégorie KORA à associer.
        </p>
      ) : (
        <>
          {editing && options.length === 0 && (
            <Notice tone="amber" className="mb-3">
              Aucune catégorie trouvée sur le site WordPress : seule l&apos;option « — aucune — »
              est disponible.
            </Notice>
          )}
          <DataTable>
            <thead>
              <tr>
                <Th scope="col">Catégorie KORA</Th>
                <Th scope="col">Catégorie WordPress</Th>
              </tr>
            </thead>
            <tbody>
              {kora.map((label) => (
                <Tr key={label}>
                  <Td>
                    <Pill tone={CATEGORY_TONE.get(label) ?? "gray"} size="sm">
                      {label}
                    </Pill>
                  </Td>
                  <Td className="w-[60%]">
                    {editing ? (
                      <CategorySelect
                        label={`Catégorie WordPress pour « ${label} »`}
                        value={mapping[label] ?? NO_CATEGORY}
                        options={options}
                        onChange={(slug) => setMapping((m) => ({ ...m, [label]: slug }))}
                      />
                    ) : (
                      <SlugText slug={mapping[label]} />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}

      <div className="mt-4 flex flex-col gap-1.5 border-t border-border/70 pt-3.5">
        {editing ? (
          <>
            <label
              htmlFor="wp-default-category"
              className="text-[12px] font-semibold text-kora-ink-soft"
            >
              Catégorie par défaut
            </label>
            <CategorySelect
              id="wp-default-category"
              label="Catégorie par défaut"
              value={fallback}
              options={options}
              onChange={setFallback}
            />
          </>
        ) : (
          <p className="text-[12px] font-semibold text-kora-ink-soft">
            Catégorie par défaut :{" "}
            <span className="font-normal">
              <SlugText slug={fallback} />
            </span>
          </p>
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          Utilisée quand aucune catégorie de l&apos;article n&apos;a de correspondance. Sans
          catégorie par défaut, WordPress applique la sienne.
        </p>
      </div>

      {save.error ? (
        <div className="mt-3">
          <InlineError title="Correspondance non enregistrée">
            {errorMessage(save.error)}
          </InlineError>
        </div>
      ) : null}
      {!isAdmin && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Consultation seule : la configuration WordPress est réservée aux administrateurs.
        </p>
      )}
    </KoraCard>
  );
}

/** Paramètres > WordPress : connexion au site, test du compte, correspondance des catégories. */
export function WordPressTab() {
  const status = useWordPressStatus();
  const { isAdmin } = usePermissions();

  if (status.error)
    return (
      <ErrorPanel
        title="La configuration WordPress n'a pas pu être chargée"
        error={status.error}
        onRetry={() => void status.refetch()}
      />
    );
  if (!status.data)
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <BlockSkeleton className="h-56" />
        <BlockSkeleton className="h-72" />
      </div>
    );
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <ConnectionCard status={status.data} isAdmin={isAdmin} />
      <CategoryMappingCard status={status.data} isAdmin={isAdmin} />
    </div>
  );
}
