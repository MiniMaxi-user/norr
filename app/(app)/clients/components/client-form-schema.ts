import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { createClient, updateClient, updateClientRateSettings } from "../actions";
import { CLIENT_STATUS_OPTIONS } from "../kanban";
import { draftToClientInput, draftToRateInput, type ClientDraft } from "./client-draft";

/**
 * Edit-mode schema for the Client page (design system, issue #222): label,
 * required marker and validation per field. The rules mirror the backend
 * (`../schema.ts`'s `clientCreateSchema` and `lib/rate-overrides/schema.ts`)
 * — the server stays the authority and re-validates everything — but each
 * message says what is wrong AND how to fix it, instead of the generic
 * "Please fix the highlighted fields.".
 */

const NAME_MAX = 200;
const KVK_MAX = 50;
const VAT_MAX = 50;
const IBAN_MAX = 34;
const NOTES_MAX = 5000;

function tooLong(label: string, value: string, max: number, hint?: string) {
  if (value.trim().length <= max) return null;
  const over = value.trim().length - max;
  return `${label} is ${value.trim().length} characters, the maximum is ${max}. Remove ${over}${hint ? ` — ${hint}` : ""}`;
}

function checkMoney(label: string, raw: string, example: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `Enter ${label.toLowerCase()} as a number, for example ${example}`;
  if (amount < 0) return `${label} cannot be negative. Enter zero or more`;
  if (Math.abs(amount - Math.round(amount * 100) / 100) >= 1e-9) {
    return `${label} can have at most 2 decimals, for example ${example}`;
  }
  return null;
}

const STATUS_LABELS = new Map<string, string>(CLIENT_STATUS_OPTIONS.map((option) => [option.value, option.label]));

export function buildClientSchema(options: {
  accountManagerLabel: (id: string) => string;
  articleLabel: (id: string) => string;
}): EditSchema<ClientDraft> {
  const { accountManagerLabel, articleLabel } = options;
  return {
    name: {
      label: "Name",
      required: true,
      validate: (value) =>
        !value.trim() ? "Enter a name for this client" : tooLong("Name", value, NAME_MAX, "shorten the name"),
    },
    kvkNumber: {
      label: "KvK number",
      validate: (value) => tooLong("KvK number", value, KVK_MAX, "check for extra characters"),
    },
    vatNumber: {
      label: "VAT number",
      validate: (value) => tooLong("VAT number", value, VAT_MAX, "check for extra characters"),
    },
    iban: {
      label: "IBAN",
      validate: (value) => tooLong("IBAN", value, IBAN_MAX, "check for spaces or typos"),
    },
    paymentTermDays: {
      label: "Payment term",
      validate: (value) => {
        const text = value.trim();
        if (!text) return null;
        if (!/^[0-9]+$/.test(text)) return "Enter the payment term as a whole number of days, for example 14";
        if (Number(text) > 365) return "The payment term can be at most 365 days";
        return null;
      },
    },
    notes: {
      label: "Notes",
      validate: (value) => tooLong("Notes", value, NOTES_MAX, "move detail into an activity or document"),
    },
    status: {
      label: "Status",
      format: (value) => STATUS_LABELS.get(value) ?? value,
      validate: (value) => (STATUS_LABELS.has(value) ? null : "Choose one of Lead, Qualified, Proposal or Won"),
    },
    accountManagerId: {
      label: "Account manager",
      format: (value) => (value ? accountManagerLabel(value) : ""),
    },
    potentialValue: {
      label: "Potential",
      validate: (value) => checkMoney("Potential", value, "12500.50"),
    },
    clientSince: {
      label: "Client since",
      format: (value) => value,
      validate: (value) =>
        !value || /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Enter a date as dd-mm-yyyy, for example 17-11-2026",
    },
    hasCustomRate: {
      label: "Custom rate",
      format: (value) => (value ? "on" : "off"),
    },
    ublEmailEnabled: {
      label: "E-invoice (UBL)",
      format: (value) => (value ? "on" : "off"),
    },
    travelArticleId: {
      label: "Travel article",
      format: (value) => (value ? articleLabel(value) : ""),
      validate: (value, draft) =>
        draft.hasCustomRate && !value ? "Choose a travel article, or turn off custom rate" : null,
    },
    travelSalePrice: {
      label: "Travel sale price",
      validate: (value, draft) => {
        if (!draft.hasCustomRate) return null;
        if (!value.trim()) return "Enter a travel sale price, for example 85.00";
        return checkMoney("Travel sale price", value, "85.00");
      },
    },
    workArticleId: {
      label: "Work article",
      format: (value) => (value ? articleLabel(value) : ""),
      validate: (value, draft) => (draft.hasCustomRate && !value ? "Choose a work article, or turn off custom rate" : null),
    },
    workSalePrice: {
      label: "Work sale price",
      validate: (value, draft) => {
        if (!draft.hasCustomRate) return null;
        if (!value.trim()) return "Enter a work sale price, for example 95.00";
        return checkMoney("Work sale price", value, "95.00");
      },
    },
  };
}

const CLIENT_FIELD_KEYS = [
  "name",
  "kvkNumber",
  "vatNumber",
  "iban",
  "paymentTermDays",
  "notes",
  "status",
  "accountManagerId",
  "potentialValue",
  "clientSince",
  "ublEmailEnabled",
] as const;
const RATE_FIELD_KEYS = ["hasCustomRate", "travelArticleId", "workArticleId", "travelSalePrice", "workSalePrice"] as const;

type DraftKey = keyof ClientDraft & string;

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Partial<Record<DraftKey, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as DraftKey] = messages[0];
  }
  return mapped;
}

/**
 * Persists an edited client through the EXISTING server actions — all RBAC
 * (`can(actor, "clients", "update")`), zod validation and RLS stay exactly as
 * before: only the fields that actually changed go to `updateClient`, and the
 * rate block goes to `updateClientRateSettings` when any of its fields
 * changed. Server field errors come back keyed by the same names the draft
 * uses, so they land on the right row.
 */
export async function saveClientEdits(
  clientId: string,
  draft: ClientDraft,
  dirty: DirtyField<ClientDraft>[],
): Promise<SaveResult<ClientDraft>> {
  const dirtyKeys = new Set(dirty.map((entry) => entry.key));

  const clientPatch: Partial<ClientDraft> = {};
  for (const key of CLIENT_FIELD_KEYS) {
    if (dirtyKeys.has(key)) (clientPatch as Record<string, unknown>)[key] = draft[key];
  }
  if (Object.keys(clientPatch).length > 0) {
    const result = await updateClient(clientId, draftToClientInput(clientPatch));
    if (!result.data) {
      return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
    }
  }

  if (RATE_FIELD_KEYS.some((key) => dirtyKeys.has(key))) {
    const result = await updateClientRateSettings(clientId, draftToRateInput(draft));
    if (!result.data) {
      return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
    }
  }
  return { ok: true };
}

/**
 * Creates a client (new mode) through the existing `createClient` /
 * `updateClientRateSettings` actions, same sequence the old create screen
 * used. Resolves with the new id so the page can navigate to its read page.
 */
export async function createClientFromDraft(
  draft: ClientDraft,
): Promise<{ result: SaveResult<ClientDraft>; clientId?: string; partial?: boolean }> {
  const created = await createClient(draftToClientInput(draft));
  if (!created.data) {
    return { result: { ok: false, error: created.error, fieldErrors: firstFieldErrors(created.fieldErrors) } };
  }
  const clientId = created.data.client.id;
  if (draft.hasCustomRate) {
    const rate = await updateClientRateSettings(clientId, draftToRateInput(draft));
    if (!rate.data) {
      return {
        result: {
          ok: false,
          error: `the client was created, but its rate settings could not be saved: ${rate.error ?? "unknown error"}`,
        },
        clientId,
        partial: true,
      };
    }
  }
  return { result: { ok: true }, clientId };
}

export function articleOptionLabel(article: ArticleSelectOption) {
  return `${article.article_number} — ${article.description}`;
}
