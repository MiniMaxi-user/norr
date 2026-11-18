"use client";

import { useMemo, useState } from "react";
import { WebButton } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import { AccountManagerFormDialog } from "./account-manager-form-dialog";
import { DeleteAccountManagerDialog } from "./delete-account-manager-dialog";

export interface AccountManagerManagerProps {
  accountManagers: AccountManagerRecord[];
  /** Non-fatal: `listAccountManagers` failing still renders the card (empty)
   * with this message. */
  loadError?: string;
  /** Owner only, per the `settings` RBAC entry. */
  canWrite: boolean;
}

const initialOf = (row: AccountManagerRecord) => (row.last_name.trim().charAt(0) || "?").toUpperCase();
const isFirstHalf = (row: AccountManagerRecord) => initialOf(row) < "M";

/**
 * Account managers (issue #58; design system #222): the colleagues that can be
 * assigned as a client's account manager. One card with FilterBar + table;
 * `+ Account manager` sits in the FilterBar, Edit and Delete in the row's ···
 * menu (owner only). Account managers have no status, so the toggle splits the
 * list by last name (A-L / M-Z / All) and the dropdown filters by initial.
 */
export function AccountManagerManager({ accountManagers, loadError, canWrite }: AccountManagerManagerProps) {
  const [formState, setFormState] = useState<{ open: boolean; accountManager: AccountManagerRecord | null }>({
    open: false,
    accountManager: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<AccountManagerRecord | null>(null);

  const columns = useMemo<WebColumn<AccountManagerRecord>[]>(
    () => [
      { id: "first", header: "First name", sortValue: (row) => row.first_name, render: (row) => row.first_name },
      { id: "last", header: "Last name", sortValue: (row) => row.last_name, render: (row) => row.last_name },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "initial",
        label: "Last name starts with",
        getOptions: (row: AccountManagerRecord) => [{ value: initialOf(row), label: initialOf(row) }],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show account managers",
      defaultValue: "all",
      options: [
        { value: "a-l", label: "A–L", match: isFirstHalf },
        { value: "m-z", label: "M–Z", match: (row: AccountManagerRecord) => !isFirstHalf(row) },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (row: AccountManagerRecord): WebMenuItem[] =>
    canWrite
      ? [
          { key: "edit", label: "Edit…", onSelect: () => setFormState({ open: true, accountManager: row }) },
          { type: "separator", key: "sep" },
          { key: "delete", label: "Delete", danger: true, onSelect: () => setDeleteTarget(row) },
        ]
      : [];

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <WebDataTableCard
        note="Colleagues who can be assigned as a client’s account manager."
        rows={accountManagers}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.first_name} ${row.last_name}`}
        noun="account managers"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="managers"
        defaultSort={{ columnId: "last", direction: "asc" }}
        rowActions={canWrite ? rowActions : undefined}
        rowLabel={(row) => `${row.first_name} ${row.last_name}`}
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setFormState({ open: true, accountManager: null })}>
              + Account manager
            </WebButton>
          ) : undefined
        }
        emptyAction={canWrite ? "Use + Account manager to add the first one." : undefined}
      />

      {canWrite ? (
        <>
          {formState.open ? (
            <AccountManagerFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              accountManager={formState.accountManager}
            />
          ) : null}
          <DeleteAccountManagerDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            accountManager={deleteTarget}
          />
        </>
      ) : null}
    </div>
  );
}
