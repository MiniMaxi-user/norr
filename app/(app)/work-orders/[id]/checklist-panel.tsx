"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Checkbox, EmptyState, Heading, Input, Inline, Select, Stack, Table, Text, Textarea, Toolbar } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
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
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";

export interface ChecklistPanelProps {
  workOrderId: string;
  /** `null` when no checklist has been attached to this work order yet — a
   * valid, non-error state (see `getWorkOrderChecklist`'s own doc comment). */
  checklist: WorkOrderChecklistRecord | null;
  items: WorkOrderChecklistItemRecord[];
  /** Every checklist template this org has configured, for the "attach a
   * checklist" picker — only meaningful (and only fetched by the parent
   * page) when `canAttach` is true and no checklist exists yet. */
  templates: ChecklistTemplateRecord[];
  members: OrgMemberRecord[];
  currentUserId: string;
  /** `can(actor, "checklists", "create")` — owner/planner only: attaching a
   * checklist to this work order, and adding an ad-hoc item beyond whatever
   * the template snapshotted. */
  canAttach: boolean;
  /** `can(actor, "checklists", "delete")` — owner/planner only: detaching
   * the whole checklist (the "I picked the wrong template" path — delete +
   * re-attach, since `checklist_template_id` is immutable after creation),
   * and removing a single item. */
  canDetach: boolean;
  /** `can(actor, "checklists", "update")` — owner/planner can check off /
   * annotate items on ANY work order's checklist. */
  canUpdateAny: boolean;
  /** `can(actor, "checklists", "update_own")` — an engineer can only check
   * off / annotate items on their OWN assigned work order's checklist.
   * Unlike Time Entries' per-row `assigned_to` check, this is gated for the
   * WHOLE checklist section at once against `checklist.assigned_to` (see
   * `canEditChecklist` below) — a work order has at most one checklist, so
   * there's no per-row ownership to vary, only per-work-order. RLS
   * (`work_order_checklist_items_update_scoped`) enforces the real boundary
   * independently regardless; this purely hides an affordance that would
   * otherwise just fail server-side.
   */
  canUpdateOwn: boolean;
}

/**
 * "Checklist" — the `work_order_checklists`/`work_order_checklist_items`
 * sub-resource of one Work Order (issue #14), surfaced as a Card at the same
 * placement tier as `TimeEntriesPanel` (docs/ARCHITECTURE.md "Relational
 * detail pages" / "Popup vs. full page": scoped to exactly one work order,
 * so a section on its detail page is the right weight, not a separate
 * route).
 */
export function ChecklistPanel({
  workOrderId,
  checklist,
  items,
  templates,
  members,
  currentUserId,
  canAttach,
  canDetach,
  canUpdateAny,
  canUpdateOwn,
}: ChecklistPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [newItemLabel, setNewItemLabel] = useState("");
  // A plain mutable map (not React state) for in-flight notes edits — read
  // only on blur, so a keystroke never triggers a re-render, same "no state
  // needed for what's really just a debounced side effect" shape as
  // `TimeEntriesPanel`'s clock-in type `Select`.
  const notesDrafts = useRef(new Map<string, string>()).current;

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const sorted = useMemo(() => [...items].sort((a, b) => a.sort_order - b.sort_order), [items]);

  // Whole-section gate (see `canUpdateOwn`'s doc comment above): an engineer
  // may only interact with items on their OWN assigned work order's
  // checklist.
  const canEditChecklist = canUpdateAny || (canUpdateOwn && checklist?.assigned_to === currentUserId);

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

  function handleAttach() {
    runAction(() => attachChecklistTemplate(workOrderId, selectedTemplateId || null));
  }

  function handleDetach() {
    if (!checklist) return;
    runAction(() => detachChecklist(checklist.id));
  }

  function handleToggle(item: WorkOrderChecklistItemRecord, checked: boolean) {
    runAction(() => toggleChecklistItem(item.id, checked));
  }

  function handleNotesBlur(item: WorkOrderChecklistItemRecord) {
    const draft = notesDrafts.get(item.id);
    if (draft === undefined || draft === (item.notes ?? "")) return;
    runAction(() => updateChecklistItemNotes(item.id, draft));
  }

  function handleAddItem() {
    if (!checklist || !newItemLabel.trim()) return;
    runAction(() => addAdhocChecklistItem(checklist.id, { label: newItemLabel.trim() }), () => setNewItemLabel(""));
  }

  function handleDeleteItem(id: string) {
    runAction(() => deleteChecklistItem(id));
  }

  return (
    <Card>
      <Stack gap="md">
        <Toolbar>
          <Toolbar.Section>
            <Heading level={3}>Checklist</Heading>
          </Toolbar.Section>
          {checklist && canDetach && (
            <Toolbar.Section align="end">
              <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleDetach}>
                Detach checklist
              </Button>
            </Toolbar.Section>
          )}
        </Toolbar>

        {error && <Text tone="danger">{error}</Text>}

        {!checklist ? (
          canAttach ? (
            <Stack gap="sm">
              <Text tone="muted">Attach a checklist template to this work order, or start with a blank one.</Text>
              <Inline gap="sm" align="center">
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
                <Button type="button" variant="primary" disabled={isPending} onClick={handleAttach}>
                  {isPending ? "Attaching…" : "Attach checklist"}
                </Button>
              </Inline>
            </Stack>
          ) : (
            <EmptyState
              icon={<FileText />}
              heading="No checklist attached"
              text="An owner or planner hasn't attached a checklist to this work order yet."
            />
          )
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            heading="Checklist is empty"
            text={canAttach ? "Add the first item below." : "No items on this checklist yet."}
          />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell align="center">Done</Table.HeaderCell>
                <Table.HeaderCell>Item</Table.HeaderCell>
                <Table.HeaderCell>Notes</Table.HeaderCell>
                <Table.HeaderCell>Checked by</Table.HeaderCell>
                {canDetach && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {sorted.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell align="center">
                    <Checkbox
                      aria-label={`Mark "${item.label}" as ${item.is_checked ? "not done" : "done"}`}
                      checked={item.is_checked}
                      disabled={!canEditChecklist || isPending}
                      onChange={(event) => handleToggle(item, event.target.checked)}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Inline gap="xs" align="center">
                      <Text>{item.label}</Text>
                      {item.is_required && <Badge variant="danger">Required</Badge>}
                    </Inline>
                  </Table.Cell>
                  <Table.Cell>
                    <Textarea
                      aria-label={`Notes for "${item.label}"`}
                      rows={1}
                      defaultValue={item.notes ?? ""}
                      disabled={!canEditChecklist || isPending}
                      onChange={(event) => notesDrafts.set(item.id, event.target.value)}
                      onBlur={() => handleNotesBlur(item)}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Text tone="muted">
                      {item.checked_by ? memberDisplayName(memberById.get(item.checked_by)) : "—"}
                    </Text>
                  </Table.Cell>
                  {canDetach && (
                    <Table.Cell align="center">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleDeleteItem(item.id)}
                      >
                        Remove
                      </Button>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        {checklist && canAttach && (
          <Inline gap="sm" align="center">
            <Input
              aria-label="New item label"
              placeholder="Add an item…"
              value={newItemLabel}
              disabled={isPending}
              onChange={(event) => setNewItemLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddItem();
                }
              }}
            />
            <Button type="button" variant="outline" disabled={isPending || !newItemLabel.trim()} onClick={handleAddItem}>
              Add item
            </Button>
          </Inline>
        )}
      </Stack>
    </Card>
  );
}
