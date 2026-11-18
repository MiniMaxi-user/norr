import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage } from "@yourorg/ui/web";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listArticles } from "../actions";
import { flattenArticleGroups } from "../group-tree";
import { listArticleGroups } from "../groups-actions";
import { parseArticlesQuery, type ArticlesSearchParams } from "./articles-query";
import { ArticlesTableCard } from "./articles-table-card";

/**
 * Async Server Component of `/articles`: fetches, then renders the list-page
 * shell (`WebListPage`) with the server-driven table. Rendered inside
 * `page.tsx`'s `Suspense` (fallback `WebListSkeleton`), so the header streams
 * in before the data. Articles has one view (no view switcher).
 */
export async function ArticlesList({
  params,
  canCreate,
  canEdit,
  canDelete,
}: {
  params: ArticlesSearchParams;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { page, options } = parseArticlesQuery(params);

  const [result, groupsResult, manufacturersResult] = await Promise.all([
    listArticles(options),
    listArticleGroups(),
    listReferenceItems("article_manufacturer"),
  ]);

  const primary = canCreate ? (
    <WebLinkButton variant="primary" href="/articles/new">
      New article
    </WebLinkButton>
  ) : undefined;

  if (result.error || !result.data) {
    return (
      <WebListPage module="Articles" title="Articles" primary={primary}>
        <WebCard title="Articles">
          <WebDataTableEmpty>{result.error ?? "Could not load articles."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { articles, count, unfilteredCount } = result.data;
  const groups = flattenArticleGroups(groupsResult.data?.groups ?? []).map((group) => ({
    value: group.id,
    label: group.path,
  }));
  const manufacturers = (manufacturersResult.data?.items ?? []).map((item) => ({ value: item.id, label: item.label }));

  return (
    <WebListPage module="Articles" title="Articles" count={unfilteredCount ?? count} primary={primary}>
      <ArticlesTableCard
        articles={articles}
        total={count}
        page={page}
        unfilteredTotal={unfilteredCount}
        groups={groups}
        manufacturers={manufacturers}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </WebListPage>
  );
}
