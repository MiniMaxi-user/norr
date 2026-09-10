"use client";

import { useState } from "react";
import { Button, CompositionTree, EmptyState, Inline, Stack, Text } from "@yourorg/ui";
import { Check } from "@yourorg/ui/icons";
import type { SolutionSubtypeRecord } from "@/app/(app)/activities/solution-subtype-actions";
import {
  buildSolutionSubtypeTree,
  type SolutionSubtypeTreeNode,
} from "@/app/(app)/activities/solution-subtype-tree";
import { SolutionSubtypeFormDialog } from "./solution-subtype-form-dialog";
import { DeleteSolutionSubtypeDialog } from "./delete-solution-subtype-dialog";

export interface SolutionSubtypeManagerProps {
  subtypes: SolutionSubtypeRecord[];
  /** Non-fatal — same "still render with whatever it got" convention every
   * other manager on this board uses for its own `loadError`. */
  loadError?: string;
  /** Owner-only, per the `settings` RBAC entry — matches this table's own
   * owner-only write RLS with zero gap (see `solution-subtype-actions.ts`'s
   * module comment). */
  canWrite: boolean;
}

/**
 * "Solution Subtypes" settings leaf (issues #134/#138). Like `article_groups`,
 * `solution_subtypes` is its own table (not a `reference_list_items` row) and
 * an unlimited-depth parent/child tree — rendered with the same
 * `CompositionTree` primitive the Asset/Article composite (bill-of-materials)
 * trees already use (issues #134/#138 follow-up: "gebruik de layout van
 * subtypes dezelfde geneste layout van composite articles en composite
 * assets"), replacing the earlier nested-`Disclosure` rendering this leaf
 * originally shipped with — see `ActivitySubtypeManager`'s own doc comment
 * for the fuller reasoning (one `CompositionTree` per top-level subtype, each
 * root card tinted via `ui-composition-tree-root-tinted`), identical here.
 *
 * Zero twist vs. `ActivitySubtypeManager` — `solution_subtypes` is never
 * linked to Activity Type at any level.
 */
export function SolutionSubtypeManager({ subtypes, loadError, canWrite }: SolutionSubtypeManagerProps) {
  const tree = buildSolutionSubtypeTree(subtypes);
  const [formState, setFormState] = useState<{
    open: boolean;
    subtype: SolutionSubtypeRecord | null;
    parentSubtypeId?: string;
  }>({ open: false, subtype: null });
  const [deleteTarget, setDeleteTarget] = useState<SolutionSubtypeRecord | null>(null);

  function openAddTopLevel() {
    setFormState({ open: true, subtype: null, parentSubtypeId: undefined });
  }

  function openAddChild(parent: SolutionSubtypeRecord) {
    setFormState({ open: true, subtype: null, parentSubtypeId: parent.id });
  }

  function openEdit(subtype: SolutionSubtypeRecord) {
    setFormState({ open: true, subtype, parentSubtypeId: subtype.parent_subtype_id ?? undefined });
  }

  function renderNode(node: SolutionSubtypeTreeNode) {
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
          icon={<Check />}
          heading="No solution subtypes yet"
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
            <SolutionSubtypeFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              subtype={formState.subtype}
              parentSubtypeId={formState.parentSubtypeId}
              subtypes={subtypes}
            />
          )}
          <DeleteSolutionSubtypeDialog
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
