"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Heading, Stack, Table, Text } from "@yourorg/ui";
import { Users } from "@yourorg/ui/icons";
import type { ClientRecord, SiteRecord } from "../actions";
import { ClientFormDialog } from "../client-form-dialog";
import { DeleteClientDialog } from "../delete-client-dialog";
import { DeleteSiteDialog } from "../delete-site-dialog";
import { SiteFormDialog } from "../site-form-dialog";

/**
 * Client detail: the client's own fields plus its sites, with inline
 * create/edit/delete for both (same Dialog-form pattern as the list page).
 * This is where a user would eventually add assets to a site, but that's
 * the Assets module's job (`app/(app)/assets/**`, not built yet at the page
 * level) — no asset-adding UI or deep link lives here.
 */
export function ClientDetail({
  client,
  sites,
  canWrite,
}: {
  client: ClientRecord;
  sites: SiteRecord[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [siteForm, setSiteForm] = useState<{ open: boolean; site: SiteRecord | null }>({
    open: false,
    site: null,
  });
  const [deleteSiteTarget, setDeleteSiteTarget] = useState<SiteRecord | null>(null);

  function openAddSite() {
    setSiteForm({ open: true, site: null });
  }

  return (
    <Stack gap="lg">
      <div>
        <Link href="/clients">&larr; Back to clients</Link>
      </div>

      <Card>
        <Stack gap="md">
          <Heading level={1}>{client.name}</Heading>
          {canWrite && (
            <div>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                Edit
              </Button>{" "}
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            </div>
          )}

          <Stack gap="xs">
            <DetailRow label="Email" value={client.email} />
            <DetailRow label="Phone" value={client.phone} />
            <DetailRow label="Address" value={formatAddress(client)} />
            <DetailRow label="Notes" value={client.notes} />
          </Stack>
        </Stack>
      </Card>

      <Stack gap="sm">
        <Heading level={2}>Sites</Heading>
        {canWrite && (
          <div>
            <Button variant="primary" size="sm" onClick={openAddSite}>
              Add site
            </Button>
          </div>
        )}

        {sites.length === 0 ? (
          <EmptyState
            icon={<Users />}
            heading="No sites yet"
            text="Add this client's first site to begin tracking equipment there."
            action={
              canWrite ? (
                <Button variant="primary" onClick={openAddSite}>
                  Add site
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Address</Table.HeaderCell>
                <Table.HeaderCell>City</Table.HeaderCell>
                {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {sites.map((site) => (
                <Table.Row key={site.id}>
                  <Table.Cell>{site.name}</Table.Cell>
                  <Table.Cell>{site.address_line1 || <Text tone="muted">—</Text>}</Table.Cell>
                  <Table.Cell>{site.city || <Text tone="muted">—</Text>}</Table.Cell>
                  {canWrite && (
                    <Table.Cell align="center">
                      <Button variant="outline" size="sm" onClick={() => setSiteForm({ open: true, site })}>
                        Edit
                      </Button>{" "}
                      <Button variant="danger" size="sm" onClick={() => setDeleteSiteTarget(site)}>
                        Delete
                      </Button>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Stack>

      {canWrite && (
        <>
          <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
          <DeleteClientDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            client={client}
            onDeleted={() => router.push("/clients")}
          />
          <SiteFormDialog
            open={siteForm.open}
            onOpenChange={(open) => setSiteForm((s) => ({ ...s, open }))}
            clientId={client.id}
            site={siteForm.site}
          />
          <DeleteSiteDialog
            open={Boolean(deleteSiteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteSiteTarget(null);
            }}
            site={deleteSiteTarget}
          />
        </>
      )}
    </Stack>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <Text tone="muted">{label}</Text>
      <Text>{value || "—"}</Text>
    </div>
  );
}

function formatAddress(client: ClientRecord): string | null {
  const cityLine = [client.postal_code, client.city].filter(Boolean).join(" ");
  const parts = [client.address_line1, client.address_line2, cityLine, client.country].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(", ") : null;
}
