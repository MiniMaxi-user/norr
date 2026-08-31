"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Dialog, EmptyState, IconButton, Input, RowCard, SectionHeader, Select, Stack, Text, Textarea } from "@yourorg/ui";
import { ClipboardList, Pencil, Trash2 } from "@yourorg/ui/icons";
import {
  addAdhocChecklistItem,
  attachChecklistTemplate,
  deleteChecklistItem,
  detachChecklist,
  toggleChecklistItem,
  updateChecklistItemNotes,
  type WorkOrderChecklistItemRecord,
  type WorkOrderChecklistRecord,
} from "../checklist-actions";
import type { ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import { formatTimeOfDay } from "./format-work-order-time";

export interface WorkOrderChecklistSectionProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"` — used to attach a brand-new checklist. */
  workOrderId?: string;
  checklist: WorkOrderChecklistRecord | null;
  items: WorkOrderChecklistItemRecord[];
  templates: ChecklistTemplateRecord[];
  currentUserId?: string;
  canAccess: boolean;
  canAttach: boolean;
  canDetach: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
}

/**
 * Compact "Checklist" column (issue #102) — icon + serif title + divider +
 * `n / total` count on the header line, then a checkmark/open row per item.
 * Replaces `ChecklistPanel`'s old inline attach/manage controls with a small
 * Edit popup (the issue's own flagged gap: "how do you even pick a
 * checklist template? — add an Edit button, same as Client/Site/Asset/
 * Contract"). Checking/unchecking an item stays a direct row click (the
 * single most common action here) — only attaching/detaching the template
 * and adding/removing/annotating items live behind the popup.
 *
 * Not rendered at all (per CLAUDE.md rule 3 / docs/ARCHITECTURE.md feature
 * flags) when `canAccess` is false — `checklists` is its own separately-
 * entitled module, same gate `[id]/page.tsx` already applies. `mode:
 * "create"` always renders the empty state (no `work_order_id` yet to
 * attach a checklist to).
 */
export function WorkOrderChecklistSection({
  mode,
  workOrderId,
  checklist,
  items,
  templates,
  currentUserId,
  canAccess,
  canAttach,
  canDetach,
  canUpdateAny,
  canUpdateOwn,
}: WorkOrderChecklistSectionProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);

  const sorted = useMemo(() => [...items].sort((a, b) => a.sort_order - b.sort_order), [items]);
  const checkedCount = sorted.filter((item) => item.is_checked).length;
  const canEditItems = canUpdateAny || (canUpdateOwn && checklist?.assigned_to === currentUserId);

  if (!canAccess) return null;

  function handleToggle(item: WorkOrderChecklistItemRecord) {
    setToggleError(null);
    startTransition(async () => {
      const result = await toggleChecklistItem(item.id, !item.is_checked);
      if (!result.data) {
        setToggleError(result.error ?? "Could not update this item.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Stack gap="md">
      <SectionHeader
        icon={ClipboardList}
        title="Checklist"
        actions={
          <>
            <Text tone="muted">
              {checklist ? `${checkedCount} / ${sorted.length}` : "—"}
            </Text>
            {(canAttach || canDetach) && mode === "edit" && (
              <IconButton variant="ghost" aria-label="Edit checklist" onClick={() => setDialogOpen(true)}>
                <Pencil />
              </IconButton>
            )}
          </>
        }
      />

      {toggleError && <Text tone="danger">{toggleError}</Text>}

      {mode === "create" ? (
        <EmptyState
          icon={<ClipboardList />}
          heading="No checklist yet"
          text="Save the work order first, then attach a checklist template."
        />
      ) : !checklist ? (
        <EmptyState
          icon={<ClipboardList />}
          heading="No checklist attached"
          text={
            canAttach
              ? "Use Edit to attach a checklist template, or start with a blank one."
              : "An owner or planner hasn't attached a checklist to this work order yet."
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          heading="Checklist is empty"
          text={canAttach ? "Use Edit to add the first item." : "No items on this checklist yet."}
        />
      ) : (
        <Stack gap="xs">
          {sorted.map((item) => (
            <RowCard
              key={item.id}
              tone={item.is_checked ? "default" : "dashed"}
              className="ui-work-order-checklist-row"
              onClick={canEditItems ? () => handleToggle(item) : undefined}
              role={canEditItems ? "button" : undefined}
            >
              <span
                className={
                  item.is_checked ? "ui-work-order-check ui-work-order-check-done" : "ui-work-order-check"
                }
                aria-hidden="true"
              >
                {item.is_checked ? "✓" : ""}
              </span>
              <Text className="ui-work-order-checklist-label">{item.label}</Text>
              {item.is_required && <Badge variant="warning">Required</Badge>}
              <Text tone="muted">{item.is_checked ? formatTimeOfDay(item.checked_at) : "Open"}</Text>
            </RowCard>
          ))}
        </Stack>
      )}

      {dialogOpen && (
        <WorkOrderChecklistDialog
          open
          onOpenChange={setDialogOpen}
          checklist={checklist}
          workOrderId={workOrderId}
          items={sorted}
          templates={templates}
          canAttach={canAttach}
          canDetach={canDetach}
        />
      )}
    </Stack>
  );
}

function WorkOrderChecklistDialog({
  open,
  onOpenChange,
  checklist,
  workOrderId,
  items,
  templates,
  canAttach,
  canDetach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklist: WorkOrderChecklistRecord | null;
  workOrderId?: string;
  items: WorkOrderChecklistItemRecord[];
  templates: ChecklistTemplateRecord[];
  canAttach: boolean;
  canDetach: boolean;
}) {
  const router = useRouter();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [newItemLabel, setNewItemLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runAction(task: () => Promise<{ data?: unknown; error?: string }>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.data) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Edit checklist</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          {!checklist ? (
            canAttach && (
              <Stack gap="sm">
                <Text tone="muted">Attach a checklist template, or start with a blank one.</Text>
                <Select
                  aria-label="Checklist template"
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  disabled={isPending}
                >
                  <option value="">Start blank</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="primary"
                  disabled={isPending || !workOrderId}
                  onClick={() =>
                    workOrderId &&
                    runAction(() => attachChecklistTemplate(workOrderId, selectedTemplateId || null))
                  }
                >
                  Attach checklist
                </Button>
              </Stack>
            )
          ) : (
            <>
              {items.length > 0 && (
                <Stack gap="sm">
                  {items.map((item) => (
                    <Stack gap="xs" key={item.id}>
                      <Text>{item.label}</Text>
                      <Textarea
                        aria-label={`Notes for "${item.label}"`}
                        rows={1}
                        defaultValue={item.notes ?? ""}
                        onBlur={(event) => {
                          if (event.target.value !== (item.notes ?? "")) {
                            runAction(() => updateChecklistItemNotes(item.id, event.target.value));
                          }
                        }}
                      />
                      {canDetach && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={isPending}
                          onClick={() => runAction(() => deleteChecklistItem(item.id))}
                        >
                          <Trash2 /> Remove item
                        </Button>
                      )}
                    </Stack>
                  ))}
                </Stack>
              )}

              {canAttach && (
                <Stack gap="sm">
                  <Input
                    aria-label="New item label"
                    placeholder="Add an item…"
                    value={newItemLabel}
                    disabled={isPending}
                    onChange={(event) => setNewItemLabel(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending || !newItemLabel.trim()}
                    onClick={() =>
                      runAction(
                        () => addAdhocChecklistItem(checklist.id, { label: newItemLabel.trim() }),
                        () => setNewItemLabel(""),
                      )
                    }
                  >
                    Add item
                  </Button>
                </Stack>
              )}

              {canDetach && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => runAction(() => detachChecklist(checklist.id))}
                >
                  Detach checklist
                </Button>
              )}
            </>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
