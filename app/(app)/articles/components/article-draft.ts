import type { ArticleRecord } from "../actions";

/**
 * An article's own editable fields, as one flat draft object — same
 * single-source-of-truth shape `AssetDraft`/`ActivityDraft` establish for the
 * "one screen, inline-editable" pattern (issue #123's conversion of the
 * Articles create/edit form off the old `ArticleFormPanel` slide-in, see
 * `docs/ARCHITECTURE.md`'s "Popup vs. full page" section). `ArticleScreen`
 * owns this; every section reads from it and writes back through
 * `ArticleScreen`'s own `commitPatch`.
 *
 * `purchasePrice`/`salePrice` stay plain strings (not numbers) — same
 * "form field state is a string, the schema's `z.coerce.number()` does the
 * parsing" treatment every other money/number input in this codebase uses —
 * so an in-progress edit (e.g. a trailing ".") doesn't get silently coerced
 * away before the caller is done typing.
 */
export interface ArticleDraft {
  articleNumber: string;
  mpn: string;
  ean: string;
  gtin: string;
  description: string;
  imageUrl: string;
  /** The single leaf group actually assigned to this article — a depth-0
   * (top-level) group id when no subgroup is assigned, or the deeper
   * group's own id otherwise. The Classification section derives its own
   * Group/Subgroup cascade selection from this plus the org's whole group
   * tree (`topArticleGroupAncestorId`/`isArticleGroupDescendantOf`, moved to
   * `../group-tree.ts`) — never stored as two separate draft fields. */
  groupId: string;
  manufacturerItemId: string;
  unitItemId: string;
  purchasePrice: string;
  salePrice: string;
  vatRateItemId: string;
  isActive: boolean;
  isComposite: boolean;
}

export function draftFromArticle(article: ArticleRecord): ArticleDraft {
  return {
    articleNumber: article.article_number,
    mpn: article.mpn ?? "",
    ean: article.ean ?? "",
    gtin: article.gtin ?? "",
    description: article.description,
    imageUrl: article.image_url ?? "",
    groupId: article.group_id ?? "",
    manufacturerItemId: article.manufacturer_item_id ?? "",
    unitItemId: article.unit_item_id,
    purchasePrice: article.purchase_price != null ? String(article.purchase_price) : "",
    salePrice: article.sale_price != null ? String(article.sale_price) : "",
    vatRateItemId: article.vat_rate_item_id,
    isActive: article.is_active,
    isComposite: article.is_composite,
  };
}

export function emptyDraft(): ArticleDraft {
  return {
    articleNumber: "",
    mpn: "",
    ean: "",
    gtin: "",
    description: "",
    imageUrl: "",
    groupId: "",
    manufacturerItemId: "",
    unitItemId: "",
    purchasePrice: "",
    salePrice: "",
    vatRateItemId: "",
    isActive: true,
    isComposite: false,
  };
}

/** Converts a draft (or a partial patch of one) into the shape
 * `createArticle`/`updateArticle` (`../actions.ts`) expect — empty-string
 * "unset" values become `undefined` (not sent) rather than an empty string
 * that would fail the schema's `uuid()` shape check. `articleNumber`/
 * `description` are the exceptions (always sent as-is, even `""`, since
 * they're plain required string fields, not an optional uuid/number). */
export function draftToInput(patch: Partial<ArticleDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.articleNumber !== undefined) input.articleNumber = patch.articleNumber;
  if (patch.description !== undefined) input.description = patch.description;
  if (patch.mpn !== undefined) input.mpn = patch.mpn || undefined;
  if (patch.ean !== undefined) input.ean = patch.ean || undefined;
  if (patch.gtin !== undefined) input.gtin = patch.gtin || undefined;
  if (patch.imageUrl !== undefined) input.imageUrl = patch.imageUrl || undefined;
  if (patch.groupId !== undefined) input.groupId = patch.groupId || undefined;
  if (patch.manufacturerItemId !== undefined) input.manufacturerItemId = patch.manufacturerItemId || undefined;
  if (patch.unitItemId !== undefined) input.unitItemId = patch.unitItemId || undefined;
  if (patch.purchasePrice !== undefined) input.purchasePrice = patch.purchasePrice || undefined;
  if (patch.salePrice !== undefined) input.salePrice = patch.salePrice || undefined;
  if (patch.vatRateItemId !== undefined) input.vatRateItemId = patch.vatRateItemId || undefined;
  if (patch.isComposite !== undefined) input.isComposite = patch.isComposite;
  if (patch.isActive !== undefined) input.isActive = patch.isActive;
  return input;
}
