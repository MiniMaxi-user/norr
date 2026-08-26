"use client";

import { Card, Heading, Stack, Text } from "@yourorg/ui";
import type { ClientRecord, SiteRecord } from "./actions";
import { groupClientsForKanban } from "./kanban";
import { ClientsTable } from "./clients-table";

/**
 * Kanban board — one column per `groupClientsForKanban` stage (see that
 * file for why these particular three groups). Columns render as stacked
 * `Card`s rather than a side-by-side board: the `@yourorg/ui` stub has no
 * non-sticky horizontal row/grid primitive today (`Toolbar` is the only
 * flex-row component, and it's `position: sticky; top: 0`, meant for the
 * one global app topbar — reusing it here would visually collide with the
 * real topbar on scroll). Flagged in the handoff as a design-system gap
 * (a generic `Board`/`Columns` primitive); each column reuses `ClientsTable`
 * so list/kanban never show different columns or actions for a client.
 */
export function ClientsKanban({
  clients,
  canWrite,
  onEdit,
  onDelete,
  primarySiteByClientId,
}: {
  clients: ClientRecord[];
  canWrite: boolean;
  onEdit: (client: ClientRecord) => void;
  onDelete: (client: ClientRecord) => void;
  /** Threaded straight through to `ClientsTable` (each column reuses it),
   * and to `groupClientsForKanban`'s "onboarded" heuristic — see
   * `kanban.ts`. */
  primarySiteByClientId: Record<string, SiteRecord | null>;
}) {
  const columns = groupClientsForKanban(clients, primarySiteByClientId);

  return (
    <Stack gap="lg">
      {columns.map((column) => (
        <Card key={column.stage}>
          <Stack gap="sm">
            <Heading level={3}>
              {column.label} ({column.clients.length})
            </Heading>
            <Text tone="muted">{column.description}</Text>
            {column.clients.length === 0 ? (
              <Text tone="muted">No clients in this stage.</Text>
            ) : (
              <ClientsTable
                clients={column.clients}
                canWrite={canWrite}
                onEdit={onEdit}
                onDelete={onDelete}
                primarySiteByClientId={primarySiteByClientId}
              />
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
