import type { QuoteRecord } from "../actions";

/**
 * The quote's own editable fields as one flat draft — the raw, input-shaped
 * record `useEditMode` (web design system, issue #222) edits on `/quotes/[id]`
 * and `/quotes/new`. Status is deliberately part of it again, as before: tenant-configurable `quote_status` list;
 * generating an invoice still sets Invoiced through a DB trigger.
 */
// A `type` alias so it is assignable to `Record<string, string | boolean>`.
export type QuoteDraft = {
  clientId: string;
  name: string;
  /** Empty on the new page = the organization default (Draft). */
  statusId: string;
  validUntil: string;
  notes: string;
};

export function draftFromQuote(quote: QuoteRecord): QuoteDraft {
  return {
    clientId: quote.client_id,
    name: quote.name,
    statusId: quote.status_id,
    validUntil: quote.valid_until ?? "",
    notes: quote.notes ?? "",
  };
}

export function emptyDraft(options: { lockedClientId?: string } = {}): QuoteDraft {
  return { clientId: options.lockedClientId ?? "", name: "", statusId: "", validUntil: "", notes: "" };
}

/** Converts a draft (or a partial patch) into the input `createQuote`/
 * `updateQuote` expect. A blank optional field is sent as an empty string,
 * which `quoteUpdateSchema` turns into `null` (clears the column). */
export function draftToInput(patch: Partial<QuoteDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.clientId) input.clientId = patch.clientId;
  if (patch.name !== undefined) input.name = patch.name;
  if (patch.statusId) input.statusId = patch.statusId;
  if (patch.validUntil !== undefined) input.validUntil = patch.validUntil;
  if (patch.notes !== undefined) input.notes = patch.notes;
  return input;
}
