"use client";

import { useMemo, useState } from "react";
import { WebButton } from "@yourorg/ui/web";
import { StructureTree, type StructureTreeNode, type WebMenuItem } from "@yourorg/ui/web-client";
import type { ActivitySubtypeRecord } from "@/app/(app)/activities/subtypes-actions";
import { buildActivitySubtypeTree, type ActivitySubtypeTreeNode } from "@/app/(app)/activities/subtype-tree";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ActivitySubtypeFormDialog } from "./activity-subtype-form-dialog";
import { DeleteActivitySubtypeDialog } from "./delete-activity-subtype-dialog";

export interface ActivitySubtypeManagerProps {
  subtypes: ActivitySubtypeRecord[];
  /** This org's `activity_type` reference-list items, for the form dialog's
   * root-only Activity Type field and the tree's Activity type column. */
  typeItems: ReferenceListItemRecord[];
  /** Non-fatal: still renders the tree (empty) with this message. */
  loadError?: string;
  /** Owner-only, per the `settings` RBAC entry. */
  canWrite: boolean;
}

/**
 * "Activity subtypes" settings leaf (issues #134/#138; design system #222) —
 * an unlimited-depth parent/child tree rendered with the shared
 * `StructureTree`. A top-level subtype must carry an Activity type (a DB
 * CHECK; the form dialog handles it) and shows it in the tree's right-hand
 * column. `+ Subtype` adds a top-level subtype in the toolbar; each row's ···
 * menu has Add subtype (pre-scoped to that subtype), Edit and Delete.
 */
export function ActivitySubtypeManager({ subtypes, typeItems, loadError, canWrite }: ActivitySubtypeManagerProps) {
  const [formState, setFormState] = useState<{
    open: boolean;
    subtype: ActivitySubtypeRecord | null;
    parentSubtypeId?: string;
  }>({ open: false, subtype: null });
  const [deleteTarget, setDeleteTarget] = useState<ActivitySubtypeRecord | null>(null);

  const nodes = useMemo<StructureTreeNode[]>(() => {
    const typeLabels = new Map(typeItems.map((item) => [item.id, item.label]));
    function convert(node: ActivitySubtypeTreeNode): StructureTreeNode {
      const subtype = node.subtype;
      const actions: WebMenuItem[] = canWrite
        ? [
            {
              key: "add",
              label: "Add subtype…",
              onSelect: () => setFormState({ open: true, subtype: null, parentSubtypeId: subtype.id }),
            },
            {
              key: "edit",
              label: "Edit…",
              onSelect: () =>
                setFormState({ open: true, subtype, parentSubtypeId: subtype.parent_subtype_id ?? undefined }),
            },
            { type: "separator", key: "sep" },
            { key: "delete", label: "Delete", danger: true, onSelect: () => setDeleteTarget(subtype) },
          ]
        : [];
      const typeLabel = subtype.type_id ? typeLabels.get(subtype.type_id) : undefined;
      return {
        id: subtype.id,
        label: subtype.name,
        status: typeLabel ? { label: typeLabel, tone: "neutral" } : null,
        actions,
        children: node.children.map(convert),
      };
    }
    return buildActivitySubtypeTree(subtypes).map(convert);
  }, [subtypes, typeItems, canWrite]);

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <StructureTree
        title="Activity subtypes"
        nodes={nodes}
        noun="subtypes"
        currentLabel="this subtype"
        childNoun="subtypes"
        treeHeader="Subtype"
        statusHeader="Activity type"
        ariaLabel="Activity subtypes"
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setFormState({ open: true, subtype: null, parentSubtypeId: undefined })}>
              + Subtype
            </WebButton>
          ) : undefined
        }
        emptyText={canWrite ? "No activity subtypes yet. Use + Subtype to add the first one." : "No activity subtypes yet."}
      />

      {canWrite ? (
        <>
          {formState.open ? (
            <ActivitySubtypeFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              subtype={formState.subtype}
              parentSubtypeId={formState.parentSubtypeId}
              subtypes={subtypes}
              typeItems={typeItems}
            />
          ) : null}
          <DeleteActivitySubtypeDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            subtype={deleteTarget}
          />
        </>
      ) : null}
    </div>
  );
}
