"use client";

import { useMemo, useState } from "react";
import { Button, Card, EmptyState, Input, Stack, Text } from "@yourorg/ui";
import { Users } from "@yourorg/ui/icons";
import type { ClientRecord } from "./actions";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientsKanban } from "./clients-kanban";
import { ClientsPagination } from "./clients-pagination";
import { ClientsTable } from "./clients-table";
import { DeleteClientDialog } from "./delete-client-dialog";
import { ViewToggle, type ViewOption } from "./view-toggle";

export type ClientsView = "list" | "kanban";

const VIEW_OPTIONS: readonly ViewOption<ClientsView>[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Kanban" },
];

/**
 * Client component owning all Clients-list interactivity: search/filter
 * (client-side, over the already-fetched page — server-side search is a
 * later improvement per the task spec), the list/kanban view switch, and
 * the create/edit/delete dialogs. `clients`/`count` are fetched once
 * server-side (`clients-board.tsx`) and passed down as props; every
 * mutation calls `router.refresh()` (inside the dialogs) to re-fetch rather
 * than mutating this component's local copy, keeping this component's own
 * state limited to pure UI state (search text, which view, which dialog is
 * open).
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
}: {
  clients: ClientRecord[];
  count: number;
  page: number;
  pageSize: number;
  canWrite: boolean;
  defaultView: ClientsView;
}) {
  const [view, setView] = useState<ClientsView>(defaultView);
  const [search, setSearch] = useState("");
  const [formState, setFormState] = useState<{ open: boolean; client: ClientRecord | null }>({
    open: false,
    client: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) =>
      [client.name, client.email, client.phone, client.city].some((field) =>
        (field ?? "").toLowerCase().includes(query),
      ),
    );
  }, [clients, search]);

  function openCreate() {
    setFormState({ open: true, client: null });
  }

  function openEdit(client: ClientRecord) {
    setFormState({ open: true, client });
  }

  if (clients.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Users />}
          heading="No clients yet"
          text="Add your first client to start tracking their sites and assets."
          action={
            canWrite ? (
              <Button variant="primary" onClick={openCreate}>
                Add client
              </Button>
            ) : undefined
          }
        />
        {canWrite && (
          <ClientFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            client={formState.client}
          />
        )}
      </>
    );
  }

  return (
    <Stack gap="lg">
      <Card>
        <Stack gap="sm">
          <Input
            aria-label="Search clients"
            placeholder="Search by name, email, phone, or city…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div>
            <ViewToggle moduleKey="clients" value={view} options={VIEW_OPTIONS} onChange={setView} />{" "}
            {canWrite && (
              <Button variant="primary" onClick={openCreate}>
                Add client
              </Button>
            )}
          </div>
        </Stack>
      </Card>

      {filtered.length === 0 ? (
        <Text tone="muted">No clients match &ldquo;{search}&rdquo;.</Text>
      ) : view === "list" ? (
        <ClientsTable clients={filtered} canWrite={canWrite} onEdit={openEdit} onDelete={setDeleteTarget} />
      ) : (
        <ClientsKanban clients={filtered} canWrite={canWrite} onEdit={openEdit} onDelete={setDeleteTarget} />
      )}

      <ClientsPagination page={page} pageSize={pageSize} count={count} />

      {canWrite && (
        <>
          <ClientFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            client={formState.client}
          />
          <DeleteClientDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            client={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}
