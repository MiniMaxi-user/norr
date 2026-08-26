"use client";

import { useMemo, useState } from "react";
import { Button, Card, EmptyState, Input, Stack, Text } from "@yourorg/ui";
import { Users } from "@yourorg/ui/icons";
import type { ClientRecord, SiteRecord } from "./actions";
import { ClientsKanban } from "./clients-kanban";
import { ClientsPagination } from "./clients-pagination";
import { ClientsTable } from "./clients-table";
import { DeleteClientDialog } from "./delete-client-dialog";
import { EditClientPanel } from "./edit-client-panel";
import { NewClientPanel } from "./new-client-panel";
import { ViewToggle, type ViewOption } from "./view-toggle";

export type ClientsView = "list" | "kanban";

const VIEW_OPTIONS: readonly ViewOption<ClientsView>[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Kanban" },
];

/**
 * Client component owning all Clients-list interactivity: search/filter
 * (client-side, over the already-fetched page — server-side search is a
 * later improvement per the task spec), the list/kanban view switch, the
 * "Add client" slide-in panel, the "Edit" slide-in panel, and the delete
 * confirmation dialog. As of issue #43, creating a client opens
 * `NewClientPanel` (a `Dialog` `size="panel"`) instead of navigating to a
 * full page; as of issue #46, editing a client opens `EditClientPanel` the
 * same way instead of navigating to the old `/clients/[id]/edit` route
 * (route deleted) — both are explicit, confirmed overrides of this app's
 * usual "Popup vs. full page" default (see docs/ARCHITECTURE.md "Popup vs.
 * full page — pick by weight, not habit", and each panel's own doc comment).
 * `editTarget` mirrors `deleteTarget`'s lifted-dialog pattern: whichever
 * client is currently being edited, or `null` when the panel is closed.
 * `clients`/`count` are fetched once server-side (`clients-board.tsx`) and
 * passed down as props; a delete calls `router.refresh()` (inside the
 * dialog) to re-fetch rather than mutating this component's local copy,
 * keeping this component's own state limited to pure UI state (search text,
 * which view, which client is pending deletion).
 *
 * NOTE on scope: kanban groups the SAME single fetched page as the list
 * view (`pageSize` clients), not the organization's entire client base —
 * paging through the list also changes what the kanban board shows. A
 * board that always reflects every client regardless of the list's current
 * page would need either a much larger unpaginated fetch or a dedicated
 * aggregate endpoint; kept simple for v1 and worth revisiting if kanban
 * becomes a primary way of working rather than a secondary view.
 */
export function ClientsExplorer({
  clients,
  count,
  page,
  pageSize,
  canWrite,
  defaultView,
  primarySiteByClientId,
}: {
  clients: ClientRecord[];
  count: number;
  page: number;
  pageSize: number;
  canWrite: boolean;
  defaultView: ClientsView;
  /** Each client's primary site (or `null` if it has none yet), keyed by
   * `client.id` — see `clients-board.tsx`'s `fetchPrimarySiteByClientId`.
   * Threaded down to both `ClientsTable` and `ClientsKanban` so every
   * standard client overview shows the same primary-address data
   * ("Primary adres is zichtbaar in alle standaardoverzichten"). */
  primarySiteByClientId: Record<string, SiteRecord | null>;
}) {
  const [view, setView] = useState<ClientsView>(defaultView);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);
  const [editTarget, setEditTarget] = useState<ClientRecord | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) => {
      const primarySite = primarySiteByClientId[client.id];
      return [client.name, primarySite?.phone, primarySite?.city].some((field) =>
        (field ?? "").toLowerCase().includes(query),
      );
    });
  }, [clients, search, primarySiteByClientId]);

  if (clients.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Users />}
          heading="No clients yet"
          text="Add your first client to start tracking their sites and assets."
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setNewClientOpen(true)}>
                Add client
              </Button>
            ) : undefined
          }
        />
        {canWrite && <NewClientPanel open={newClientOpen} onOpenChange={setNewClientOpen} />}
      </>
    );
  }

  return (
    <Stack gap="lg">
      <Card>
        <Stack gap="sm">
          <Input
            aria-label="Search clients"
            placeholder="Search by name, phone, or city…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div>
            <ViewToggle moduleKey="clients" value={view} options={VIEW_OPTIONS} onChange={setView} />{" "}
            {canWrite && (
              <Button variant="primary" onClick={() => setNewClientOpen(true)}>
                Add client
              </Button>
            )}
          </div>
        </Stack>
      </Card>

      {filtered.length === 0 ? (
        <Text tone="muted">No clients match &ldquo;{search}&rdquo;.</Text>
      ) : view === "list" ? (
        <ClientsTable
          clients={filtered}
          canWrite={canWrite}
          onEdit={setEditTarget}
          onDelete={setDeleteTarget}
          primarySiteByClientId={primarySiteByClientId}
        />
      ) : (
        <ClientsKanban
          clients={filtered}
          canWrite={canWrite}
          onEdit={setEditTarget}
          onDelete={setDeleteTarget}
          primarySiteByClientId={primarySiteByClientId}
        />
      )}

      <ClientsPagination page={page} pageSize={pageSize} count={count} />

      {canWrite && editTarget && (
        <EditClientPanel
          client={editTarget}
          open={Boolean(editTarget)}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}

      {canWrite && (
        <DeleteClientDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          client={deleteTarget}
        />
      )}

      {canWrite && <NewClientPanel open={newClientOpen} onOpenChange={setNewClientOpen} />}
    </Stack>
  );
}
