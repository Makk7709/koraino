import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { LatestSignalsCard } from "./LatestSignalsCard";

/** Onglet « Toutes les actualités » : la table seule, pleine largeur. */
export function AllNewsView() {
  const navigate = useNavigate();
  const open = useCallback(
    (id: string) => void navigate({ to: "/signaux", search: { id, status: "tous" } }),
    [navigate],
  );
  return <LatestSignalsCard selectedId={null} onSelect={open} limit={50} autoSelectFirst={false} />;
}
