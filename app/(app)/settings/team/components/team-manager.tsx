"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, useEscapeToClose } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { StatusText, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import { formatDateTimeWeb } from "@/lib/format/web";
import {
  cancelTeamInvite,
  listTeamMembers,
  resetTeamMemberPassword,
  updateTeamMemberRole,
  type PendingTeamInviteRecord,
  type TeamMemberRecord,
} from "@/lib/team/actions";
import { TENANT_ROLES, type TenantRole } from "@/lib/rbac/permissions";
import { InviteTeamMemberDialog } from "./invite-team-member-dialog";
import { RemoveTeamMemberDialog } from "./remove-team-member-dialog";
import { roleLabel } from "./role-label";

export interface TeamManagerProps {
  members: TeamMemberRecord[];
  pendingInvites: PendingTeamInviteRecord[];
  /** Non-fatal: `listTeamMembers` failing still renders the card with this
   * message. */
  loadError?: string;
  /** Owner only, per the `settings` RBAC row. A non-owner sees a read-only
   * member list (and no pending invites: RLS returns none for them). */
  canWrite: boolean;
  /** `session.userId` — identifies the caller's own row so it is protected
   * (role locked, no Remove), matching the server-side guards. */
  currentUserId: string;
}

interface RevealedLink {
  heading: string;
  description: string;
  link: string;
}

type TeamRow =
  | { kind: "member"; id: string; member: TeamMemberRecord }
  | { kind: "invite"; id: string; invite: PendingTeamInviteRecord };

const rowEmail = (row: TeamRow) => (row.kind === "member" ? row.member.email : row.invite.email);
const rowName = (row: TeamRow) => (row.kind === "member" ? row.member.fullName || "" : "");
const rowRole = (row: TeamRow): TenantRole => (row.kind === "member" ? row.member.role : row.invite.role);
const rowDate = (row: TeamRow) => (row.kind === "member" ? row.member.createdAt : row.invite.createdAt);

/**
 * "Team" settings page (issue #88; design system #222): the organisation's
 * members and pending invites in one card with a FilterBar (search, Role
 * dropdown, Active / Invited / All) and a table. `+ Invite teammate` sits in
 * the FilterBar. A row click opens the member's own detail page
 * (`/settings/team/[userId]`, issue #192); the row's ··· menu has Edit,
 * Change role (one entry per other role), Reset password and Remove for a
 * member, and Cancel invite for a pending invite. Menus are owner only.
 *
 * Own-row / Platform Admin protection (issue #91): the caller's own row and
 * the cross-tenant Platform Admin never offer Change role or Remove, mirroring
 * the server-side guards in `lib/team/actions.ts`.
 *
 * There is no outbound email, so an invite and a password reset both resolve
 * to a link the owner copies and sends by hand (`RevealedLinkDialog`).
 */
export function TeamManager({
  members: initialMembers,
  pendingInvites: initialPendingInvites,
  loadError,
  canWrite,
  currentUserId,
}: TeamManagerProps) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [pendingInvites, setPendingInvites] = useState(initialPendingInvites);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedLink | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberRecord | null>(null);

  const rows = useMemo<TeamRow[]>(
    () => [
      ...members.map((member): TeamRow => ({ kind: "member", id: member.userId, member })),
      ...(canWrite ? pendingInvites : []).map((invite): TeamRow => ({ kind: "invite", id: `invite-${invite.id}`, invite })),
    ],
    [members, pendingInvites, canWrite],
  );

  async function handleRoleChange(member: TeamMemberRecord, role: TenantRole) {
    setActionError(null);
    const result = await updateTeamMemberRole(member.userId, role);
    if (result.error || !result.data) {
      setActionError(result.error ?? "Could not change this teammate's role.");
      return;
    }
    setMembers((prev) => prev.map((m) => (m.userId === member.userId ? { ...m, role: result.data!.role } : m)));
  }

  async function handleResetPassword(member: TeamMemberRecord) {
    setActionError(null);
    const result = await resetTeamMemberPassword(member.userId);
    if (result.error || !result.data) {
      setActionError(result.error ?? "Could not generate a reset link.");
      return;
    }
    setRevealed({
      heading: "Password reset link",
      description: `Send this link to ${member.fullName || member.email} so they can set a new password.`,
      link: result.data.actionLink,
    });
  }

  async function handleCancelInvite(invite: PendingTeamInviteRecord) {
    setActionError(null);
    const result = await cancelTeamInvite(invite.id);
    if (result.error) {
      setActionError(result.error ?? "Could not cancel this invite.");
      return;
    }
    setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }

  async function handleInvited(inviteUrl: string) {
    setRevealed({
      heading: "Invitation link",
      description:
        "Send this link to your new teammate — there's no outbound email yet, so this is the only way for them to get it.",
      link: inviteUrl,
    });
    // The invite dialog only returns the link; a targeted re-list keeps the
    // pending invites authoritative without a full page reload.
    const result = await listTeamMembers();
    if (result.data) setPendingInvites(result.data.pendingInvites);
  }

  const columns = useMemo<WebColumn<TeamRow>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        sortValue: (row) => rowName(row),
        render: (row) => {
          if (row.kind === "invite") return "—";
          const suffix = row.member.userId === currentUserId ? " (you)" : "";
          return row.member.fullName ? (
            `${row.member.fullName}${suffix}`
          ) : (
            <span className="web-muted-cell">No name set{suffix}</span>
          );
        },
      },
      { id: "email", header: "Email", sortValue: (row) => rowEmail(row), render: (row) => rowEmail(row) },
      { id: "role", header: "Role", sortValue: (row) => roleLabel(rowRole(row)), render: (row) => roleLabel(rowRole(row)) },
      {
        id: "status",
        header: "Status",
        sortValue: (row) => (row.kind === "member" ? 0 : 1),
        render: (row) =>
          row.kind === "member" ? (
            <StatusText display="auto" tone="success">Active</StatusText>
          ) : (
            <StatusText display="auto" tone="warning">Invited</StatusText>
          ),
      },
      {
        id: "date",
        header: "Joined / invited",
        sortValue: (row) => rowDate(row),
        render: (row) => formatDateTimeWeb(rowDate(row)),
      },
    ],
    [currentUserId],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "role",
        label: "Role",
        options: TENANT_ROLES.map((role) => ({ value: role, label: roleLabel(role) })),
        getOptions: (row: TeamRow) => [{ value: rowRole(row), label: roleLabel(rowRole(row)) }],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show team",
      defaultValue: "all",
      options: [
        { value: "active", label: "Active", match: (row: TeamRow) => row.kind === "member" },
        { value: "invited", label: "Invited", match: (row: TeamRow) => row.kind === "invite" },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (row: TeamRow): WebMenuItem[] => {
    if (!canWrite) return [];
    if (row.kind === "invite") {
      return [{ key: "cancel", label: "Cancel invite", danger: true, onSelect: () => void handleCancelInvite(row.invite) }];
    }
    const member = row.member;
    const isSelf = member.userId === currentUserId;
    const roleLocked = isSelf || member.isPlatformAdmin;
    const items: WebMenuItem[] = [
      { key: "edit", label: "Edit…", href: `/settings/team/${member.userId}` },
      { key: "reset", label: "Reset password", onSelect: () => void handleResetPassword(member) },
    ];
    if (!roleLocked) {
      items.push({ type: "separator", key: "sep-role" }, { type: "label", key: "role-label", node: "Change role" });
      for (const role of TENANT_ROLES) {
        if (role === member.role) continue;
        items.push({ key: `role-${role}`, label: roleLabel(role), onSelect: () => void handleRoleChange(member, role) });
      }
      items.push({ type: "separator", key: "sep-remove" }, {
        key: "remove",
        label: "Remove",
        danger: true,
        onSelect: () => setRemoveTarget(member),
      });
    }
    return items;
  };

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className="web-dialog-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <WebDataTableCard
        note={
          canWrite
            ? "Invite colleagues, manage their role, and reset access when needed."
            : "Everyone in your organization — only the owner can invite, change roles, or remove access."
        }
        rows={rows}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${rowName(row)} ${rowEmail(row)} ${roleLabel(rowRole(row))}`}
        noun="teammates"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="team"
        defaultSort={{ columnId: "name", direction: "asc" }}
        onRowClick={(row) => {
          if (row.kind === "member") router.push(`/settings/team/${row.member.userId}`);
        }}
        rowActions={canWrite ? rowActions : undefined}
        rowLabel={(row) => rowName(row) || rowEmail(row)}
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setInviteOpen(true)}>
              + Invite teammate
            </WebButton>
          ) : undefined
        }
        emptyAction={canWrite ? "Use + Invite teammate to add the first one." : undefined}
      />

      {canWrite ? (
        <>
          <InviteTeamMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={handleInvited} />
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
      ) : null}

      <RevealedLinkDialog
        open={revealed !== null}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
        state={revealed}
      />
    </div>
  );
}

/**
 * Popup revealing an invite / password-reset link: a read-only, selectable
 * field next to a best-effort Copy button (the field stays selectable text if
 * the clipboard API is unavailable).
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
      // Clipboard API unavailable or denied: the field is still selectable.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <h2 className="web-dialog-title">{state?.heading ?? "Link"}</h2>
      </Dialog.Header>
      <Dialog.Body>
        <div className="web-dialog-form">
          <p className="web-dialog-text">{state?.description}</p>
          <div className="web-dialog-field">
            <label className="web-field-label" htmlFor="team-revealed-link">
              Link
            </label>
            <input
              id="team-revealed-link"
              className="web-input"
              readOnly
              value={state?.link ?? ""}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <WebButton onClick={() => void handleCopy()}>{copied ? "Copied" : "Copy link"}</WebButton>
        <WebButton variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </WebButton>
      </Dialog.Footer>
    </Dialog>
  );
}
