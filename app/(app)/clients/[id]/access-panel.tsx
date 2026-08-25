"use client";

import { useState } from "react";
import { Avatar, Badge, Button, EmptyState, Inline, Input, Stack, Table, Text } from "@yourorg/ui";
import { ShieldCheck } from "@yourorg/ui/icons";
import type { ContactRecord } from "../contacts-actions";
import {
  inviteTenantOwner,
  resendOrResetTenantAccess,
  type TenantAccessStatus,
} from "../platform-access-actions";

export interface AccessPanelProps {
  clientId: string;
  /** Same `contacts` array already fetched for the Contacts tab (see
   * `client-detail.tsx`) — this panel reuses it rather than issuing a second
   * fetch. */
  contacts: ContactRecord[];
  /** Each contact's current login-access status against the tenant org this
   * client represents, keyed by `email.trim().toLowerCase()` — fetched
   * server-side in `page.tsx` (see that file's comment on why: `Tabs.Panel`
   * unmounts/remounts on every tab switch, per `packages/ui/src/tabs.tsx`,
   * so a client-side `useEffect` fetch here would re-run and flicker every
   * time this tab is reselected; a Server Action can't be called at render
   * time anyway). `null` only when this tab isn't visible at all (the parent
   * never renders this panel in that case). */
  statusByEmail: Record<string, TenantAccessStatus>;
}

/** Normalizes the same way every action in `platform-access-actions.ts`
 * does before touching `invites`/`users` — must match exactly for a lookup
 * against `statusByEmail` to land on the right entry. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface RevealedLink {
  mode: "invited" | "reset";
  link: string;
}

/**
 * "Access" tab on the Client detail page, platform-admin-only (issue #45) —
 * shown only once a client has been activated as a real tenant
 * (`client.represents_organization_id` set). Lists the client's contacts
 * with each one's login-access status and a "Send invitation"/"Reset
 * password" action, backed by the service-role actions in
 * `../platform-access-actions.ts` (a platform admin is never a member of the
 * tenant org they're managing, so those actions can't run under the
 * caller's own RLS-scoped session — see that file's header comment).
 *
 * There's no outbound email in this app yet (confirmed — both actions
 * return a link instead of sending mail), so a successful call reveals the
 * link inline as a read-only, selectable `Input` next to a "Copy" button
 * rather than silently succeeding with no way to retrieve it.
 */
export function AccessPanel({ clientId, contacts, statusByEmail: initialStatusByEmail }: AccessPanelProps) {
  const [statusByEmail, setStatusByEmail] = useState(initialStatusByEmail);
  const [reveal, setReveal] = useState<Record<string, RevealedLink>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  function statusFor(contact: ContactRecord): TenantAccessStatus {
    if (!contact.email) return "none";
    return statusByEmail[normalizeEmail(contact.email)] ?? "none";
  }

  async function handleInvite(contact: ContactRecord) {
    if (!contact.email) return;
    const email = contact.email;
    setRowErrors((prev) => ({ ...prev, [contact.id]: "" }));
    setPendingId(contact.id);
    const result = await inviteTenantOwner(clientId, email);
    setPendingId(null);
    if (result.error || !result.data) {
      setRowErrors((prev) => ({ ...prev, [contact.id]: result.error ?? "Could not send the invitation." }));
      return;
    }
    setStatusByEmail((prev) => ({ ...prev, [normalizeEmail(email)]: "invited" }));
    setReveal((prev) => ({ ...prev, [contact.id]: { mode: "invited", link: result.data!.inviteUrl } }));
  }

  async function handleReset(contact: ContactRecord) {
    if (!contact.email) return;
    const email = contact.email;
    setRowErrors((prev) => ({ ...prev, [contact.id]: "" }));
    setPendingId(contact.id);
    const result = await resendOrResetTenantAccess(clientId, email);
    setPendingId(null);
    if (result.error || !result.data) {
      setRowErrors((prev) => ({ ...prev, [contact.id]: result.error ?? "Could not reset access." }));
      return;
    }
    if (result.data.mode === "invited") {
      setStatusByEmail((prev) => ({ ...prev, [normalizeEmail(email)]: "invited" }));
      setReveal((prev) => ({ ...prev, [contact.id]: { mode: "invited", link: result.data!.inviteUrl! } }));
    } else {
      setReveal((prev) => ({ ...prev, [contact.id]: { mode: "reset", link: result.data!.actionLink! } }));
    }
  }

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        heading="No contacts yet"
        text="Add a contact on the Contacts tab first, then invite them to log in here."
      />
    );
  }

  return (
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Contact</Table.HeaderCell>
          <Table.HeaderCell>Email</Table.HeaderCell>
          <Table.HeaderCell align="center">Status</Table.HeaderCell>
          <Table.HeaderCell align="center">Action</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {contacts.map((contact) => {
          const status = statusFor(contact);
          const isPending = pendingId === contact.id;
          const revealed = reveal[contact.id];
          const rowError = rowErrors[contact.id];
          return (
            <Table.Row key={contact.id}>
              <Table.Cell>
                <Inline gap="sm">
                  <Avatar name={contact.name} size="sm" />
                  <Text>{contact.name}</Text>
                </Inline>
              </Table.Cell>
              <Table.Cell>{contact.email || <Text tone="muted">—</Text>}</Table.Cell>
              <Table.Cell align="center">
                <StatusBadge status={status} />
              </Table.Cell>
              <Table.Cell align="center">
                <Stack gap="xs">
                  {!contact.email ? (
                    <Text tone="muted">Add an email on this contact first</Text>
                  ) : status === "none" ? (
                    <Button variant="outline" size="sm" onClick={() => handleInvite(contact)} disabled={isPending}>
                      {isPending ? "Sending…" : "Send invitation"}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleReset(contact)} disabled={isPending}>
                      {isPending ? "Working…" : "Reset password"}
                    </Button>
                  )}
                  {rowError && <Text tone="danger">{rowError}</Text>}
                  {revealed && <RevealedLinkField revealed={revealed} />}
                </Stack>
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}

function StatusBadge({ status }: { status: TenantAccessStatus }) {
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "invited") return <Badge variant="warning">Invited</Badge>;
  return <Badge variant="muted">No access</Badge>;
}

/** Read-only, selectable link + a best-effort "Copy" button (falls back to
 * silently doing nothing if `navigator.clipboard` isn't available — the
 * link is already selectable text either way, so copying by hand always
 * works even then). */
function RevealedLinkField({ revealed }: { revealed: RevealedLink }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(revealed.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/denied — the link below is still
      // selectable text, so the admin can copy it by hand.
    }
  }

  return (
    <Stack gap="xs">
      <Text tone="muted">
        {revealed.mode === "invited" ? "Invitation link — send this to the contact:" : "Password reset link:"}
      </Text>
      <Inline gap="xs">
        <Input readOnly value={revealed.link} onFocus={(event) => event.currentTarget.select()} />
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </Inline>
    </Stack>
  );
}
