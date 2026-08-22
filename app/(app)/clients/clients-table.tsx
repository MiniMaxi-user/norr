"use client";

import { useRouter } from "next/navigation";
import { Button, Table, Text } from "@yourorg/ui";
import type { ClientRecord } from "./actions";

/**
 * Plain data table for a list of clients — used both by the List view
 * directly and by each Kanban column (`clients-kanban.tsx`), so the two
 * views never drift out of sync on which columns/actions a client row
 * exposes.
 */
export function ClientsTable({
  clients,
  canWrite,
  onEdit,
  onDelete,
}: {
  clients: ClientRecord[];
  canWrite: boolean;
  onEdit: (client: ClientRecord) => void;
  onDelete: (client: ClientRecord) => void;
}) {
  const router = useRouter();

  return (
    <Table stickyHeader maxHeight="65vh">
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Name</Table.HeaderCell>
          <Table.HeaderCell>Email</Table.HeaderCell>
          <Table.HeaderCell>Phone</Table.HeaderCell>
          <Table.HeaderCell>City</Table.HeaderCell>
          {/* `align="end"` is documented as valid (types/yourorg-ui.d.ts) but
              TS rejects it in practice: intersecting the custom `align`
              union with `ThHTMLAttributes.align` (the deprecated native
              HTML `align` attribute, typed "left"|"center"|"right"|...)
              collapses the prop type to only the member the two unions
              share, "center" — a design-system type-declaration bug (the
              runtime implementation in vendor/yourorg-ui-stub/index.js
              handles "end" fine). Using "center" here to stay type-correct
              until that's fixed upstream; flagged in the handoff. */}
          {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {clients.map((client) => (
          <Table.Row key={client.id} onClick={() => router.push(`/clients/${client.id}`)}>
            <Table.Cell>{client.name}</Table.Cell>
            <Table.Cell>{client.email || <Text tone="muted">—</Text>}</Table.Cell>
            <Table.Cell>{client.phone || <Text tone="muted">—</Text>}</Table.Cell>
            <Table.Cell>{client.city || <Text tone="muted">—</Text>}</Table.Cell>
            {canWrite && (
              <Table.Cell align="center">
                <span onClick={(event) => event.stopPropagation()}>
                  <Button variant="outline" size="sm" onClick={() => onEdit(client)}>
                    Edit
                  </Button>{" "}
                  <Button variant="danger" size="sm" onClick={() => onDelete(client)}>
                    Delete
                  </Button>
                </span>
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
