import { createFileRoute } from "@tanstack/react-router";
import { ArticlesPage } from "@/components/articles/ArticlesPage";
import { parseArticlesSearch, type ArticlesSearch } from "@/components/articles/search";

export const Route = createFileRoute("/articles")({
  validateSearch: parseArticlesSearch,
  head: () => ({
    meta: [
      { title: "Articles — Inovallée Newsroom IA" },
      { property: "og:title", content: "Articles — Inovallée Newsroom IA" },
      {
        property: "og:description",
        content: "Editorial Studio : dossiers factuels, brouillons et approbations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      {
        name: "description",
        content: "Editorial Studio : dossiers factuels, brouillons et approbations.",
      },
    ],
  }),
  component: ArticlesRoute,
});

function ArticlesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearch = (patch: ArticlesSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  return <ArticlesPage search={search} onSearch={onSearch} />;
}
