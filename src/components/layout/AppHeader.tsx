import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Building2, ChevronDown, FileText, Lightbulb, Radio, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ROLE, formatRelative } from "@/components/kora/labels";
import { api } from "@/lib/api/client";
import { qk, useKoraMutation, useMe, useNotifications, useUsers } from "@/lib/api/hooks";
import type { SearchResult, User } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { HeaderLandscape } from "./Artwork";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserAvatar({
  user,
  className,
}: {
  user: Pick<User, "name" | "avatarUrl">;
  className?: string;
}) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        className={cn("size-9 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#f3c6a5] to-[#b9735a] text-xs font-semibold text-white ring-2 ring-white",
        className,
      )}
    >
      {initials(user.name)}
    </span>
  );
}

const SEARCH_ICON: Record<SearchResult["kind"], typeof Search> = {
  company: Building2,
  signal: Lightbulb,
  article: FileText,
  source: Radio,
};
const SEARCH_GROUP: Record<SearchResult["kind"], string> = {
  company: "Entreprises",
  signal: "Sujets",
  article: "Articles",
  source: "Sources",
};

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useQuery({
    queryKey: qk.search(debounced),
    queryFn: () => api.search(debounced),
    enabled: open && debounced.length >= 2,
  });

  const groups = (results.data ?? []).reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full max-w-[380px] items-center gap-2.5 rounded-xl border border-border bg-white/90 px-3.5 text-left text-[13px] text-muted-foreground shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] transition hover:border-kora-teal-light"
      >
        <Search className="size-4 text-kora-ink-soft" />
        <span className="flex-1 truncate">Rechercher une entreprise, un sujet, une source...</span>
        <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-semibold text-kora-ink-soft">
          ⌘ K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Rechercher une entreprise, un sujet, une source..."
          value={q}
          onValueChange={setQ}
        />
        <CommandList>
          <CommandEmpty>
            {debounced.length < 2 ? "Saisissez au moins 2 caractères." : "Aucun résultat."}
          </CommandEmpty>
          {Object.entries(groups).map(([kind, items]) => (
            <CommandGroup key={kind} heading={SEARCH_GROUP[kind as SearchResult["kind"]]}>
              {items.map((r) => {
                const Icon = SEARCH_ICON[r.kind];
                return (
                  <CommandItem
                    key={`${r.kind}-${r.id}`}
                    value={`${r.title} ${r.subtitle} ${r.id}`}
                    onSelect={() => {
                      setOpen(false);
                      setQ("");
                      void navigate({ href: r.link });
                    }}
                  >
                    <Icon className="text-kora-teal" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-kora-ink">{r.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

function Notifications() {
  const { data = [] } = useNotifications();
  const navigate = useNavigate();
  const unread = data.filter((n) => !n.read).length;
  const markRead = useKoraMutation(() => api.markNotificationsRead(), {
    invalidate: qk.notifications,
  });
  return (
    <Popover
      onOpenChange={(o) => {
        if (!o && unread > 0) markRead.mutate(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-full p-2 text-kora-ink transition hover:bg-white"
        >
          <Bell className="size-[22px]" strokeWidth={1.8} />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-kora-rose ring-2 ring-white" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-bold text-kora-ink">Notifications</p>
          {unread > 0 && <span className="text-xs text-muted-foreground">{unread} non lue(s)</span>}
        </div>
        <ul className="kora-scrollbar max-h-[360px] divide-y overflow-auto">
          {data.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              Aucune notification.
            </li>
          )}
          {data.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                disabled={!n.link}
                onClick={() => n.link && void navigate({ href: n.link })}
                className="flex w-full gap-3 px-4 py-3 text-left transition hover:bg-muted"
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.read ? "bg-border" : "bg-kora-rose",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-kora-ink">{n.title}</span>
                  <span className="block text-xs text-muted-foreground">{n.body}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {formatRelative(n.at)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const me = useMe();
  const users = useUsers();
  const switchUser = useKoraMutation((id: string) => api.switchUser(id), {
    success: (u) => `Connecté en tant que ${u.name}`,
  });
  const user = me.data;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-white/80"
        >
          {user ? <UserAvatar user={user} /> : <span className="size-9 rounded-full bg-muted" />}
          <span className="hidden min-w-0 xl:block">
            <span className="block truncate text-[13px] font-semibold text-kora-ink">
              {user?.name ?? "…"}
            </span>
            <span className="block truncate text-[11px] text-kora-ink-soft">
              {user?.team ?? ""}
            </span>
          </span>
          <ChevronDown className="size-4 text-kora-ink-soft" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {user && (
          <>
            <DropdownMenuLabel>
              <p className="text-sm font-semibold text-kora-ink">{user.name}</p>
              <p className="text-xs font-normal text-muted-foreground">
                {user.roles.map((r) => ROLE[r]).join(" · ")}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground uppercase">
          Changer de profil
        </DropdownMenuLabel>
        {(users.data ?? []).map((u) => (
          <DropdownMenuItem
            key={u.id}
            disabled={u.id === user?.id}
            onSelect={() => switchUser.mutate(u.id)}
            className="gap-2.5"
          >
            <UserAvatar user={u} className="size-7 text-[10px] ring-0" />
            <span className="min-w-0">
              <span className="block truncate text-sm">{u.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {u.roles.map((r) => ROLE[r]).join(" · ")}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppHeader() {
  return (
    <header className="@container/header relative">
      <div className="relative flex h-[78px] items-center gap-5 pl-6">
        <div className="pointer-events-none absolute top-0 right-0 h-full w-[330px] overflow-hidden">
          <HeaderLandscape className="absolute inset-0 h-full w-full" />
          <div className="absolute right-5 bottom-2.5 text-right text-white [text-shadow:0_1px_3px_oklch(0.25_0.06_160/70%)]">
            <p className="text-[13.5px] leading-none font-bold">Grenoble</p>
            <p className="mt-0.5 text-[10px] text-white/90">Alpes d&apos;innovation</p>
          </div>
        </div>

        <div className="relative min-w-0 shrink-0">
          <h1 className="text-[24px] leading-tight font-bold tracking-tight text-kora-ink">
            Inovallée Newsroom IA
          </h1>
          <p className="text-[13.5px] text-kora-ink-soft">De la veille au rayonnement éditorial</p>
        </div>

        <div className="relative flex min-w-0 flex-1 justify-center">
          <GlobalSearch />
        </div>

        <div className="relative flex shrink-0 items-center gap-2">
          <Notifications />
          <UserMenu />
        </div>

        <p className="relative hidden w-[150px] shrink-0 text-[10px] leading-snug text-kora-ink-soft [text-shadow:0_0_6px_white] @min-[1120px]/header:block">
          « Des territoires plus innovants, des humains plus engagés. »
        </p>
        <div aria-hidden className="w-[96px] shrink-0 @min-[1120px]/header:w-[120px]" />
      </div>
    </header>
  );
}
