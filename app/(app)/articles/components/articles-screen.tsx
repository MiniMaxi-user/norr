import Link from "next/link";
import { Boxes } from "@yourorg/ui/icons";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { listArticles } from "../actions";
import { listArticleGroups } from "../groups-actions";
import { flattenArticleGroups } from "../group-tree";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ArticlesFilters } from "./articles-filters";
import { ArticlesTable } from "./articles-table";
import { CreateArticleButton } from "./create-article-button";

const PAGE_SIZE = 20;

export interface ArticlesScreenProps {
  search?: string;
  groupId?: string;
  manufacturerItemId?: string;
  /** "1" | "0" | undefined (no filter) — URL search params are always plain
   * strings, parsed into a real boolean via `parseBoolParam` below. */
  active?: string;
  composite?: string;
  page: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function parseBoolParam(value: string | undefined): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

function buildPageHref(params: {
  search?: string;
  groupId?: string;
  manufacturerItemId?: string;
  active?: string;
  composite?: string;
  page: number;
}): string {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.groupId) qs.set("groupId", params.groupId);
  if (params.manufacturerItemId) qs.set("manufacturerItemId", params.manufacturerItemId);
  if (params.active) qs.set("active", params.active);
  if (params.composite) qs.set("composite", params.composite);
  if (params.page > 0) qs.set("page", String(params.page));
  return `/articles?${qs.toString()}`;
}

/**
 * The data-fetching heart of the Articles module — rendered inside a
 * `Suspense` boundary by `app/(app)/articles/page.tsx` so its shaped
 * skeleton shows while these `await`s resolve (route-level streaming, per
 * docs/ARCHITECTURE.md), same shape `AssetsScreen` uses.
 *
 * Fetches every reference list the Article form needs (`article_unit`/
 * `article_manufacturer`/`vat_rate`, plus the whole Article Group tree) ONCE
 * here and passes them down to `ArticlesFilters`/`ArticlesTable`/
 * `CreateArticleButton` — per this issue's own instruction, these are
 * "passed down from the page, fetched once", unlike `AssetFormDialog`'s
 * self-fetch-on-open pattern.
 */
export async function ArticlesScreen({
  search,
  groupId,
  manufacturerItemId,
  active,
  composite,
  page,
  canCreate,
  canEdit,
  canDelete,
}: ArticlesScreenProps) {
  const isActive = parseBoolParam(active);
  const isComposite = parseBoolParam(composite);
  const offset = page * PAGE_SIZE;

  const [articlesResult, groupsResult, unitsResult, manufacturersResult, vatRatesResult] = await Promise.all([
    listArticles({ search, groupId, manufacturerItemId, isActive, isComposite, limit: PAGE_SIZE, offset }),
    listArticleGroups(),
    listReferenceItems("article_unit"),
    listReferenceItems("article_manufacturer"),
    listReferenceItems("vat_rate"),
  ]);

  const groups = flattenArticleGroups(groupsResult.data?.groups ?? []);
  const units = unitsResult.data?.items ?? [];
  const manufacturers = manufacturersResult.data?.items ?? [];
  const vatRates = vatRatesResult.data?.items ?? [];

  const toolbar = (
    <Toolbar>
      <Toolbar.Section>
        <ArticlesFilters
          groups={groups}
          manufacturers={manufacturers}
          search={search}
          groupId={groupId}
          manufacturerItemId={manufacturerItemId}
          active={active}
          composite={composite}
        />
      </Toolbar.Section>
      <Toolbar.Section align="end">
        {canCreate && <CreateArticleButton groups={groups} units={units} manufacturers={manufacturers} vatRates={vatRates} />}
      </Toolbar.Section>
    </Toolbar>
  );

  if (!articlesResult.data) {
    return (
      <>
        {toolbar}
        <Card>
          <Text tone="danger">{articlesResult.error ?? "Could not load articles."}</Text>
        </Card>
      </>
    );
  }

  const { articles, count } = articlesResult.data;
  const hasFilters = Boolean(search || groupId || manufacturerItemId || active || composite);

  if (articles.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          icon={<Boxes />}
          heading={hasFilters ? "No articles match these filters" : "No articles yet"}
          text={
            hasFilters
              ? "Try a different search term or filter."
              : "Add your first article to start building your catalog."
          }
          action={
            canCreate && !hasFilters ? (
              <CreateArticleButton groups={groups} units={units} manufacturers={manufacturers} vatRates={vatRates} />
            ) : undefined
          }
        />
      </>
    );
  }

  const hasPrev = offset > 0;
  const hasNext = offset + articles.length < count;

  return (
    <>
      {toolbar}
      <ArticlesTable
        articles={articles}
        groups={groups}
        units={units}
        manufacturers={manufacturers}
        vatRates={vatRates}
        canEdit={canEdit}
        canDelete={canDelete}
      />
      <Stack gap="sm">
        <Text tone="muted">
          Showing {offset + 1}–{Math.min(offset + articles.length, count)} of {count}
        </Text>
        <span>
          {hasPrev ? (
            <Link href={buildPageHref({ search, groupId, manufacturerItemId, active, composite, page: page - 1 })}>
              <Button type="button" variant="outline" size="sm">
                Previous
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}{" "}
          {hasNext ? (
            <Link href={buildPageHref({ search, groupId, manufacturerItemId, active, composite, page: page + 1 })}>
              <Button type="button" variant="outline" size="sm">
                Next
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </span>
      </Stack>
    </>
  );
}
