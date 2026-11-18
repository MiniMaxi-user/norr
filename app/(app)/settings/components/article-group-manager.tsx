"use client";

import { useMemo, useState } from "react";
import { WebButton } from "@yourorg/ui/web";
import { StructureTree, type StructureTreeNode, type WebMenuItem } from "@yourorg/ui/web-client";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import { buildArticleGroupTree, type ArticleGroupTreeNode } from "@/app/(app)/articles/group-tree";
import { ArticleGroupFormDialog } from "./article-group-form-dialog";
import { DeleteArticleGroupDialog } from "./delete-article-group-dialog";

export interface ArticleGroupManagerProps {
  groups: ArticleGroupRecord[];
  /** Non-fatal: `listArticleGroups` failing still renders the tree (empty)
   * with this message. */
  loadError?: string;
  /** Owner/administratie only, per the `articles` RBAC entry (not `settings`:
   * `articles` is the one module where `administratie` also writes). */
  canWrite: boolean;
}

/**
 * "Article groups" settings leaf (issue #92; design system #222) — an
 * unlimited-depth parent/child tree of catalog categories, rendered with the
 * shared `StructureTree` (same component as the asset Structure tab and the
 * article Bill of materials). `+ Group` adds a top-level group in the toolbar;
 * each row's ··· menu has Add subgroup (pre-scoped to that group), Edit and
 * Delete. The create/edit form stays a small dialog.
 */
export function ArticleGroupManager({ groups, loadError, canWrite }: ArticleGroupManagerProps) {
  const [formState, setFormState] = useState<{
    open: boolean;
    group: ArticleGroupRecord | null;
    parentGroupId?: string;
  }>({ open: false, group: null });
  const [deleteTarget, setDeleteTarget] = useState<ArticleGroupRecord | null>(null);

  const nodes = useMemo<StructureTreeNode[]>(() => {
    function convert(node: ArticleGroupTreeNode): StructureTreeNode {
      const group = node.group;
      const actions: WebMenuItem[] = canWrite
        ? [
            {
              key: "add",
              label: "Add subgroup…",
              onSelect: () => setFormState({ open: true, group: null, parentGroupId: group.id }),
            },
            {
              key: "edit",
              label: "Edit…",
              onSelect: () => setFormState({ open: true, group, parentGroupId: group.parent_group_id ?? undefined }),
            },
            { type: "separator", key: "sep" },
            { key: "delete", label: "Delete", danger: true, onSelect: () => setDeleteTarget(group) },
          ]
        : [];
      return { id: group.id, label: group.name, actions, children: node.children.map(convert) };
    }
    return buildArticleGroupTree(groups).map(convert);
  }, [groups, canWrite]);

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <StructureTree
        title="Article groups"
        nodes={nodes}
        noun="groups"
        currentLabel="this group"
        childNoun="subgroups"
        treeHeader="Group"
        statusHeader=""
        ariaLabel="Article groups"
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setFormState({ open: true, group: null, parentGroupId: undefined })}>
              + Group
            </WebButton>
          ) : undefined
        }
        emptyText={canWrite ? "No article groups yet. Use + Group to add the first one." : "No article groups yet."}
      />

      {canWrite ? (
        <>
          {formState.open ? (
            <ArticleGroupFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              group={formState.group}
              parentGroupId={formState.parentGroupId}
              groups={groups}
            />
          ) : null}
          <DeleteArticleGroupDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            group={deleteTarget}
          />
        </>
      ) : null}
    </div>
  );
}
