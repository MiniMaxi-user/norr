"use client";

import { useState } from "react";
import { Button, EmptyState, Heading, Stack, Table, Text } from "@yourorg/ui";
import { Users } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import { AccountManagerFormDialog } from "./account-manager-form-dialog";
import { DeleteAccountManagerDialog } from "./delete-account-manager-dialog";

export interface AccountManagerManagerProps {
  accountManagers: AccountManagerRecord[];
  /** Non-fatal — `listAccountManagers` failing (e.g. transient network) still
   * renders this component with whatever it got (`accountManagers` empty),
   * plus this message, rather than crashing the whole tab (same convention
   * `AssetModelManager`/`ReferenceListManager` use for their own
   * `loadError`). */
  loadError?: string;
  /** Owner only, per the `settings` RBAC entry (matches this table's RLS —
   * select: any member; insert/update/delete: owner only) — same as every
   * other manager on this screen. */
  canWrite: boolean;
}

/**
 * "Account Managers" tab on the Reference Lists settings screen (issue #58)
 * — a dedicated, much simpler manager than `AssetModelManager` (two required
 * text fields, no cross-FK relationships, no comboboxes), built as its own
 * small component rather than reused off the generic `ReferenceListManager`
 * for the same reason `asset_models` gets its own manager: Account Managers
 * aren't `reference_list_items` rows, they're their own dedicated
 * `public.account_managers` table (see `lib/account-managers/actions.ts`).
 *
 * Placement judgment call: kept on the existing "Reference Lists" settings
 * screen (as one more tab, alongside `asset_models` — itself already not a
 * `reference_list_items` table either) rather than carved out into its own
 * top-level Settings section. An Account Manager picklist is small,
 * owner-managed, and consumed the exact same way a reference list is (a
 * `<Select>` populated from a short named-record list) — spinning up a
 * dedicated Settings sub-section for two text fields felt like more
 * navigation surface than the data warrants; revisit if this list grows real
 * fields of its own (a linked user account, a territory, ...) that would
 * make it feel more like its own module.
 */
export function AccountManagerManager({ accountManagers, loadError, canWrite }: AccountManagerManagerProps) {
  const [formState, setFormState] = useState<{ open: boolean; accountManager: AccountManagerRecord | null }>({
    open: false,
    accountManager: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<AccountManagerRecord | null>(null);

  function openAdd() {
    setFormState({ open: true, accountManager: null });
  }

  function openEdit(accountManager: AccountManagerRecord) {
    setFormState({ open: true, accountManager });
  }

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Heading level={3}>Account Managers</Heading>
        <Text tone="muted">
          The people who can be assigned as a client&rsquo;s Account Manager on the Clients kanban board.
        </Text>
      </Stack>

      {loadError && <Text tone="danger">{loadError}</Text>}

      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAdd}>
            Add account manager
          </Button>
        </div>
      )}

      {accountManagers.length === 0 ? (
        <EmptyState
          icon={<Users />}
          heading="No account managers yet"
          text={canWrite ? "Add the first account manager." : "Nothing configured yet."}
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAdd}>
                Add account manager
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>First name</Table.HeaderCell>
              <Table.HeaderCell>Last name</Table.HeaderCell>
              {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {accountManagers.map((accountManager) => (
              <Table.Row key={accountManager.id}>
                <Table.Cell>
                  <Text>{accountManager.first_name}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text>{accountManager.last_name}</Text>
                </Table.Cell>
                {canWrite && (
                  <Table.Cell align="center">
                    <Button variant="outline" size="sm" onClick={() => openEdit(accountManager)}>
                      Edit
                    </Button>{" "}
                    <Button variant="danger" size="sm" onClick={() => setDeleteTarget(accountManager)}>
                      Delete
                    </Button>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {canWrite && (
        <>
          <AccountManagerFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            accountManager={formState.accountManager}
          />
          <DeleteAccountManagerDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            accountManager={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}
