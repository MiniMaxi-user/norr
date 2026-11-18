"use client";

import { useMemo, useState } from "react";
import { WebButton } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import type { ContactRecord } from "../contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ContactFormDialog } from "../components/contact-form-dialog";
import { DeleteContactDialog } from "../components/delete-contact-dialog";

export interface ContactsPanelProps {
  clientId: string;
  contacts: ContactRecord[];
  /** This org's `contact_role` picklist values — used both to render each
   * contact's role and to populate the create/edit dialog's role `<select>`. */
  contactRoles: ReferenceListItemRecord[];
  /** Same "owner only" boundary the client/site write actions use — see
   * `contacts-actions.ts`'s module comment on why Contacts reuses the
   * `clients` module's `can()` checks rather than a separate entry. */
  canWrite: boolean;
}

/**
 * Contacts tab on the Clients detail page (issue #26; design-system table
 * pattern, issue #222): ONE card with a FilterBar and a sortable table.
 * "+ Contact" lives in the FilterBar; edit (row click / ··· menu) and delete
 * (··· menu) reuse the existing dialogs, pre-scoped to this client.
 */
export function ContactsPanel({ clientId, contacts, contactRoles, canWrite }: ContactsPanelProps) {
  const [contactForm, setContactForm] = useState<{ open: boolean; contact: ContactRecord | null }>({
    open: false,
    contact: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<ContactRecord | null>(null);

  const roleById = useMemo(() => new Map(contactRoles.map((item) => [item.id, item])), [contactRoles]);
  const roleLabel = (contact: ContactRecord) =>
    (contact.role_item_id ? roleById.get(contact.role_item_id)?.label : undefined) ?? "";

  function openAddContact() {
    setContactForm({ open: true, contact: null });
  }

  const columns = useMemo<WebColumn<ContactRecord>[]>(
    () => [
      {
        id: "name",
        header: "Contact",
        primary: true,
        sortValue: (contact) => contact.name,
        render: (contact) => (
          <>
            {contact.name}
            {contact.is_primary ? <span className="web-muted-cell"> · Primary</span> : null}
          </>
        ),
      },
      {
        id: "role",
        header: "Role",
        sortValue: (contact) => roleLabel(contact),
        render: (contact) => roleLabel(contact) || "—",
      },
      { id: "email", header: "Email", sortValue: (contact) => contact.email ?? "", render: (c) => c.email || "—" },
      { id: "phone", header: "Phone", render: (contact) => contact.phone || "—" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleById],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "role",
        label: "Role",
        getOptions: (contact: ContactRecord) => {
          const label = contact.role_item_id ? roleById.get(contact.role_item_id)?.label : undefined;
          return label && contact.role_item_id ? [{ value: contact.role_item_id, label }] : [];
        },
      },
    ],
    [roleById],
  );

  const segment = useMemo(
    () => ({
      label: "Show contacts",
      defaultValue: "all",
      options: [
        { value: "primary", label: "Primary", match: (contact: ContactRecord) => contact.is_primary },
        { value: "others", label: "Others", match: (contact: ContactRecord) => !contact.is_primary },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  function rowActions(contact: ContactRecord): WebMenuItem[] {
    if (!canWrite) return [];
    return [
      { key: "edit", label: "Edit contact", onSelect: () => setContactForm({ open: true, contact }) },
      { key: "delete", label: "Delete contact", danger: true, onSelect: () => setDeleteTarget(contact) },
    ];
  }

  return (
    <>
      <WebDataTableCard
        title="Contacts"
        meta={String(contacts.length)}
        rows={contacts}
        getRowKey={(contact) => contact.id}
        columns={columns}
        searchText={(contact) => [contact.name, roleLabel(contact), contact.email, contact.phone].filter(Boolean).join(" ")}
        noun="contacts"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="contacts"
        defaultSort={{ columnId: "name", direction: "asc" }}
        onRowClick={canWrite ? (contact) => setContactForm({ open: true, contact }) : undefined}
        rowActions={canWrite ? rowActions : undefined}
        rowLabel={(contact) => contact.name}
        add={
          canWrite ? (
            <WebButton size="filter" onClick={openAddContact}>
              + Contact
            </WebButton>
          ) : undefined
        }
        emptyAction={
          canWrite ? (
            <button type="button" className="web-rail-link" onClick={openAddContact}>
              Add contact
            </button>
          ) : undefined
        }
      />

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
    </>
  );
}
