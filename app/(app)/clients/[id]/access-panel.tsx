"use client";

import { useMemo, useState } from "react";
import { Button, Dialog, Heading, Inline, Input, Stack, Text } from "@yourorg/ui";
import { StatusText, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import type { ContactRecord } from "../contacts-actions";
import {
  inviteTenantOwner,
  resendOrResetTenantAccess,
  type TenantAccessStatus,
} from "../platform-access-actions";
import { DisableAccessDialog } from "./disable-access-dialog";

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

interface RevealDialogState {
  contact: ContactRecord;
  revealed: RevealedLink;
}

/**
 * "Access" tab on the Client detail page, platform-admin-only (issue #45) —
 * shown only once a client has been activated as a real tenant
 * (`client.represents_organization_id` set). Lists the client's contacts
 * with each one's login-access status and a "Request access"/"Reset
 * password" action, backed by the service-role actions in
 * `../platform-access-actions.ts` (a platform admin is never a member of the
 * tenant org they're managing, so those actions can't run under the
 * caller's own RLS-scoped session — see that file's header comment).
 *
 * There's no outbound email in this app yet (confirmed — both actions
 * return a link instead of sending mail), so a successful call reveals the
 * link in a popup (`RevealedLinkDialog`) as a read-only, selectable `Input`
 * next to a "Copy" button, rather than silently succeeding with no way to
 * retrieve it. A popup rather than the inline-in-row field this replaced —
 * one link at a time, no per-row layout shift, and the same treatment for
 * every action that reveals a link (first invite, resend, and password
 * reset alike) instead of just some of them.
 */
export function AccessPanel({ clientId, contacts, statusByEmail: initialStatusByEmail }: AccessPanelProps) {
  const [statusByEmail, setStatusByEmail] = useState(initialStatusByEmail);
  const [revealDialog, setRevealDialog] = useState<RevealDialogState | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<ContactRecord | null>(null);

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
    setRevealDialog({ contact, revealed: { mode: "invited", link: result.data!.inviteUrl } });
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
      setRevealDialog({ contact, revealed: { mode: "invited", link: result.data!.inviteUrl! } });
    } else {
      setRevealDialog({ contact, revealed: { mode: "reset", link: result.data!.actionLink! } });
    }
  }

  /** Called by `DisableAccessDialog` once `disableTenantAccess` succeeds —
   * mirrors what `getTenantAccessStatus` would now report (no pending
   * invite, no membership ⇒ "none") without a full page refresh. */
  function handleDisabled(contact: ContactRecord) {
    if (!contact.email) return;
    setStatusByEmail((prev) => ({ ...prev, [normalizeEmail(contact.email!)]: "none" }));
    setRevealDialog((prev) => (prev?.contact.id === contact.id ? null : prev));
    setRowErrors((prev) => ({ ...prev, [contact.id]: "" }));
  }

  const columns = useMemo<WebColumn<ContactRecord>[]>(
    () => [
      {
        id: "name",
        header: "Contact",
        sortValue: (contact) => contact.name,
        render: (contact) => (
          <>
            {contact.name}
            {rowErrors[contact.id] ? (
              <>
                <br />
                <StatusText tone="danger">{rowErrors[contact.id]}</StatusText>
              </>
            ) : null}
          </>
        ),
      },
      { id: "email", header: "Email", sortValue: (contact) => contact.email ?? "", render: (contact) => contact.email || "Add an email on the Contacts tab first" },
      {
        id: "status",
        header: "Status",
        sortValue: (contact) => STATUS_LABEL[statusFor(contact)],
        render: (contact) => {
          const status = statusFor(contact);
          return <StatusText tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusText>;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowErrors, statusByEmail],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "status",
        label: "Status",
        getOptions: (contact: ContactRecord) => {
          const status = statusFor(contact);
          return [{ value: status, label: STATUS_LABEL[status] }];
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusByEmail],
  );

  const segment = useMemo(
    () => ({
      label: "Show contacts by access",
      defaultValue: "all",
      options: [
        { value: "with", label: "With access", match: (contact: ContactRecord) => statusFor(contact) !== "none" },
        { value: "without", label: "Without", match: (contact: ContactRecord) => statusFor(contact) === "none" },
        { value: "all", label: "All" },
      ] as const,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusByEmail],
  );

  function rowActions(contact: ContactRecord): WebMenuItem[] {
    if (!contact.email) return [{ key: "no-email", label: "Add an email on the Contacts tab first", disabled: true }];
    const status = statusFor(contact);
    const isPending = pendingId === contact.id;
    const items: WebMenuItem[] = [
      status === "none"
        ? { key: "invite", label: isPending ? "Sending…" : "Request access", disabled: isPending, onSelect: () => void handleInvite(contact) }
        : {
            key: "reset",
            label: isPending ? "Working…" : status === "active" ? "Reset password" : "Resend request",
            disabled: isPending,
            onSelect: () => void handleReset(contact),
          },
    ];
    if (status === "invited" || status === "active") {
      items.push({ key: "disable", label: "Disable access", danger: true, disabled: isPending, onSelect: () => setDisableTarget(contact) });
    }
    return items;
  }

  return (
    <>
      <WebDataTableCard
        title="Access"
        meta={String(contacts.length)}
        rows={contacts}
        getRowKey={(contact) => contact.id}
        columns={columns}
        searchText={(contact) => `${contact.name} ${contact.email ?? ""}`}
        noun="contacts"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="access"
        defaultSort={{ columnId: "name", direction: "asc" }}
        rowActions={rowActions}
        rowLabel={(contact) => contact.name}
        emptyAction="Add a contact on the Contacts tab first, then invite them to log in here."
      />
      <DisableAccessDialog
        open={disableTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisableTarget(null);
        }}
        clientId={clientId}
        contact={disableTarget}
        onDisabled={() => {
          if (disableTarget) handleDisabled(disableTarget);
        }}
      />
      <RevealedLinkDialog
        open={revealDialog !== null}
        onOpenChange={(open) => {
          if (!open) setRevealDialog(null);
        }}
        state={revealDialog}
      />
    </>
  );
}

const STATUS_LABEL: Record<TenantAccessStatus, string> = { active: "Active", invited: "Invited", none: "No access" };
const STATUS_TONE: Record<TenantAccessStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  invited: "warning",
  none: "neutral",
};

/**
 * Popup revealing the link a "Request access"/"Resend request"/"Reset
 * password" click just produced — read-only, selectable `Input` + a
 * best-effort "Copy" button (falls back to silently doing nothing if
 * `navigator.clipboard` isn't available; the input is still selectable text
 * either way, so copying by hand always works even then). Same shape as
 * `DisableAccessDialog` (plain popup, no form), just showing a result
 * instead of confirming an action.
 *
 * Takes `state` rather than separate `contact`/`revealed` props so the
 * dialog can render its previous content while its close transition plays
 * (`open={false}` but `state` still set) instead of blanking immediately —
 * `AccessPanel` clears `state` to `null` only on the next reveal, never on
 * close.
 */
function RevealedLinkDialog({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: RevealDialogState | null;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.revealed.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/denied — the field below is still
      // selectable text, so the admin can copy it by hand.
    }
  }

  const isInvite = state?.revealed.mode === "invited";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>{isInvite ? "Invitation link" : "Password reset link"}</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          <Text tone="muted">
            {isInvite
              ? `Send this link to ${state?.contact.name ?? "the contact"} — there's no outbound email yet, so this is the only way for them to get it.`
              : `Send this link to ${state?.contact.name ?? "the contact"} so they can set a new password.`}
          </Text>
          <Inline gap="xs">
            <Input readOnly value={state?.revealed.link ?? ""} onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </Inline>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
