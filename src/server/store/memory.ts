import { now } from "../clock";
import { usesDatabase } from "../database";
import type { Collection, Repository } from "./repository";
import type { Settings } from "./records";
import { DbRepository } from "./db";
import { buildSeed, type SeedData } from "./seed";

class MemoryCollection<T extends { id: string }> implements Collection<T> {
  private items = new Map<string, T>();

  constructor(initial: T[]) {
    for (const item of initial) this.items.set(item.id, structuredClone(item));
  }

  async get(id: string) {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async list() {
    return Array.from(this.items.values(), (item) => structuredClone(item));
  }

  async insert(item: T) {
    if (this.items.has(item.id)) throw new Error(`Doublon d'identifiant : ${item.id}`);
    this.items.set(item.id, structuredClone(item));
    return item;
  }

  async update(item: T) {
    if (!this.items.has(item.id)) throw new Error(`Enregistrement absent : ${item.id}`);
    this.items.set(item.id, structuredClone(item));
    return item;
  }

  async remove(id: string) {
    return this.items.delete(id);
  }
}

export class MemoryRepository implements Repository {
  readonly workspaceId: string;
  users;
  companies;
  sources;
  runs;
  observations;
  signals;
  grids;
  articles;
  publications;
  imports;
  linkedin;
  newsletters;
  rules;
  examples;
  ruleProposals;
  usage;
  audit;
  notifications;
  private settings: Settings;
  private counter = 1000;
  private locks = new Map<string, { token: string; expiresAt: number }>();

  constructor(seed: SeedData) {
    this.workspaceId = seed.settings.workspaceId;
    this.users = new MemoryCollection(seed.users);
    this.companies = new MemoryCollection(seed.companies);
    this.sources = new MemoryCollection(seed.sources);
    this.runs = new MemoryCollection(seed.runs);
    this.observations = new MemoryCollection(seed.observations);
    this.signals = new MemoryCollection(seed.signals);
    this.grids = new MemoryCollection(seed.grids);
    this.articles = new MemoryCollection(seed.articles);
    this.publications = new MemoryCollection(seed.publications);
    this.imports = new MemoryCollection(seed.imports);
    this.linkedin = new MemoryCollection(seed.linkedin);
    this.newsletters = new MemoryCollection(seed.newsletters);
    this.rules = new MemoryCollection(seed.rules);
    this.examples = new MemoryCollection(seed.examples);
    this.ruleProposals = new MemoryCollection(seed.ruleProposals);
    this.usage = new MemoryCollection(seed.usage);
    this.audit = new MemoryCollection(seed.audit);
    this.notifications = new MemoryCollection(seed.notifications);
    this.settings = structuredClone(seed.settings);
  }

  async getSettings() {
    return structuredClone(this.settings);
  }

  async saveSettings(settings: Settings) {
    this.settings = structuredClone(settings);
  }

  nextId(prefix: string) {
    this.counter += 1;
    return `${prefix}_n${this.counter}`;
  }

  async acquireLock(key: string, ttlMs: number) {
    const at = now().getTime();
    const held = this.locks.get(key);
    if (held && held.expiresAt > at) return null;
    const token = this.nextId("lock");
    this.locks.set(key, { token, expiresAt: at + ttlMs });
    return token;
  }

  async releaseLock(key: string, token: string) {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }
}

/** Incrémenter quand la forme des enregistrements change : le store est alors réinitialisé. */
const STORE_VERSION = 1;
const GLOBAL_KEY = "__koraNewsroomStore__";

interface Holder {
  version: number;
  repo: MemoryRepository;
  seededAt: string;
}

function holder(): Holder | undefined {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Holder | undefined;
}

/** Dépôt singleton (survit au rechargement à chaud du code serveur). */
export async function getRepository(): Promise<Repository> {
  if (usesDatabase()) {
    const g = globalThis as Record<string, unknown>;
    const db = (g["__koraDb__"] ??= new DbRepository()) as DbRepository;
    await db.ensureReady();
    return db;
  }
  const h = holder();
  if (h && h.version === STORE_VERSION) return h.repo;
  return resetStore();
}

/** Réinitialise le store à partir du seed déterministe (tests, démo). */
export function resetStore(opts: { now?: Date } = {}): Repository {
  const at = opts.now ?? now();
  const repo = new MemoryRepository(buildSeed(at));
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
    version: STORE_VERSION,
    repo,
    seededAt: at.toISOString(),
  } satisfies Holder;
  return repo;
}
