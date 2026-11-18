import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import { createArticle, updateArticle } from "../actions";
import { draftToInput, type ArticleDraft } from "./article-draft";

/**
 * Edit-mode schema for the Article page (design system, issue #222): label,
 * required marker and validation per field. Mirrors `../schema.ts`
 * (`articleCreateSchema`) — the server stays the authority — with messages that
 * say what is wrong and how to fix it.
 */

function tooLong(label: string, value: string, max: number) {
  const length = value.trim().length;
  return length > max ? `${label} is ${length} characters, the maximum is ${max}. Remove ${length - max}` : null;
}

/** Optional money amount: zero or more, at most 4 decimals (`numeric(14,4)`). */
function validatePrice(label: string, value: string): string | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${label} must be a number`;
  if (parsed < 0) return `${label} must be zero or more`;
  if (Math.abs(parsed - Math.round(parsed * 10000) / 10000) >= 1e-9) {
    return `${label} can have at most 4 decimal places`;
  }
  return null;
}

export function buildArticleSchema(options: {
  labelFor: (key: "groupId" | "subgroupId" | "manufacturerItemId" | "unitItemId" | "vatRateItemId", id: string) => string;
}): EditSchema<ArticleDraft> {
  const { labelFor } = options;
  return {
    articleNumber: {
      label: "Article number",
      required: true,
      validate: (value) => (value.trim() ? tooLong("Article number", value, 100) : "Enter an article number"),
    },
    description: {
      label: "Description",
      required: true,
      validate: (value) => (value.trim() ? tooLong("Description", value, 2000) : "Enter a description"),
    },
    mpn: { label: "MPN", validate: (value) => tooLong("MPN", value, 100) },
    ean: { label: "EAN", validate: (value) => tooLong("EAN", value, 64) },
    gtin: { label: "GTIN", validate: (value) => tooLong("GTIN", value, 64) },
    imageUrl: { label: "Photo URL", validate: (value) => tooLong("Photo URL", value, 2000) },
    groupId: { label: "Group", format: (value) => (value ? labelFor("groupId", value) : "") },
    subgroupId: { label: "Subgroup", format: (value) => (value ? labelFor("subgroupId", value) : "") },
    manufacturerItemId: {
      label: "Manufacturer",
      format: (value) => (value ? labelFor("manufacturerItemId", value) : ""),
    },
    unitItemId: {
      label: "Unit",
      required: true,
      format: (value) => (value ? labelFor("unitItemId", value) : ""),
      validate: (value) => (value ? null : "Choose a unit"),
    },
    purchasePrice: { label: "Purchase price", validate: (value) => validatePrice("Purchase price", value) },
    salePrice: { label: "Sale price", validate: (value) => validatePrice("Sale price", value) },
    vatRateItemId: {
      label: "VAT rate",
      required: true,
      format: (value) => (value ? labelFor("vatRateItemId", value) : ""),
      validate: (value) => (value ? null : "Choose a VAT rate"),
    },
    isActive: { label: "Active" },
    isComposite: { label: "Composite article" },
  };
}

type DraftKey = keyof ArticleDraft & string;

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Partial<Record<DraftKey, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as DraftKey] = messages[0];
  }
  return mapped;
}

/** Persists an edited article through the existing `updateArticle` action
 * (RBAC, zod validation and RLS unchanged) — only the changed fields are sent. */
export async function saveArticleEdits(
  articleId: string,
  draft: ArticleDraft,
  dirty: DirtyField<ArticleDraft>[],
): Promise<SaveResult<ArticleDraft>> {
  const input = draftToInput(draft, new Set(dirty.map((entry) => entry.key)));
  if (Object.keys(input).length === 0) return { ok: true };
  const result = await updateArticle(articleId, input);
  if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  return { ok: true };
}

/** Creates an article (new mode) through `createArticle`; resolves with the new
 * id so the page can open its read page. */
export async function createArticleFromDraft(
  draft: ArticleDraft,
): Promise<{ result: SaveResult<ArticleDraft>; articleId?: string }> {
  const created = await createArticle(draftToInput(draft));
  if (!created.data) {
    return { result: { ok: false, error: created.error, fieldErrors: firstFieldErrors(created.fieldErrors) } };
  }
  return { result: { ok: true }, articleId: created.data.article.id };
}
