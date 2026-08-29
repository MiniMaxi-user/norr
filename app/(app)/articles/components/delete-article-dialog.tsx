"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog, Text } from "@yourorg/ui";
import { deleteArticle, getArticleDependencyCounts, type ArticleRecord } from "../actions";

export interface DeleteArticleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  article: ArticleRecord | null;
}

/**
 * Delete confirmation for an article. Calls `getArticleDependencyCounts`
 * first (same `checkDependencies` convention `DeleteClientDialog` sets) —
 * unlike a client's sites/assets, nothing here cascades: `deleteArticle`
 * itself refuses outright when this article is used as another composite's
 * BOM component, or still has its own BOM lines, so this dialog's message is
 * a hard blocker rather than a cascade preview.
 */
export function DeleteArticleDialog({ open, onOpenChange, article }: DeleteArticleDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${article?.article_number ?? "article"}?`}
      checkKey={article?.id ?? null}
      checkingMessage="Checking related composites…"
      checkDependencies={async () => {
        if (!article) return { message: null };
        const result = await getArticleDependencyCounts(article.id);
        if (result.error || !result.data) {
          return { error: result.error ?? "Could not check related composites." };
        }
        const { usedAsComponentIn, ownComponents } = result.data;
        if (usedAsComponentIn > 0 || ownComponents > 0) {
          return {
            message: (
              <Text tone="danger">
                {usedAsComponentIn > 0 &&
                  `This article is used as a component in ${usedAsComponentIn} other composite article${usedAsComponentIn === 1 ? "" : "s"}. `}
                {ownComponents > 0 &&
                  `This composite article still has ${ownComponents} component${ownComponents === 1 ? "" : "s"} in its bill of materials. `}
                Remove {usedAsComponentIn + ownComponents === 1 ? "it" : "them"} first — this article cannot be deleted
                until then.
              </Text>
            ),
          };
        }
        return { message: <Text tone="muted">This article has no dependencies. This action cannot be undone.</Text> };
      }}
      onConfirm={async () => {
        if (!article) return { error: "No article selected." };
        const result = await deleteArticle(article.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete article"
    />
  );
}
