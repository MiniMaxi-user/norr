"use server";

import { createQuote, updateQuote, type QuoteRecord } from "./actions";

/**
 * Thin `useActionState`-shaped adapters over the real `createQuote`/
 * `updateQuote` Server Actions in `./actions.ts` (which take a parsed
 * object, not `FormData`) — same pattern as `app/(app)/contracts/
 * contract-form-actions.ts`/`app/(app)/work-orders/work-order-form-actions.ts`.
 * Kept in this separate file for the same reason: `./actions.ts` is the
 * co-located backend half of issue #16 and out of this pass's scope to
 * modify.
 */
export interface QuoteFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  quote?: QuoteRecord;
}

function readField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Same as `readField`, but an empty string (a placeholder option left
 * selected, e.g. "No specific site"/"Use default (Draft)") is also treated
 * as absent — needed for every optional field below whose `<Select>`/`<input>`
 * has a blank/placeholder state. */
function readOptionalField(formData: FormData, key: string): string | undefined {
  const value = readField(formData, key);
  return value && value.length > 0 ? value : undefined;
}

function formDataToQuoteInput(formData: FormData) {
  return {
    clientId: readField(formData, "clientId"),
    siteId: readOptionalField(formData, "siteId"),
    name: readField(formData, "name"),
    // Optional — the `derive_quote_organization_id` DB trigger fills in the
    // organization's default `quote_status` item ("Draft") when omitted,
    // same UX as `contracts.typeId`/`work_orders.statusId`.
    statusId: readOptionalField(formData, "statusId"),
    validUntil: readOptionalField(formData, "validUntil"),
    notes: readField(formData, "notes"),
  };
}

/** `useActionState` action for the "create quote" page. */
export async function createQuoteFormAction(
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const result = await createQuote(formDataToQuoteInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, quote: result.data.quote };
}

/**
 * `useActionState` action for the "edit quote" page. Bind the quote id first
 * (`updateQuoteFormAction.bind(null, quote.id)`) before passing it to
 * `useActionState`, same idiom as `updateContractFormAction`.
 */
export async function updateQuoteFormAction(
  id: string,
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const result = await updateQuote(id, formDataToQuoteInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, quote: result.data.quote };
}
