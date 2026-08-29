"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog, Text } from "@yourorg/ui";
import { deleteArticleGroup, getArticleGroupDependencyCounts, type ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";

export interface DeleteArticleGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ArticleGroupRecord | null;
}

/**
 * Delete confirmation for an Article Group. Calls `getArticleGroupDependencyCounts`
 * first (same `checkDependencies` convention `DeleteClientDialog` establishes)
 * — unlike clients' sites/assets, subgroups/articles do NOT cascade here
 * (`deleteArticleGroup`'s own doc comment: no `on delete cascade`/`set null`
 * at the DB level either), so this warning is a hard blocker, not a
 * cascade-preview.
 */
export function DeleteArticleGroupDialog({ open, onOpenChange, group }: DeleteArticleGroupDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${group?.name ?? "group"}?`}
      checkKey={group?.id ?? null}
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
              <Text tone="danger">
                This group has {childGroups} subgroup{childGroups === 1 ? "" : "s"} and {articles} article
                {articles === 1 ? "" : "s"}. Move or delete {childGroups + articles === 1 ? "it" : "them"} first —
                deleting a group with subgroups or articles still assigned isn&rsquo;t allowed.
              </Text>
            ),
          };
        }
        return { message: <Text tone="muted">This group has no subgroups or articles. This action cannot be undone.</Text> };
      }}
      onConfirm={async () => {
        if (!group) return { error: "No group selected." };
        const result = await deleteArticleGroup(group.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete group"
    />
  );
}
