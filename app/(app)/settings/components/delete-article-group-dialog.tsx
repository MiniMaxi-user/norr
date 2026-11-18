"use client";

import { deleteArticleGroup, getArticleGroupDependencyCounts, type ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import { SettingsDeleteDialog } from "./settings-dialog-kit";

export interface DeleteArticleGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ArticleGroupRecord | null;
}

/**
 * Delete confirmation for an Article Group. Checks subgroups and articles
 * first: they do not cascade, so a group that still has either cannot be
 * deleted (the server rejects it; the message says why up front).
 */
export function DeleteArticleGroupDialog({ open, onOpenChange, group }: DeleteArticleGroupDialogProps) {
  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${group?.name ?? "group"}?`}
      checkingMessage="Checking subgroups and articles…"
      checkDependencies={async () => {
        if (!group) return { message: null };
        const result = await getArticleGroupDependencyCounts(group.id);
        if (result.error || !result.data) {
          return { error: result.error ?? "Could not check subgroups and articles." };
        }
        const { childGroups, articles } = result.data;
        if (childGroups > 0 || articles > 0) {
          return {
            message: (
              <span style={{ color: "var(--danger-text)" }}>
                This group has {childGroups} subgroup{childGroups === 1 ? "" : "s"} and {articles} article
                {articles === 1 ? "" : "s"}. Move or delete {childGroups + articles === 1 ? "it" : "them"} first —
                deleting a group with subgroups or articles still assigned isn&rsquo;t allowed.
              </span>
            ),
          };
        }
        return { message: "This group has no subgroups or articles. This action cannot be undone." };
      }}
      onConfirm={async () => {
        if (!group) return { error: "No group selected." };
        const result = await deleteArticleGroup(group.id);
        return { error: result.error };
      }}
    />
  );
}
