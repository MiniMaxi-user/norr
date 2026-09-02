"use client";

import { useState } from "react";
import { Button, Disclosure, EmptyState, Inline, Stack, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import { buildArticleGroupTree, type ArticleGroupTreeNode } from "@/app/(app)/articles/group-tree";
import { ArticleGroupFormDialog } from "./article-group-form-dialog";
import { DeleteArticleGroupDialog } from "./delete-article-group-dialog";

export interface ArticleGroupManagerProps {
  groups: ArticleGroupRecord[];
  /** Non-fatal — same "still render with whatever it got" convention every
   * other manager on this board uses for its own `loadError`. */
  loadError?: string;
  /** Owner/administratie only, per the `articles` RBAC entry — matches every
   * other write-gated manager on this board (all owner-only today; this one
   * is the first also open to `administratie`, same as the rest of the
   * Articles module — see `lib/rbac/permissions.ts`'s comment on `articles`). */
  canWrite: boolean;
}

/**
 * "Article Groups" tab on the Reference Lists settings screen (issue #92) —
 * a dedicated manager, not the generic `ReferenceListManager`: `article_groups`
 * is its own table (not a `reference_list_items` row) and, unlike every other
 * dependent list in this app (one level of nesting, e.g. Asset Sub-type under
 * Asset Type), it's a genuine unlimited-depth parent/child tree. Rendered as
 * a nested `Disclosure` list (docs/ARCHITECTURE.md "Relational detail pages":
 * "Group nested lists with Disclosure, not a flat table, once there's a
 * natural sub-grouping") rather than the flat add/edit/delete rows every
 * other manager on this board uses.
 */
export function ArticleGroupManager({ groups, loadError, canWrite }: ArticleGroupManagerProps) {
  const tree = buildArticleGroupTree(groups);
  const [formState, setFormState] = useState<{
    open: boolean;
    group: ArticleGroupRecord | null;
    parentGroupId?: string;
  }>({ open: false, group: null });
  const [deleteTarget, setDeleteTarget] = useState<ArticleGroupRecord | null>(null);

  function openAddTopLevel() {
    setFormState({ open: true, group: null, parentGroupId: undefined });
  }

  function openAddSubgroup(parent: ArticleGroupRecord) {
    setFormState({ open: true, group: null, parentGroupId: parent.id });
  }

  function openEdit(group: ArticleGroupRecord) {
    setFormState({ open: true, group, parentGroupId: group.parent_group_id ?? undefined });
  }

  return (
    <Stack gap="md">
      {loadError && <Text tone="danger">{loadError}</Text>}

      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAddTopLevel}>
            Add group
          </Button>
        </div>
      )}

      {tree.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          heading="No article groups yet"
          text={canWrite ? "Add the first group." : "Nothing configured yet."}
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAddTopLevel}>
                Add group
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Stack gap="sm">
          {tree.map((node) => (
            <GroupNode
              key={node.group.id}
              node={node}
              depth={0}
              canWrite={canWrite}
              onAddChild={openAddSubgroup}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </Stack>
      )}

      {canWrite && (
        <>
          <ArticleGroupFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            group={formState.group}
            parentGroupId={formState.parentGroupId}
            groups={groups}
          />
          <DeleteArticleGroupDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            group={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}

/** One node in the tree — a leaf renders as a plain row (no expand affordance
 * for nothing to expand); anything with subgroups renders as a `Disclosure`,
 * recursively, so an arbitrarily deep tree nests correctly. Action buttons
 * live in the `Disclosure.Summary`'s `meta` slot; each calls
 * `event.preventDefault()` first — a `<summary>` element's native "toggle on
 * click" activation behavior fires on ANY click within it (including a
 * nested button) unless the originating click event is prevented, so without
 * this every "Edit"/"Delete"/"Add subgroup" click would also silently
 * expand/collapse the row underneath it. */
function GroupNode({
  node,
  depth,
  canWrite,
  onAddChild,
  onEdit,
  onDelete,
}: {
  node: ArticleGroupTreeNode;
  depth: number;
  canWrite: boolean;
  onAddChild: (group: ArticleGroupRecord) => void;
  onEdit: (group: ArticleGroupRecord) => void;
  onDelete: (group: ArticleGroupRecord) => void;
}) {
  const actions = canWrite ? (
    <Inline gap="xs">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={(event) => {
          event.preventDefault();
          onAddChild(node.group);
        }}
      >
        Add subgroup
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={(event) => {
          event.preventDefault();
          onEdit(node.group);
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
          onDelete(node.group);
        }}
      >
        Delete
      </Button>
    </Inline>
  ) : null;

  if (node.children.length === 0) {
    return (
      <Inline gap="sm" align="center" justify="between">
        <Text>{node.group.name}</Text>
        {actions}
      </Inline>
    );
  }

  return (
    <Disclosure defaultOpen={depth === 0}>
      <Disclosure.Summary meta={actions}>{node.group.name}</Disclosure.Summary>
      <Disclosure.Content>
        <Stack gap="sm" style={{ paddingLeft: "1.25rem" }}>
          {node.children.map((child) => (
            <GroupNode
              key={child.group.id}
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
