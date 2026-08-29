"use client";

import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Inline, Stack, Table, Text } from "@yourorg/ui";
import { MapPin, Phone } from "@yourorg/ui/icons";
import type { ClientRecord, SiteRecord } from "../actions";

/**
 * Plain data table for a list of clients — used both by the List view
 * directly and by each Kanban column (`clients-kanban.tsx`), so the two
 * views never drift out of sync on which columns/actions a client row
 * exposes.
 *
 * Rows are compound cells rather than one-value-per-column plain text —
 * an initials avatar + "client since" meta under the name, contact info
 * grouped with its icon, the primary site's city/country combined into one
 * location cell (with a "Primary" badge — issue #41 redo, "Primary adres
 * is zichtbaar in alle standaardoverzichten"), and an at-a-glance "profile"
 * badge.
 */
export function ClientsTable({
  clients,
  canWrite,
  onEdit,
  onDelete,
  primarySiteByClientId,
}: {
  clients: ClientRecord[];
  canWrite: boolean;
  /** Opens `EditClientPanel` for this client — lifted up to whichever parent
   * owns that panel's open/state (`ClientsExplorer`), mirroring `onDelete`'s
   * existing lifted-dialog pattern (issue #46). */
  onEdit: (client: ClientRecord) => void;
  onDelete: (client: ClientRecord) => void;
  /** Each client's primary site (or `null`), keyed by `client.id` — see
   * `clients-explorer.tsx`. `ClientRecord` itself no longer carries any
   * address fields (issue #41 redo, "Sites as client addresses"). */
  primarySiteByClientId: Record<string, SiteRecord | null>;
}) {
  const router = useRouter();

  return (
    <Table stickyHeader maxHeight="65vh">
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Name</Table.HeaderCell>
          <Table.HeaderCell>Phone</Table.HeaderCell>
          <Table.HeaderCell>Location</Table.HeaderCell>
          <Table.HeaderCell>Profile</Table.HeaderCell>
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
        {clients.map((client) => {
          const primarySite = primarySiteByClientId[client.id] ?? null;
          const location = primarySite ? [primarySite.city, primarySite.country].filter(Boolean).join(", ") : "";
          const hasAddress = Boolean(primarySite);

          return (
            <Table.Row key={client.id} onClick={() => router.push(`/clients/${client.id}`)}>
              <Table.Cell>
                <Inline gap="sm">
                  <Avatar name={client.name} size="sm" />
                  <Stack gap="xs">
                    <Text>{client.name}</Text>
                    <Text tone="muted">{formatClientSince(client.created_at)}</Text>
                  </Stack>
                </Inline>
              </Table.Cell>
              <Table.Cell>
                {primarySite?.phone ? (
                  <Inline gap="xs">
                    <Phone aria-hidden />
                    <Text>{primarySite.phone}</Text>
                  </Inline>
                ) : (
                  <Text tone="muted">No phone</Text>
                )}
              </Table.Cell>
              <Table.Cell>
                {location ? (
                  <Inline gap="xs" align="center">
                    <MapPin aria-hidden />
                    <Text>{location}</Text>
                    <Badge variant="accent">Primary</Badge>
                  </Inline>
                ) : (
                  <Text tone="muted">—</Text>
                )}
              </Table.Cell>
              <Table.Cell>
                <Badge variant={hasAddress ? "success" : "muted"}>
                  {hasAddress ? "Address on file" : "No address"}
                </Badge>
              </Table.Cell>
              {canWrite && (
                <Table.Cell align="center">
                  <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={() => onEdit(client)}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => onDelete(client)}>
                      Delete
                    </Button>
                  </span>
                </Table.Cell>
              )}
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}

function formatClientSince(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return `Client since ${date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
