import { createFileRoute } from "@tanstack/react-router";
import { LinkedInPage } from "@/components/linkedin/LinkedInPage";
import { parseLinkedInSearch, type LinkedInSearch } from "@/components/linkedin/search";

export const Route = createFileRoute("/linkedin")({
  validateSearch: parseLinkedInSearch,
  head: () => ({
    meta: [
      { title: "LinkedIn — Inovallée Newsroom IA" },
      { property: "og:title", content: "LinkedIn — Inovallée Newsroom IA" },
      {
        property: "og:description",
        content: "Posts et variantes préparés à partir d'articles approuvés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      {
        name: "description",
        content: "Posts et variantes préparés à partir d'articles approuvés.",
      },
    ],
  }),
  component: LinkedinRoute,
});

function LinkedinRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearch = (patch: LinkedInSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  return <LinkedInPage search={search} onSearch={onSearch} />;
}
