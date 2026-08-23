"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState, Heading, Stack, Table, Text } from "@yourorg/ui";
import { ArrowDown, ArrowUp, Settings } from "@yourorg/ui/icons";
import { updateReferenceItem, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DeleteReferenceItemDialog } from "./delete-reference-item-dialog";
import { ReferenceItemFormDialog } from "./reference-item-form-dialog";

export interface ReferenceListManagerProps {
  /** e.g. `"asset_type"` — see `lib/reference-lists/schema.ts` `listKeySchema`.
   * The only thing that changes between reference lists; everything else in
   * this component is generic over it. */
  listKey: string;
  title: string;
  description?: string;
  items: ReferenceListItemRecord[];
  /** Non-fatal — `listReferenceItems` failing (e.g. transient network) still
   * renders this component with whatever it got (`items` empty), plus this
   * message, rather than crashing the whole tab. */
  loadError?: string;
  /**
   * Whether the current actor can add/edit/reorder/delete values (owner
   * only, per the `settings` RBAC entry — see `lib/rbac/permissions.ts`).
   * `false` renders the exact same list read-only: "everyone can see what
   * the values mean, only the owner edits them."
   */
  canWrite: boolean;
  /** Non-null exactly when `listKey`'s own list is a *dependent* list (e.g.
   * `asset_subtype` -> `"asset_type"`) — see `reference_lists.parent_list_key`
   * in the contacts/dependent-lists migration. Drives both the parent-item
   * picker in the create/edit dialog and the resolved parent label shown per
   * row below. */
  parentListKey: string | null;
  /** Display title for `parentListKey` (e.g. `"Asset Type"`), for the picker
   * label — `undefined` when `parentListKey` is `null`. */
  parentListTitle?: string;
  /** Every item of the parent list (`parentListKey`), for resolving each of
   * `items`' `parent_item_id` to a label, and for populating the create/edit
   * dialog's parent picker. Empty when `parentListKey` is `null`. */
  parentItems: ReferenceListItemRecord[];
}

/**
 * Generic "manage this picklist" UI — fed just a `listKey` + display copy,
 * reused for every tenant-configurable reference list (Asset Type/Status
 * today; Contract Type etc. later, per docs/ARCHITECTURE.md "Tenant-
 * configurable reference data") instead of a bespoke screen per list. Adding
 * a third list is a config entry in `reference-lists-board.tsx`, not a new
 * component.
 */
export function ReferenceListManager({
  listKey,
  title,
  description,
  items,
  loadError,
  canWrite,
  parentListKey,
  parentListTitle,
  parentItems,
}: ReferenceListManagerProps) {
  const router = useRouter();
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const parentById = useMemo(() => new Map(parentItems.map((item) => [item.id, item])), [parentItems]);

  const [formState, setFormState] = useState<{ open: boolean; item: ReferenceListItemRecord | null }>({
    open: false,
    item: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<ReferenceListItemRecord | null>(null);
  const [isReordering, startReordering] = useTransition();

  function openAdd() {
    setFormState({ open: true, item: null });
  }

  function openEdit(item: ReferenceListItemRecord) {
    setFormState({ open: true, item });
  }

  function move(index: number, direction: -1 | 1) {
    const current = sorted[index];
    const target = sorted[index + direction];
    if (!current || !target) return;
    startReordering(async () => {
      await Promise.all([
        updateReferenceItem(current.id, { sortOrder: target.sort_order }),
        updateReferenceItem(target.id, { sortOrder: current.sort_order }),
      ]);
      router.refresh();
    });
  }

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Heading level={3}>{title}</Heading>
        {description && <Text tone="muted">{description}</Text>}
      </Stack>

      {loadError && <Text tone="danger">{loadError}</Text>}

      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAdd}>
            Add value
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Settings />}
          heading="No values yet"
          text={canWrite ? "Add the first value for this list." : "Nothing configured for this list yet."}
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAdd}>
                Add value
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              {canWrite && <Table.HeaderCell align="center">Order</Table.HeaderCell>}
              <Table.HeaderCell>Color</Table.HeaderCell>
              <Table.HeaderCell>Label</Table.HeaderCell>
              <Table.HeaderCell>Value</Table.HeaderCell>
              <Table.HeaderCell align="center">Default</Table.HeaderCell>
              {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {sorted.map((item, index) => (
              <Table.Row key={item.id}>
                {canWrite && (
                  <Table.Cell align="center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={index === 0 || isReordering}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${item.label} up`}
                    >
                      <ArrowUp />
                    </Button>{" "}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={index === sorted.length - 1 || isReordering}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${item.label} down`}
                    >
                      <ArrowDown />
                    </Button>
                  </Table.Cell>
                )}
                <Table.Cell>
                  <Badge color={item.color}>{item.color ?? "default"}</Badge>
                </Table.Cell>
                <Table.Cell>
                  <Stack gap="xs">
                    <Text>{item.label}</Text>
                    {item.parent_item_id && (
                      <Text tone="muted">under {parentById.get(item.parent_item_id)?.label ?? "—"}</Text>
                    )}
                  </Stack>
                </Table.Cell>
                <Table.Cell>
                  <Text tone="muted">{item.value}</Text>
                </Table.Cell>
                <Table.Cell align="center">
                  {item.is_default ? <Badge variant="accent">Default</Badge> : <Text tone="muted">—</Text>}
                </Table.Cell>
                {canWrite && (
                  <Table.Cell align="center">
                    <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                      Edit
                    </Button>{" "}
                    <Button variant="danger" size="sm" onClick={() => setDeleteTarget(item)}>
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
          <ReferenceItemFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            listKey={listKey}
            item={formState.item}
            parentListKey={parentListKey}
            parentListTitle={parentListTitle}
            parentItems={parentItems}
          />
          <DeleteReferenceItemDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            item={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}
