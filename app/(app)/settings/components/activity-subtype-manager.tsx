"use client";

import { useState } from "react";
import { Button, CompositionTree, EmptyState, Inline, Stack, Text } from "@yourorg/ui";
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
 * "Activity Subtypes" settings leaf (issues #134/#138) — `activity_subtypes`
 * is its own table (not a `reference_list_items` row) and an unlimited-depth
 * parent/child tree. Rendered with the same `CompositionTree` primitive the
 * Asset/Article composite (bill-of-materials) trees already use (issues
 * #134/#138 follow-up: "gebruik de layout van subtypes dezelfde geneste
 * layout van composite articles en composite assets"), replacing the
 * earlier nested-`Disclosure` rendering this leaf originally shipped with —
 * one `CompositionTree` per top-level subtype (this org can have several
 * independent root subtypes, one per `activity_type` branch), since that
 * primitive itself renders exactly one rooted tree. Each tree's own root
 * card gets a distinct background (`ui-composition-tree-root-tinted`, see
 * that class's own comment in `packages/ui/src/styles.css`) so a top-level
 * parent reads as visually distinct from the plain-background cards nested
 * beneath it, per the same follow-up ask.
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

  function renderNode(node: ActivitySubtypeTreeNode) {
    return (
      <Inline gap="sm" align="center" justify="between" style={{ width: "100%" }}>
        <Text>{node.subtype.name}</Text>
        {canWrite && (
          <Inline gap="xs">
            <Button type="button" variant="outline" size="sm" onClick={() => openAddChild(node.subtype)}>
              Add subtype
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => openEdit(node.subtype)}>
              Edit
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={() => setDeleteTarget(node.subtype)}>
              Delete
            </Button>
          </Inline>
        )}
      </Inline>
    );
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
        <Stack gap="md">
          {tree.map((node) => (
            <CompositionTree
              key={node.subtype.id}
              className="ui-composition-tree-root-tinted"
              root={node}
              getChildren={(n) => n.children}
              getKey={(n) => n.subtype.id}
              renderNode={renderNode}
            />
          ))}
        </Stack>
      )}

      {canWrite && (
        <>
          {formState.open && (
            <ActivitySubtypeFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              subtype={formState.subtype}
              parentSubtypeId={formState.parentSubtypeId}
              subtypes={subtypes}
              typeItems={typeItems}
            />
          )}
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
