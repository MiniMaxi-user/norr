"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Board, Button, Inline, Select, Stack, Text } from "@yourorg/ui";
import { MapPin } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import { updateClient, type ClientRecord, type SiteRecord } from "./actions";
import { CLIENT_STATUS_OPTIONS, formatPotentialValue, groupClientsForKanban, type ClientStatus } from "./kanban";

/** Cards beyond this count in a column collapse behind a "+ N more" toggle
 * (per-column `useState`, plain and simple) — the kanban fetches an
 * unpaginated client list (`clients-board.tsx`, up to 200), so without a cap
 * a busy "Lead" column could otherwise dump 40+ cards down the page at once. */
const CARDS_PER_COLUMN = 5;

/**
 * Kanban board (issue #58) — one column per `groupClientsForKanban`'s 4
 * fixed `clients.status` values, rendered on the new `Board`/`Board.Column`/
 * `Board.Card` design-system primitive (`packages/ui/src/components/board.tsx`)
 * instead of the old stacked-`ClientsTable` workaround this file used to
 * document as a design-system gap — that gap is now filled.
 *
 * Owns all of the kanban's own interactivity: native HTML5 drag-and-drop
 * (no new npm dependency, matching this codebase's stated minimal-dependency
 * philosophy — see `dropdown-menu.tsx`'s own comment about avoiding a Radix
 * dependency for exactly this kind of interaction) for moving a client
 * between status columns, and each column's "+ N more" expand toggle.
 *
 * Drag-and-drop is optimistic: `clientsState` (a local copy of the `clients`
 * prop, re-synced via `useEffect` whenever the prop changes — e.g. a
 * `router.refresh()` from elsewhere) moves the dragged client to its new
 * column immediately, before `updateClient` resolves; a failure reverts the
 * local move and surfaces `dragError`. `router.refresh()` still runs after a
 * successful update to reconcile the Server Component's own data (matching
 * `EditClientPanel`'s existing post-success pattern) — the optimistic move
 * just means the UI doesn't wait on that round trip to feel instant.
 */
export function ClientsKanban({
  clients,
  canWrite,
  primarySiteByClientId,
  accountManagers,
}: {
  clients: ClientRecord[];
  canWrite: boolean;
  /** Threaded straight through from `clients-explorer.tsx` — see that file
   * and `clients-board.tsx`'s `fetchPrimarySiteByClientId`. */
  primarySiteByClientId: Record<string, SiteRecord | null>;
  /** Every account manager in this org, fetched once in `clients-board.tsx`
   * and passed down — built into an id -> record lookup below so each
   * card's Account Manager row can resolve a name without its own fetch. */
  accountManagers: AccountManagerRecord[];
}) {
  const router = useRouter();
  const [clientsState, setClientsState] = useState(clients);
  const [dragError, setDragError] = useState<string | null>(null);
  const [expandedColumns, setExpandedColumns] = useState<Record<ClientStatus, boolean>>({
    lead: false,
    qualified: false,
    proposal: false,
    won: false,
  });

  useEffect(() => {
    setClientsState(clients);
  }, [clients]);

  const accountManagerById = useMemo(
    () => new Map(accountManagers.map((manager) => [manager.id, manager])),
    [accountManagers],
  );

  const columns = useMemo(() => groupClientsForKanban(clientsState), [clientsState]);

  function toggleExpanded(status: ClientStatus) {
    setExpandedColumns((prev) => ({ ...prev, [status]: !prev[status] }));
  }

  function handleDragStart(event: DragEvent<HTMLElement>, clientId: string) {
    event.dataTransfer.setData("text/plain", clientId);
    event.dataTransfer.effectAllowed = "move";
  }

  /** Shared by both the drag-and-drop drop handler AND the per-card Status
   * `<Select>` (the non-drag alternative — a card that can ONLY be moved by
   * dragging would be a real keyboard-accessibility trap, same class of gap
   * as this app's already-tracked issue #34). Same optimistic-move-then-
   * revert-on-failure behavior either way — the two entry points differ only
   * in how they learn `clientId`/`newStatus`, not in what happens next. */
  async function moveClient(clientId: string, newStatus: ClientStatus) {
    const client = clientsState.find((candidate) => candidate.id === clientId);
    if (!client || (client.status as ClientStatus) === newStatus) return;

    const previousStatus = client.status;
    setDragError(null);
    setClientsState((prev) => prev.map((c) => (c.id === clientId ? { ...c, status: newStatus } : c)));

    const result = await updateClient(clientId, { status: newStatus });
    if (result.error || !result.data) {
      // Revert the optimistic move — the server rejected the status change
      // (permission, validation, transient failure, ...).
      setClientsState((prev) => prev.map((c) => (c.id === clientId ? { ...c, status: previousStatus } : c)));
      setDragError(result.error ?? "Could not move this client.");
      return;
    }
    router.refresh();
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>, newStatus: ClientStatus) {
    event.preventDefault();
    if (!canWrite) return;

    const clientId = event.dataTransfer.getData("text/plain");
    if (!clientId) return;

    void moveClient(clientId, newStatus);
  }

  return (
    <Stack gap="sm">
      {dragError && <Text tone="danger">{dragError}</Text>}
      <Board>
        {columns.map((column) => {
          const isExpanded = expandedColumns[column.status];
          const hasMore = column.clients.length > CARDS_PER_COLUMN;
          const visibleClients = isExpanded ? column.clients : column.clients.slice(0, CARDS_PER_COLUMN);

          return (
            <Board.Column
              key={column.status}
              label={column.label}
              count={column.clients.length}
              subtitle={`Potential ${formatPotentialValue(column.totalPotentialValue)}`}
              accentColor={column.accentColor}
              tint={column.tint}
              onDragOver={(event) => {
                if (canWrite) event.preventDefault();
              }}
              onDrop={(event) => {
                void handleDrop(event, column.status);
              }}
            >
              {column.clients.length === 0 ? (
                <Text tone="muted">No clients in this stage.</Text>
              ) : (
                <Stack gap="sm">
                  {visibleClients.map((client) => (
                    <ClientKanbanCard
                      key={client.id}
                      client={client}
                      canWrite={canWrite}
                      city={primarySiteByClientId[client.id]?.city ?? null}
                      accountManager={
                        client.account_manager_id ? accountManagerById.get(client.account_manager_id) ?? null : null
                      }
                      onDragStart={(event) => handleDragStart(event, client.id)}
                      onOpen={() => router.push(`/clients/${client.id}`)}
                      onStatusChange={(newStatus) => void moveClient(client.id, newStatus)}
                    />
                  ))}
                  {hasMore && (
                    <Button variant="ghost" size="sm" onClick={() => toggleExpanded(column.status)}>
                      {isExpanded ? "Show less" : `+ ${column.clients.length - CARDS_PER_COLUMN} more`}
                    </Button>
                  )}
                </Stack>
              )}
            </Board.Column>
          );
        })}
      </Board>
    </Stack>
  );
}

function ClientKanbanCard({
  client,
  canWrite,
  city,
  accountManager,
  onDragStart,
  onOpen,
  onStatusChange,
}: {
  client: ClientRecord;
  canWrite: boolean;
  city: string | null;
  accountManager: AccountManagerRecord | null;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onOpen: () => void;
  /** The non-drag way to move this card between columns — a plain `<select>`
   * rendered on every card (not just for `!canWrite`, though it's omitted
   * entirely then): drag-and-drop has no keyboard equivalent by nature, so
   * without this a keyboard-only actor could never change a client's status
   * at all, only mouse-drag actors could. Same reasoning `Board.Card`'s own
   * doc comment gives for why THAT needed fixing too. */
  onStatusChange: (newStatus: ClientStatus) => void;
}) {
  return (
    <Board.Card draggable={canWrite} onDragStart={canWrite ? onDragStart : undefined} onClick={onOpen}>
      <Stack gap="sm">
        <Inline gap="sm" align="center">
          <Avatar name={client.name} size="sm" />
          <Stack gap="xs">
            <Text>{client.name}</Text>
            {city && (
              <Inline gap="xs" align="center">
                <MapPin aria-hidden />
                <Text tone="muted">{city}</Text>
              </Inline>
            )}
          </Stack>
        </Inline>

        {client.potential_value !== null && (
          <Inline justify="between" align="center">
            <Text tone="muted">Potential</Text>
            <Text>{formatPotentialValue(client.potential_value)}</Text>
          </Inline>
        )}

        {accountManager && (
          <Inline gap="xs" align="center">
            <Avatar name={`${accountManager.first_name} ${accountManager.last_name}`} size="sm" />
            <Text tone="muted">
              {accountManager.first_name} {accountManager.last_name}
            </Text>
          </Inline>
        )}

        {canWrite && (
          <Select
            aria-label={`Move ${client.name} to a different status`}
            value={client.status}
            // Both handlers stop the click/keydown from bubbling up to the
            // card's own `onClick`/Enter-Space handling — without this,
            // interacting with the select would also "open" the card.
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => onStatusChange(event.target.value as ClientStatus)}
          >
            {CLIENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Stack>
    </Board.Card>
  );
}
