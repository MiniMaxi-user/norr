"use client";

import { useRouter } from "next/navigation";
import { Button } from "@yourorg/ui";
import { useClientsView, type ClientsView } from "./clients-hero-context";
import { ViewToggle, type ViewOption } from "./view-toggle";

const VIEW_OPTIONS: readonly ViewOption<ClientsView>[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Kanban" },
];

/**
 * The `OverviewHeroBand`'s `actions` slot (issue #142) — `ViewToggle` plus
 * "Add client", rendered above `Suspense` in `page.tsx` so they no longer
 * wait on `listClients`/`listAccountManagers`/`listPrimarySitesForClients`
 * (neither needs fetched client data, only `canWrite` and the current view,
 * both known synchronously). `view` comes from `ClientsHeroProvider` so
 * flipping it still drives `ClientsExplorer`'s table/kanban render inside
 * `Suspense` — see `clients-hero-context.tsx`.
 */
export function ClientsHeroActions({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [view, setView] = useClientsView();

  return (
    <>
      <ViewToggle moduleKey="clients" value={view} options={VIEW_OPTIONS} onChange={setView} />
      {canWrite && (
        <Button variant="primary" onClick={() => router.push("/clients/new")}>
          Add client
        </Button>
      )}
    </>
  );
}
