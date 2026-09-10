"use client";

import { useState } from "react";
import { Button, Disclosure, EmptyState, Inline, Stack, Text } from "@yourorg/ui";
import { AlertTriangle } from "@yourorg/ui/icons";
import type { ActivitySubtypeRecord } from "@/app/(app)/activities/subtypes-actions";
import { buildActivitySubtypeTree, type ActivitySubtypeTreeNode } from "@/app/(app)/activities/subtype-tree";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ActivitySubtypeFormDialog } from "./activity-subtype-form-dialog";
import { DeleteActivitySubtypeDialog } from "./delete-activity-subtype-dialog";

export interface ActivitySubtypeManagerProps {
  subtypes: ActivitySubtypeRecord[];
  /** This org's `activity_type` reference-list items, for the Activity
   * Subtype form dialog's root-only Activity Type field. */
  typeItems: ReferenceListItemRecord[];
  /** Non-fatal — same "still render with whatever it got" convention every
   * other manager on this board uses for its own `loadError`. */
  loadError?: string;
  /** Owner-only, per the `settings` RBAC entry — matches this table's own
   * owner-only write RLS with zero gap (see `subtypes-actions.ts`'s module
   * comment). */
  canWrite: boolean;
}

/**
 * "Activity Subtypes" settings leaf (issues #134/#138) — mirrors
 * `ArticleGroupManager` exactly: `activity_subtypes` is its own table (not a
 * `reference_list_items` row) and an unlimited-depth parent/child tree,
 * rendered as nested `Disclosure`s (docs/ARCHITECTURE.md "Relational detail
 * pages") rather than the flat add/edit/delete rows every other manager on
 * this board uses.
 *
 * The one twist vs. `ArticleGroupManager`/`SolutionSubtypeManager`: a
 * root-level (`parent_subtype_id is null`) subtype MUST carry a `type_id`
 * (enforced by the DB's `activity_subtypes_root_xor_parent` CHECK) — handled
 * entirely inside `ActivitySubtypeFormDialog`, not here; this manager just
 * threads `typeItems` down to it.
 */
export function ActivitySubtypeManager({ subtypes, typeItems, loadError, canWrite }: ActivitySubtypeManagerProps) {
  const tree = buildActivitySubtypeTree(subtypes);
  const [formState, setFormState] = useState<{
    open: boolean;
    subtype: ActivitySubtypeRecord | null;
    parentSubtypeId?: string;
  }>({ open: false, subtype: null });
  const [deleteTarget, setDeleteTarget] = useState<ActivitySubtypeRecord | null>(null);

  function openAddTopLevel() {
    setFormState({ open: true, subtype: null, parentSubtypeId: undefined });
  }

  function openAddChild(parent: ActivitySubtypeRecord) {
    setFormState({ open: true, subtype: null, parentSubtypeId: parent.id });
  }

  function openEdit(subtype: ActivitySubtypeRecord) {
    setFormState({ open: true, subtype, parentSubtypeId: subtype.parent_subtype_id ?? undefined });
  }

  return (
    <Stack gap="md">
      {loadError && <Text tone="danger">{loadError}</Text>}

      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAddTopLevel}>
            Add subtype
          </Button>
        </div>
      )}

      {tree.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle />}
          heading="No activity subtypes yet"
          text={canWrite ? "Add the first subtype." : "Nothing configured yet."}
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAddTopLevel}>
                Add subtype
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Stack gap="sm">
          {tree.map((node) => (
            <SubtypeNode
              key={node.subtype.id}
              node={node}
              depth={0}
              canWrite={canWrite}
              onAddChild={openAddChild}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </Stack>
      )}

      {canWrite && (
        <>
          <ActivitySubtypeFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            subtype={formState.subtype}
            parentSubtypeId={formState.parentSubtypeId}
            subtypes={subtypes}
            typeItems={typeItems}
          />
          <DeleteActivitySubtypeDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            subtype={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}

/** One node in the tree — a leaf renders as a plain row (no expand affordance
 * for nothing to expand); anything with children renders as a `Disclosure`,
 * recursively, so an arbitrarily deep tree nests correctly. Action buttons
 * live in the `Disclosure.Summary`'s `meta` slot; each calls
 * `event.preventDefault()` first — a `<summary>` element's native "toggle on
 * click" activation behavior fires on ANY click within it (including a
 * nested button) unless the originating click event is prevented, so without
 * this every "Edit"/"Delete"/"Add subtype" click would also silently
 * expand/collapse the row underneath it. */
function SubtypeNode({
  node,
  depth,
  canWrite,
  onAddChild,
  onEdit,
  onDelete,
}: {
  node: ActivitySubtypeTreeNode;
  depth: number;
  canWrite: boolean;
  onAddChild: (subtype: ActivitySubtypeRecord) => void;
  onEdit: (subtype: ActivitySubtypeRecord) => void;
  onDelete: (subtype: ActivitySubtypeRecord) => void;
}) {
  const actions = canWrite ? (
    <Inline gap="xs">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={(event) => {
          event.preventDefault();
          onAddChild(node.subtype);
        }}
      >
        Add subtype
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={(event) => {
          event.preventDefault();
          onEdit(node.subtype);
        }}
      >
        Edit
      </Button>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={(event) => {
          event.preventDefault();
          onDelete(node.subtype);
        }}
      >
        Delete
      </Button>
    </Inline>
  ) : null;

  if (node.children.length === 0) {
    return (
      <Inline gap="sm" align="center" justify="between">
        <Text>{node.subtype.name}</Text>
        {actions}
      </Inline>
    );
  }

  return (
    <Disclosure defaultOpen={depth === 0}>
      <Disclosure.Summary meta={actions}>{node.subtype.name}</Disclosure.Summary>
      <Disclosure.Content>
        <Stack gap="sm" style={{ paddingLeft: "1.25rem" }}>
          {node.children.map((child) => (
            <SubtypeNode
              key={child.subtype.id}
              node={child}
              depth={depth + 1}
              canWrite={canWrite}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </Stack>
      </Disclosure.Content>
    </Disclosure>
  );
}
