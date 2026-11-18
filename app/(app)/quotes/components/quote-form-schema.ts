import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import { createQuote, updateQuote } from "../actions";
import { draftToInput, type QuoteDraft } from "./quote-draft";

/**
 * Edit-mode schema for the Quote page (design system, issue #222): label,
 * required marker and validation per field. Mirrors `../schema.ts`
 * (`quoteCreateSchema`) — the server stays the authority — with messages that
 * say what is wrong and how to fix it.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_HINT = "Enter a date as dd-mm-yyyy, for example 17-11-2026";

function tooLong(label: string, value: string, max: number) {
  const length = value.trim().length;
  return length > max ? `${label} is ${length} characters, the maximum is ${max}. Remove ${length - max}` : null;
}

export function buildQuoteSchema(options: {
  clientName: (id: string) => string;
  statusLabel: (id: string) => string;
  /** The client is chosen on the new page (unless locked) and changeable on an existing quote. */
  clientRequired?: boolean;
}): EditSchema<QuoteDraft> {
  return {
    clientId: {
      label: "Client",
      required: Boolean(options.clientRequired),
      format: (value) => (value ? options.clientName(value) : ""),
      validate: (value) => (options.clientRequired && !value ? "Choose a client" : null),
    },
    name: {
      label: "Name",
      required: true,
      validate: (value) => {
        if (!value.trim()) return "Enter a name for this quote";
        return tooLong("Name", value, 200);
      },
    },
    statusId: {
      label: "Status",
      format: (value) => (value ? options.statusLabel(value) : ""),
    },
    validUntil: {
      label: "Valid until",
      validate: (value) => (value && !ISO_DATE.test(value) ? DATE_HINT : null),
    },
    notes: { label: "Notes", validate: (value) => tooLong("Notes", value, 5000) },
  };
}

type DraftKey = keyof QuoteDraft & string;

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Partial<Record<DraftKey, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as DraftKey] = messages[0];
  }
  return mapped;
}

/** Persists an edited quote through the existing `updateQuote` action (RBAC,
 * zod validation and RLS unchanged) — only the changed fields are sent. */
export async function saveQuoteEdits(
  quoteId: string,
  draft: QuoteDraft,
  dirty: DirtyField<QuoteDraft>[],
): Promise<SaveResult<QuoteDraft>> {
  const patch: Partial<QuoteDraft> = {};
  for (const entry of dirty) (patch as Record<string, unknown>)[entry.key] = draft[entry.key];
  const input = draftToInput(patch);
  if (Object.keys(input).length === 0) return { ok: true };
  const result = await updateQuote(quoteId, input);
  if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  return { ok: true };
}

/** Creates a quote (new mode) through `createQuote`; resolves with the new id
 * so the page can open its read page. An empty status is left to the DB default. */
export async function createQuoteFromDraft(
  draft: QuoteDraft,
): Promise<{ result: SaveResult<QuoteDraft>; quoteId?: string }> {
  const created = await createQuote(draftToInput(draft));
  if (!created.data) {
    return { result: { ok: false, error: created.error, fieldErrors: firstFieldErrors(created.fieldErrors) } };
  }
  return { result: { ok: true }, quoteId: created.data.quote.id };
}
