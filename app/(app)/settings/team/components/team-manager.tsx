"use client";

import { useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Heading,
  Inline,
  Input,
  Select,
  Stack,
  Table,
  Text,
  useEscapeToClose,
} from "@yourorg/ui";
import { Mail } from "@yourorg/ui/icons";
import { formatDateTime } from "@/lib/format/date";
import {
  cancelTeamInvite,
  listTeamMembers,
  resetTeamMemberPassword,
  updateTeamMemberRole,
  type PendingTeamInviteRecord,
  type TeamMemberRecord,
} from "@/lib/team/actions";
import { TENANT_ROLES, type TenantRole } from "@/lib/rbac/permissions";
import { EditTeamMemberNameDialog } from "./edit-team-member-name-dialog";
import { InviteTeamMemberDialog } from "./invite-team-member-dialog";
import { RemoveTeamMemberDialog } from "./remove-team-member-dialog";
import { roleLabel } from "./role-label";

export interface TeamManagerProps {
  members: TeamMemberRecord[];
  pendingInvites: PendingTeamInviteRecord[];
  /** Non-fatal — `listTeamMembers` failing still renders this component with
   * whatever it got, plus this message, same convention every other manager
   * on this settings surface uses (`AccountManagerManager`,
   * `ChecklistTemplatesManager`, `ReferenceListManager`). */
  loadError?: string;
  /** Owner only, per the `settings` RBAC row (owner: CRUD, everyone else:
   * read-only) — a non-owner sees a plain read-only member list with no
   * pending-invites section (they can't see those either: `invites_select_
   * owner` RLS means `listTeamMembers` already comes back with an empty
   * `pendingInvites` for them). */
  canWrite: boolean;
  /** `session.userId` (issue #91) — identifies the caller's own row so it can
   * be rendered protected (role locked, no Remove) below, matching the
   * server-side self-change guards in `lib/team/actions.ts`. */
  currentUserId: string;
}

interface RevealedLink {
  heading: string;
  description: string;
  link: string;
}

/**
 * "Team" settings screen (issue #88) — lists active members (avatar, name,
 * email, role, joined date, actions) and pending invites, backed by
 * `lib/team/actions.ts`. Modeled on two existing precedents rather than
 * invented fresh:
 *  - `AccessPanel` (`app/(app)/clients/[id]/access-panel.tsx`) for the
 *    "reveal a copyable link" popup — there's no outbound email in this repo,
 *    so an invite/password-reset both resolve to a link the owner copies and
 *    sends manually.
 *  - `AccountManagerManager`/`ReferenceListManager` for the table +
 *    form-dialog + `ConfirmDeleteDialog` CRUD shape.
 *
 * A role change is a plain inline `<Select>` per row that calls
 * `updateTeamMemberRole` immediately on change (no separate "Save" step) —
 * there's no existing inline-select-edit precedent elsewhere in the app, so
 * this establishes the pattern for this screen; reverting the `<select>`'s
 * displayed value on failure falls out for free since it's controlled by
 * `members` state, which is only updated on a *successful* change.
 *
 * Issue #91: the caller's own row (`currentUserId`) always renders its role
 * as a plain `Badge` (never a `<Select>`) and never shows "Remove" — an
 * owner shouldn't be able to lock themselves out of their own org from this
 * panel. Same treatment for whichever row `isPlatformAdmin`, regardless of
 * who's viewing: that account's role/membership is protected from every
 * owner, not just itself. Both mirror real guards in
 * `lib/team/actions.ts` (`updateTeamMemberRole`/`removeTeamMember`) — this is
 * just keeping the UI from offering a control that would only fail
 * server-side.
 */
export function TeamManager({
  members: initialMembers,
  pendingInvites: initialPendingInvites,
  loadError,
  canWrite,
  currentUserId,
}: TeamManagerProps) {
  const [members, setMembers] = useState(initialMembers);
  const [pendingInvites, setPendingInvites] = useState(initialPendingInvites);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedLink | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TeamMemberRecord | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberRecord | null>(null);

  function clearRowError(key: string) {
    setRowErrors((prev) => ({ ...prev, [key]: "" }));
  }

  async function handleRoleChange(member: TeamMemberRecord, role: TenantRole) {
    clearRowError(member.userId);
    setPendingId(member.userId);
    const result = await updateTeamMemberRole(member.userId, role);
    setPendingId(null);
    if (result.error || !result.data) {
      setRowErrors((prev) => ({ ...prev, [member.userId]: result.error ?? "Could not change this teammate's role." }));
      return;
    }
    setMembers((prev) => prev.map((m) => (m.userId === member.userId ? { ...m, role: result.data!.role } : m)));
  }

  async function handleResetPassword(member: TeamMemberRecord) {
    clearRowError(member.userId);
    setPendingId(member.userId);
    const result = await resetTeamMemberPassword(member.userId);
    setPendingId(null);
    if (result.error || !result.data) {
      setRowErrors((prev) => ({ ...prev, [member.userId]: result.error ?? "Could not generate a reset link." }));
      return;
    }
    setRevealed({
      heading: "Password reset link",
      description: `Send this link to ${member.fullName || member.email} so they can set a new password.`,
      link: result.data.actionLink,
    });
  }

  async function handleCancelInvite(invite: PendingTeamInviteRecord) {
    clearRowError(invite.id);
    setPendingId(invite.id);
    const result = await cancelTeamInvite(invite.id);
    setPendingId(null);
    if (result.error) {
      setRowErrors((prev) => ({ ...prev, [invite.id]: result.error ?? "Could not cancel this invite." }));
      return;
    }
    setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }

  async function handleInvited(inviteUrl: string) {
    setRevealed({
      heading: "Invitation link",
      description: "Send this link to your new teammate — there's no outbound email yet, so this is the only way for them to get it.",
      link: inviteUrl,
    });
    // The invite dialog only returns the link, not the created row's real
    // id/created-at — a targeted re-list keeps the pending-invites table
    // authoritative without a full page reload.
    const result = await listTeamMembers();
    if (result.data) setPendingInvites(result.data.pendingInvites);
  }

  return (
    <Stack gap="lg">
      {loadError && <Text tone="danger">{loadError}</Text>}

      <Stack gap="sm">
        <Inline gap="sm" align="center">
          <Heading level={3}>Members</Heading>
          {canWrite && (
            <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
              Invite teammate
            </Button>
          )}
        </Inline>

        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Role</Table.HeaderCell>
              <Table.HeaderCell>Joined</Table.HeaderCell>
              {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {members.map((member) => {
              const isPending = pendingId === member.userId;
              const rowError = rowErrors[member.userId];
              // Issue #91: an owner can't change their own role or remove
              // themselves from this panel (mirrors the server-side guards in
              // `lib/team/actions.ts` — this just keeps the UI from offering
              // a control that would only fail), and the cross-tenant
              // Platform Admin's role/membership is protected from EVERY
              // owner, not just themselves.
              const isSelf = member.userId === currentUserId;
              const roleLocked = isSelf || member.isPlatformAdmin;
              return (
                <Table.Row key={member.userId}>
                  <Table.Cell>
                    <Inline gap="sm" align="center">
                      <Avatar name={member.fullName || member.email} size="sm" photoUrl={member.avatarUrl} />
                      {member.fullName ? <Text>{member.fullName}</Text> : <Text tone="muted">No name set</Text>}
                      {isSelf && <Badge variant="muted">You</Badge>}
                    </Inline>
                  </Table.Cell>
                  <Table.Cell>{member.email}</Table.Cell>
                  <Table.Cell>
                    {canWrite && !roleLocked ? (
                      <Select
                        aria-label={`Role for ${member.fullName || member.email}`}
                        value={member.role}
                        disabled={isPending}
                        onChange={(event) => handleRoleChange(member, event.target.value as TenantRole)}
                      >
                        {TENANT_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge variant="muted">{roleLabel(member.role)}</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>{formatDateTime(member.createdAt)}</Table.Cell>
                  {canWrite && (
                    <Table.Cell align="center">
                      <Stack gap="xs">
                        <Inline gap="xs">
                          <Button variant="outline" size="sm" onClick={() => setEditTarget(member)} disabled={isPending}>
                            Edit name
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleResetPassword(member)} disabled={isPending}>
                            {isPending ? "Working…" : "Reset password"}
                          </Button>
                          {!isSelf && !member.isPlatformAdmin && (
                            <Button variant="danger" size="sm" onClick={() => setRemoveTarget(member)} disabled={isPending}>
                              Remove
                            </Button>
                          )}
                        </Inline>
                        {rowError && <Text tone="danger">{rowError}</Text>}
                      </Stack>
                    </Table.Cell>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </Stack>

      {canWrite && (
        <Stack gap="sm">
          <Heading level={3}>Pending invites</Heading>
          {pendingInvites.length === 0 ? (
            <EmptyState icon={<Mail />} heading="No pending invites" text="Everyone you've invited has already joined." />
          ) : (
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.HeaderCell>Email</Table.HeaderCell>
                  <Table.HeaderCell>Role</Table.HeaderCell>
                  <Table.HeaderCell>Invited</Table.HeaderCell>
                  <Table.HeaderCell align="center">Action</Table.HeaderCell>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {pendingInvites.map((invite) => {
                  const isPending = pendingId === invite.id;
                  const rowError = rowErrors[invite.id];
                  return (
                    <Table.Row key={invite.id}>
                      <Table.Cell>{invite.email}</Table.Cell>
                      <Table.Cell>
                        <Badge variant="warning">{roleLabel(invite.role)}</Badge>
                      </Table.Cell>
                      <Table.Cell>{formatDateTime(invite.createdAt)}</Table.Cell>
                      <Table.Cell align="center">
                        <Stack gap="xs">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCancelInvite(invite)}
                            disabled={isPending}
                          >
                            {isPending ? "Cancelling…" : "Cancel"}
                          </Button>
                          {rowError && <Text tone="danger">{rowError}</Text>}
                        </Stack>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
        </Stack>
      )}

      {canWrite && (
        <>
          <InviteTeamMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={handleInvited} />
          <EditTeamMemberNameDialog
            open={editTarget !== null}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
            member={editTarget}
            onSaved={(userId, fullName) => {
              setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, fullName } : m)));
              setEditTarget(null);
            }}
          />
          <RemoveTeamMemberDialog
            open={removeTarget !== null}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            member={removeTarget}
            onRemoved={(userId) => {
              setMembers((prev) => prev.filter((m) => m.userId !== userId));
              setRemoveTarget(null);
            }}
          />
        </>
      )}

      <RevealedLinkDialog
        open={revealed !== null}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
        state={revealed}
      />
    </Stack>
  );
}

/**
 * Popup revealing an invite/password-reset link — same shape as
 * `AccessPanel`'s own `RevealedLinkDialog`: a read-only, selectable `Input`
 * next to a best-effort "Copy" button (falls back to silently doing nothing
 * if `navigator.clipboard` isn't available; the input stays selectable text
 * either way).
 */
function RevealedLinkDialog({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: RevealedLink | null;
}) {
  const [copied, setCopied] = useState(false);
  useEscapeToClose(open, onOpenChange);

  async function handleCopy() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/denied — the field below is still
      // selectable text, so the owner can copy it by hand.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>{state?.heading ?? "Link"}</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          <Text tone="muted">{state?.description}</Text>
          <Inline gap="xs">
            <Input readOnly value={state?.link ?? ""} onFocus={(event) => event.currentTarget.select()} />
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
