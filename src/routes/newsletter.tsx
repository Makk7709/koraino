import { createFileRoute } from "@tanstack/react-router";
import { NewsletterPage } from "@/components/newsletter/NewsletterPage";
import { parseNewsletterSearch, type NewsletterSearch } from "@/components/newsletter/search";

export const Route = createFileRoute("/newsletter")({
  validateSearch: parseNewsletterSearch,
  head: () => ({
    meta: [
      { title: "Newsletter — Inovallée Newsroom IA" },
      { property: "og:title", content: "Newsletter — Inovallée Newsroom IA" },
      { property: "og:description", content: "Sélection hebdomadaire, ordre, résumés et export." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { name: "description", content: "Sélection hebdomadaire, ordre, résumés et export." },
    ],
  }),
  component: NewsletterRoute,
});

function NewsletterRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearch = (patch: NewsletterSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  return <NewsletterPage search={search} onSearch={onSearch} />;
}
