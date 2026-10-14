/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WordPressSettings } from "@/lib/api/types";
import { now } from "../clock";
import type { Collection, Repository } from "./repository";
import type { Settings } from "./records";
import { buildSeed } from "./seed";
import { WORDPRESS_SETTINGS, wordpressSettingsOf } from "./settings";

/**
 * Dépôt persistant (base PostgreSQL du projet) : une ligne par enregistrement dans
 * `public.kora_records` (collection, id, data jsonb) et les paramètres dans `public.kora_settings`.
 * Accès serveur uniquement (clé de service).
 */
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

class DbCollection<T extends { id: string }> implements Collection<T> {
  constructor(private name: string) {}

  async get(id: string) {
    const { data, error } = await (
      await db()
    )
      .from("kora_records")
      .select("data")
      .eq("collection", this.name)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.data as T | undefined) ?? undefined;
  }

  async list() {
    const out: T[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await (
        await db()
      )
        .from("kora_records")
        .select("data")
        .eq("collection", this.name)
        .order("created_at")
        .range(from, from + page - 1);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []).map((r) => r.data as T));
      if (!data || data.length < page) break;
    }
    return out;
  }

  async insert(item: T) {
    const { error } = await (
      await db()
    )
      .from("kora_records")
      .insert({ collection: this.name, id: item.id, data: item as never });
    if (error) throw new Error(error.message);
    return item;
  }

  async update(item: T) {
    const { error } = await (
      await db()
    )
      .from("kora_records")
      .update({ data: item as never, updated_at: new Date().toISOString() })
      .eq("collection", this.name)
      .eq("id", item.id);
    if (error) throw new Error(error.message);
    return item;
  }

  async remove(id: string) {
    const { error, count } = await (
      await db()
    )
      .from("kora_records")
      .delete({ count: "exact" })
      .eq("collection", this.name)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
}

const WORKSPACE = "kora";

/** Collection interne des verrous : jamais listée ni exportée. */
const LOCKS = "locks";
/** `unique_violation` PostgreSQL, renvoyé tel quel par PostgREST / supabase-js. */
const UNIQUE_VIOLATION = "23505";

interface LockRow {
  id: string;
  token: string;
  expiresAt: string;
}

export class DbRepository implements Repository {
  readonly workspaceId = WORKSPACE;
  users = new DbCollection<any>("users");
  companies = new DbCollection<any>("companies");
  sources = new DbCollection<any>("sources");
  runs = new DbCollection<any>("runs");
  observations = new DbCollection<any>("observations");
  signals = new DbCollection<any>("signals");
  grids = new DbCollection<any>("grids");
  articles = new DbCollection<any>("articles");
  publications = new DbCollection<any>("publications");
  imports = new DbCollection<any>("imports");
  linkedin = new DbCollection<any>("linkedin");
  newsletters = new DbCollection<any>("newsletters");
  rules = new DbCollection<any>("rules");
  examples = new DbCollection<any>("examples");
  ruleProposals = new DbCollection<any>("ruleProposals");
  usage = new DbCollection<any>("usage");
  audit = new DbCollection<any>("audit");
  notifications = new DbCollection<any>("notifications");

  private ready: Promise<void> | null = null;

  /**
   * Première utilisation : installe la configuration (grille, règles, réglages), sans aucune
   * donnée de démo ni utilisateur : le premier administrateur s'amorce par `KORA_ADMIN_EMAILS`.
   */
  ensureReady(): Promise<void> {
    this.ready ??= (async () => {
      const { data, error } = await (
        await db()
      )
        .from("kora_settings")
        .select("workspace_id")
        .eq("workspace_id", WORKSPACE)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return;
      const seed = buildSeed(new Date());
      const rows = [
        ...seed.grids.map((d) => ({ collection: "grids", id: d.id, data: d })),
        ...seed.rules.map((d) => ({ collection: "rules", id: d.id, data: d })),
      ];
      const client = await db();
      const ins = await client.from("kora_records").upsert(rows as never);
      if (ins.error) throw new Error(ins.error.message);
      const settings: Settings = {
        ...seed.settings,
        reservedEur: 0,
        notifiedAlerts: [],
      };
      const s = await client
        .from("kora_settings")
        .upsert({ workspace_id: WORKSPACE, data: settings as never });
      if (s.error) throw new Error(s.error.message);
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async getSettings() {
    const { data, error } = await (
      await db()
    )
      .from("kora_settings")
      .select("data")
      .eq("workspace_id", WORKSPACE)
      .single();
    if (error) throw new Error(error.message);
    return data.data as unknown as Settings;
  }

  /**
   * L'ancien `wordpress` est retiré de la ligne écrite. Il n'est recopié dans l'enregistrement
   * dédié que par insertion (jamais par-dessus une correspondance déjà enregistrée), et avant
   * d'être retiré : un échec laisse l'ancienne ligne intacte.
   */
  async saveSettings(settings: Settings) {
    const { wordpress: legacy, ...rest } = settings;
    const client = await db();
    if (legacy !== undefined) {
      const { error } = await client.from("kora_records").insert({
        ...WORDPRESS_SETTINGS,
        data: wordpressSettingsOf(legacy) as never,
      });
      if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
    }
    const { error } = await client.from("kora_settings").upsert({
      workspace_id: WORKSPACE,
      data: rest as never,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async getWordPressSettings() {
    const client = await db();
    const { data, error } = await client
      .from("kora_records")
      .select("data")
      .eq("collection", WORDPRESS_SETTINGS.collection)
      .eq("id", WORDPRESS_SETTINGS.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return wordpressSettingsOf(data.data);
    const legacy = await client
      .from("kora_settings")
      .select("data")
      .eq("workspace_id", WORKSPACE)
      .maybeSingle();
    if (legacy.error) throw new Error(legacy.error.message);
    return wordpressSettingsOf((legacy.data?.data as Settings | undefined)?.wordpress);
  }

  async saveWordPressSettings(settings: WordPressSettings) {
    const { error } = await (await db()).from("kora_records").upsert(
      {
        ...WORDPRESS_SETTINGS,
        data: settings as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "collection,id" },
    );
    if (error) throw new Error(error.message);
  }

  nextId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;
  }

  /**
   * Insertion sans upsert : la clé primaire (collection, id) garantit un seul détenteur.
   * Un verrou expiré n'est supprimé que s'il est inchangé (même jeton, même échéance),
   * puis l'insertion est retentée une seule fois.
   */
  async acquireLock(key: string, ttlMs: number) {
    const client = await db();
    const token = crypto.randomUUID();
    const insert = async () => {
      const lock: LockRow = {
        id: key,
        token,
        expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
      };
      const { error } = await client
        .from("kora_records")
        .insert({ collection: LOCKS, id: key, data: lock as never });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(error.message);
    };
    if (await insert()) return token;

    const { data, error } = await client
      .from("kora_records")
      .select("data")
      .eq("collection", LOCKS)
      .eq("id", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const held = data?.data as LockRow | undefined;
    if (held) {
      if (Date.parse(held.expiresAt) > now().getTime()) return null;
      const stale = await client
        .from("kora_records")
        .delete()
        .eq("collection", LOCKS)
        .eq("id", key)
        .eq("data->>token", held.token)
        .eq("data->>expiresAt", held.expiresAt);
      if (stale.error) throw new Error(stale.error.message);
    }
    return (await insert()) ? token : null;
  }

  /** Upsert sur la clé primaire (collection, id) : la ligne en place est écrasée. */
  async replaceLock(key: string, ttlMs: number) {
    const token = crypto.randomUUID();
    const lock: LockRow = {
      id: key,
      token,
      expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
    };
    const { error } = await (await db()).from("kora_records").upsert(
      {
        collection: LOCKS,
        id: key,
        data: lock as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "collection,id" },
    );
    if (error) throw new Error(error.message);
    return token;
  }

  async releaseLock(key: string, token: string) {
    const client = await db();
    const { error } = await client
      .from("kora_records")
      .delete()
      .eq("collection", LOCKS)
      .eq("id", key)
      .eq("data->>token", token);
    if (error) throw new Error(error.message);
  }
}
