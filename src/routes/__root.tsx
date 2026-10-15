import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { AuthGate } from "../components/auth/AuthGate";
import { AppLayout } from "../components/layout/AppLayout";
import { Toaster } from "../components/ui/sonner";
import appCss from "../styles.css?url";
import { isAuthPage } from "../lib/auth/redirect";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="kora-card max-w-md px-8 py-10 text-center">
        <h1 className="text-6xl font-bold text-kora-teal">404</h1>
        <h2 className="mt-3 text-lg font-semibold text-kora-ink">Page introuvable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette page n&apos;existe pas ou a été déplacée.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="kora-btn-primary inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
          >
            Retour au dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="kora-card max-w-md px-8 py-10 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-kora-ink">
          Cette page n&apos;a pas pu se charger
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Une erreur est survenue. Vous pouvez réessayer ou revenir au dashboard.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="kora-btn-primary inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="inline-flex h-9 items-center rounded-lg border bg-white px-4 text-sm font-medium text-kora-ink"
          >
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Inovallée Newsroom IA — KORA" },
      {
        name: "description",
        content:
          "De la veille au rayonnement éditorial : signaux scorés, rédaction sourcée et diffusion maîtrisée.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <QueryClientProvider client={queryClient}>
      {isAuthPage(pathname) ? (
        <Outlet />
      ) : (
        <AuthGate>
          <AppLayout>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </AppLayout>
        </AuthGate>
      )}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
