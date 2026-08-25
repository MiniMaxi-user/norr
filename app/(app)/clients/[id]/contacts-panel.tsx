"use client";

import { useMemo, useState } from "react";
import { Avatar, Badge, Button, EmptyState, Inline, Stack, Table, Text } from "@yourorg/ui";
import { Users } from "@yourorg/ui/icons";
import type { ContactRecord } from "../contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ContactFormDialog } from "../contact-form-dialog";
import { DeleteContactDialog } from "../delete-contact-dialog";

export interface ContactsPanelProps {
  clientId: string;
  contacts: ContactRecord[];
  /** This org's `contact_role` picklist values — used both to render each
   * contact's role badge and to populate the create/edit dialog's role
   * `<select>`. */
  contactRoles: ReferenceListItemRecord[];
  /** Same "owner only" boundary the client/site write actions use — see
   * `contacts-actions.ts`'s module comment on why Contacts reuses the
   * `clients` module's `can()` checks rather than a separate entry. Passed
   * down as the same `canWrite` value the parent already computed for the
   * client's own Edit/Delete affordances. */
  canWrite: boolean;
}

/**
 * Contacts tab on the Clients detail page (issue #26) — a client's contact
 * persons, created/edited pre-scoped to this client (docs/ARCHITECTURE.md
 * "Relational detail pages": never a bare disconnected form). Same
 * create/edit/delete flow shape as `SitesPanel`, with compound rows (initials
 * `Avatar` + name + a "Primary" `Badge`) rather than plain text, mirroring
 * `clients-table.tsx`'s row style.
 */
export function ContactsPanel({ clientId, contacts, contactRoles, canWrite }: ContactsPanelProps) {
  const [contactForm, setContactForm] = useState<{ open: boolean; contact: ContactRecord | null }>({
    open: false,
    contact: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<ContactRecord | null>(null);

  const roleById = useMemo(
    () => new Map(contactRoles.map((item) => [item.id, item])),
    [contactRoles],
  );

  function openAddContact() {
    setContactForm({ open: true, contact: null });
  }

  return (
    <Stack gap="sm">
      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAddContact}>
            Add contact
          </Button>
        </div>
      )}

      {contacts.length === 0 ? (
        <EmptyState
          icon={<Users />}
          heading="No contacts yet"
          text="Add this client's first point of contact."
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAddContact}>
                Add contact
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Contact</Table.HeaderCell>
              <Table.HeaderCell>Role</Table.HeaderCell>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Phone</Table.HeaderCell>
              {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {contacts.map((contact) => {
              const role = contact.role_item_id ? roleById.get(contact.role_item_id) : undefined;
              return (
                <Table.Row
                  key={contact.id}
                  onClick={canWrite ? () => setContactForm({ open: true, contact }) : undefined}
                >
                  <Table.Cell>
                    <Inline gap="sm">
                      <Avatar name={contact.name} size="sm" />
                      <Inline gap="xs">
                        <Text>{contact.name}</Text>
                        {contact.is_primary && <Badge variant="accent">Primary</Badge>}
                      </Inline>
                    </Inline>
                  </Table.Cell>
                  <Table.Cell>
                    {role ? <Badge color={role.color}>{role.label}</Badge> : <Text tone="muted">—</Text>}
                  </Table.Cell>
                  <Table.Cell>{contact.email || <Text tone="muted">—</Text>}</Table.Cell>
                  <Table.Cell>{contact.phone || <Text tone="muted">—</Text>}</Table.Cell>
                  {canWrite && (
                    <Table.Cell align="center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setContactForm({ open: true, contact });
                        }}
                      >
                        Edit
                      </Button>{" "}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(contact);
                        }}
                      >
                        Delete
                      </Button>
                    </Table.Cell>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      {canWrite && (
        <>
          <ContactFormDialog
            open={contactForm.open}
            onOpenChange={(open) => setContactForm((s) => ({ ...s, open }))}
            clientId={clientId}
            contact={contactForm.contact}
            contactRoles={contactRoles}
          />
          <DeleteContactDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            contact={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}
