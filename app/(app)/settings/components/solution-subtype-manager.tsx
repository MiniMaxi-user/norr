"use client";

import { useMemo, useState } from "react";
import { WebButton } from "@yourorg/ui/web";
import { StructureTree, type StructureTreeNode, type WebMenuItem } from "@yourorg/ui/web-client";
import type { SolutionSubtypeRecord } from "@/app/(app)/activities/solution-subtype-actions";
import {
  buildSolutionSubtypeTree,
  type SolutionSubtypeTreeNode,
} from "@/app/(app)/activities/solution-subtype-tree";
import { SolutionSubtypeFormDialog } from "./solution-subtype-form-dialog";
import { DeleteSolutionSubtypeDialog } from "./delete-solution-subtype-dialog";

export interface SolutionSubtypeManagerProps {
  subtypes: SolutionSubtypeRecord[];
  /** Non-fatal: still renders the tree (empty) with this message. */
  loadError?: string;
  /** Owner-only, per the `settings` RBAC entry. */
  canWrite: boolean;
}

/**
 * "Solution subtypes" settings leaf (issues #134/#138; design system #222) —
 * an unlimited-depth parent/child tree describing how an activity was
 * resolved, rendered with the shared `StructureTree`. `+ Subtype` adds a
 * top-level subtype in the toolbar; each row's ··· menu has Add subtype
 * (pre-scoped to that subtype), Edit and Delete.
 */
export function SolutionSubtypeManager({ subtypes, loadError, canWrite }: SolutionSubtypeManagerProps) {
  const [formState, setFormState] = useState<{
    open: boolean;
    subtype: SolutionSubtypeRecord | null;
    parentSubtypeId?: string;
  }>({ open: false, subtype: null });
  const [deleteTarget, setDeleteTarget] = useState<SolutionSubtypeRecord | null>(null);

  const nodes = useMemo<StructureTreeNode[]>(() => {
    function convert(node: SolutionSubtypeTreeNode): StructureTreeNode {
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
      return { id: subtype.id, label: subtype.name, actions, children: node.children.map(convert) };
    }
    return buildSolutionSubtypeTree(subtypes).map(convert);
  }, [subtypes, canWrite]);

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <StructureTree
        title="Solution subtypes"
        nodes={nodes}
        noun="subtypes"
        currentLabel="this subtype"
        childNoun="subtypes"
        treeHeader="Subtype"
        statusHeader=""
        ariaLabel="Solution subtypes"
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setFormState({ open: true, subtype: null, parentSubtypeId: undefined })}>
              + Subtype
            </WebButton>
          ) : undefined
        }
        emptyText={canWrite ? "No solution subtypes yet. Use + Subtype to add the first one." : "No solution subtypes yet."}
      />

      {canWrite ? (
        <>
          {formState.open ? (
            <SolutionSubtypeFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              subtype={formState.subtype}
              parentSubtypeId={formState.parentSubtypeId}
              subtypes={subtypes}
            />
          ) : null}
          <DeleteSolutionSubtypeDialog
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
