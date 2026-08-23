"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState, Stack, Table, Text } from "@yourorg/ui";
import { ArrowDown, ArrowUp, FileText } from "@yourorg/ui/icons";
import { updateChecklistTemplateItem, type ChecklistTemplateItemRecord } from "@/lib/checklist-templates/actions";
import { ChecklistTemplateItemFormDialog } from "./checklist-template-item-form-dialog";
import { DeleteChecklistTemplateItemDialog } from "./delete-checklist-template-item-dialog";

export interface ChecklistTemplateItemsManagerProps {
  templateId: string;
  items: ChecklistTemplateItemRecord[];
  canWrite: boolean;
}

/**
 * "Manage this template's items" — add/edit/reorder-via-sort_order/delete/
 * toggle required. Same generic shape as `ReferenceListManager` (reorder via
 * swapping `sort_order` between adjacent rows, a Dialog per add/edit), just
 * without the color/dependent-parent concerns that component carries — a
 * checklist item only has a label and a required flag.
 */
export function ChecklistTemplateItemsManager({ templateId, items, canWrite }: ChecklistTemplateItemsManagerProps) {
  const router = useRouter();
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);

  const [formState, setFormState] = useState<{ open: boolean; item: ChecklistTemplateItemRecord | null }>({
    open: false,
    item: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<ChecklistTemplateItemRecord | null>(null);
  const [isReordering, startReordering] = useTransition();

  function openAdd() {
    setFormState({ open: true, item: null });
  }

  function openEdit(item: ChecklistTemplateItemRecord) {
    setFormState({ open: true, item });
  }

  function move(index: number, direction: -1 | 1) {
    const current = sorted[index];
    const target = sorted[index + direction];
    if (!current || !target) return;
    startReordering(async () => {
      await Promise.all([
        updateChecklistTemplateItem(current.id, { sortOrder: target.sort_order }),
        updateChecklistTemplateItem(target.id, { sortOrder: current.sort_order }),
      ]);
      router.refresh();
    });
  }

  return (
    <Stack gap="sm">
      {canWrite && (
        <div>
          <Button variant="outline" size="sm" onClick={openAdd}>
            Add item
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          heading="No items yet"
          text={canWrite ? "Add the first item on this checklist." : "Nothing configured on this checklist yet."}
          action={
            canWrite ? (
              <Button variant="outline" onClick={openAdd}>
                Add item
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              {canWrite && <Table.HeaderCell align="center">Order</Table.HeaderCell>}
              <Table.HeaderCell>Label</Table.HeaderCell>
              <Table.HeaderCell align="center">Required</Table.HeaderCell>
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
                <Table.Cell>{item.label}</Table.Cell>
                <Table.Cell align="center">
                  {item.is_required ? <Badge variant="accent">Required</Badge> : <Text tone="muted">—</Text>}
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
          <ChecklistTemplateItemFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((state) => ({ ...state, open }))}
            templateId={templateId}
            item={formState.item}
          />
          <DeleteChecklistTemplateItemDialog
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
