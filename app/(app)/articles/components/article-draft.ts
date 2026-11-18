import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ArticleRecord } from "../actions";
import { findArticleGroup, topArticleGroupAncestorId, type FlattenedArticleGroup } from "../group-tree";

/**
 * The article's own editable fields, as one flat draft object — the record
 * `useEditMode` (issue #222) edits on the Article page in edit and new mode.
 *
 * The persisted `group_id` is the single most specific group assigned. The
 * draft splits it into the Group/Subgroup cascade the form shows: `groupId` is
 * the top-level group, `subgroupId` the (deeper) group below it, and
 * `draftToInput` collapses the pair back into one `groupId`.
 *
 * `purchasePrice`/`salePrice` stay plain strings (not numbers) — the schema's
 * `z.coerce.number()` does the parsing — so an in-progress edit (a trailing
 * ".") is not silently coerced away.
 */
// A `type` alias (not an `interface`) so it is assignable to the
// `Record<string, string | boolean>` `useEditMode` edits.
export type ArticleDraft = {
  articleNumber: string;
  description: string;
  mpn: string;
  ean: string;
  gtin: string;
  imageUrl: string;
  groupId: string;
  subgroupId: string;
  manufacturerItemId: string;
  unitItemId: string;
  purchasePrice: string;
  salePrice: string;
  vatRateItemId: string;
  isActive: boolean;
  isComposite: boolean;
};

export function draftFromArticle(article: ArticleRecord, groups: FlattenedArticleGroup[]): ArticleDraft {
  const group = findArticleGroup(groups, article.group_id);
  const top = topArticleGroupAncestorId(groups, article.group_id);
  return {
    articleNumber: article.article_number,
    description: article.description,
    mpn: article.mpn ?? "",
    ean: article.ean ?? "",
    gtin: article.gtin ?? "",
    imageUrl: article.image_url ?? "",
    groupId: top,
    subgroupId: group && group.depth > 0 ? group.id : "",
    manufacturerItemId: article.manufacturer_item_id ?? "",
    unitItemId: article.unit_item_id,
    purchasePrice: article.purchase_price != null ? String(article.purchase_price) : "",
    salePrice: article.sale_price != null ? String(article.sale_price) : "",
    vatRateItemId: article.vat_rate_item_id,
    isActive: article.is_active,
    isComposite: article.is_composite,
  };
}

/** A new article starts on the organization's default unit and VAT rate (the
 * same items the database trigger would pick) and is active. */
export function emptyDraft(defaults: {
  units: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
}): ArticleDraft {
  return {
    articleNumber: "",
    description: "",
    mpn: "",
    ean: "",
    gtin: "",
    imageUrl: "",
    groupId: "",
    subgroupId: "",
    manufacturerItemId: "",
    unitItemId: defaults.units.find((item) => item.is_default)?.id ?? "",
    purchasePrice: "",
    salePrice: "",
    vatRateItemId: defaults.vatRates.find((item) => item.is_default)?.id ?? "",
    isActive: true,
    isComposite: false,
  };
}

/**
 * Converts a draft into the shape `createArticle`/`updateArticle`
 * (`../actions.ts`) expect. `keys` limits the result to the changed fields
 * (edit mode); omit it to send everything (create).
 *
 * Optional fields are sent as typed, blank included: the schema turns a blank
 * into `null`, so an emptied field is really cleared. Unit and VAT rate are
 * required in the UI; a blank one is left out so the database default (create)
 * or the current value (update) applies.
 */
export function draftToInput(draft: ArticleDraft, keys?: ReadonlySet<keyof ArticleDraft>): Record<string, unknown> {
  const has = (key: keyof ArticleDraft) => !keys || keys.has(key);
  const input: Record<string, unknown> = {};
  if (has("articleNumber")) input.articleNumber = draft.articleNumber;
  if (has("description")) input.description = draft.description;
  if (has("mpn")) input.mpn = draft.mpn;
  if (has("ean")) input.ean = draft.ean;
  if (has("gtin")) input.gtin = draft.gtin;
  if (has("imageUrl")) input.imageUrl = draft.imageUrl;
  if (has("groupId") || has("subgroupId")) input.groupId = draft.subgroupId || draft.groupId;
  if (has("manufacturerItemId")) input.manufacturerItemId = draft.manufacturerItemId;
  if (has("unitItemId") && draft.unitItemId) input.unitItemId = draft.unitItemId;
  if (has("purchasePrice")) input.purchasePrice = draft.purchasePrice;
  if (has("salePrice")) input.salePrice = draft.salePrice;
  if (has("vatRateItemId") && draft.vatRateItemId) input.vatRateItemId = draft.vatRateItemId;
  if (has("isComposite")) input.isComposite = draft.isComposite;
  if (has("isActive")) input.isActive = draft.isActive;
  return input;
}
