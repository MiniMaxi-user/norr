import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import { createContract, updateContract } from "../actions";
import { draftToInput, type ContractDraft } from "./contract-draft";

/**
 * Edit-mode schema for the Contract page (design system, issue #222): label,
 * required marker and validation per field. Mirrors `../schema.ts`
 * (`contractCreateSchema`) — the server stays the authority — with messages
 * that say what is wrong and how to fix it.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_HINT = "Enter a date as dd-mm-yyyy, for example 17-11-2026";

function tooLong(label: string, value: string, max: number) {
  const length = value.trim().length;
  return length > max ? `${label} is ${length} characters, the maximum is ${max}. Remove ${length - max}` : null;
}

export type ContractLabelKey = "clientId" | "typeId" | "slaTierId" | "billingTermsId" | "billingPeriodId";

export function buildContractSchema(options: {
  labelFor: (key: ContractLabelKey, id: string) => string;
  /** New mode: the client is chosen (or locked); on an existing contract it
   * is fixed and not validated. */
  isNew?: boolean;
}): EditSchema<ContractDraft> {
  const { labelFor, isNew } = options;
  const labelled = (key: ContractLabelKey) => (value: string) => (value ? labelFor(key, value) : "");
  return {
    clientId: {
      label: "Client",
      required: Boolean(isNew),
      format: labelled("clientId"),
      validate: (value) => (isNew && !value ? "Choose a client" : null),
    },
    externalReference: {
      label: "External reference",
      validate: (value) => tooLong("External reference", value, 200),
    },
    typeId: {
      label: "Type",
      required: true,
      format: labelled("typeId"),
      validate: (value) => (value ? null : "Choose a contract type"),
    },
    slaTierId: { label: "SLA tier", format: labelled("slaTierId") },
    billingTermsId: { label: "Billing terms", format: labelled("billingTermsId") },
    billingPeriodId: { label: "Billing period", format: labelled("billingPeriodId") },
    startDate: {
      label: "Start date",
      required: true,
      validate: (value) => {
        if (!value) return "Enter the start date";
        return ISO_DATE.test(value) ? null : DATE_HINT;
      },
    },
    endDate: {
      label: "End date",
      validate: (value, draft) => {
        if (!value) return null;
        if (!ISO_DATE.test(value)) return DATE_HINT;
        if (draft.startDate && value < draft.startDate) {
          return "The contract ends before it starts. Choose a later end date or clear it for an open-ended contract";
        }
        return null;
      },
    },
    autoRenew: { label: "Auto-renews", format: (value) => (value ? "Yes" : "No") },
    value: {
      label: "Value",
      validate: (value) => {
        const text = value.trim();
        if (!text) return null;
        const amount = Number(text);
        if (!Number.isFinite(amount)) return "Enter the value as a number, for example 12300.00";
        if (amount < 0) return "The value cannot be negative. Enter 0 or more";
        if (Math.abs(amount - Math.round(amount * 100) / 100) >= 1e-9) {
          return "Use at most 2 decimals, for example 12300.50";
        }
        if (amount >= 1e10) return "The value is too large. Enter less than 10,000,000,000";
        return null;
      },
    },
    notes: { label: "Notes", validate: (value) => tooLong("Notes", value, 5000) },
  };
}

type DraftKey = keyof ContractDraft & string;

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Partial<Record<DraftKey, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as DraftKey] = messages[0];
  }
  return mapped;
}

/** Persists an edited contract through the existing `updateContract` action
 * (RBAC, zod validation and RLS unchanged) — only the changed fields are sent. */
export async function saveContractEdits(
  contractId: string,
  draft: ContractDraft,
  dirty: DirtyField<ContractDraft>[],
): Promise<SaveResult<ContractDraft>> {
  const patch: Partial<ContractDraft> = {};
  for (const entry of dirty) (patch as Record<string, unknown>)[entry.key] = draft[entry.key];
  const input = draftToInput(patch);
  if (Object.keys(input).length === 0) return { ok: true };
  const result = await updateContract(contractId, input);
  if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  return { ok: true };
}

/** Creates a contract (new mode) through `createContract`; resolves with the
 * new id so the page can open its read page. */
export async function createContractFromDraft(
  draft: ContractDraft,
): Promise<{ result: SaveResult<ContractDraft>; contractId?: string }> {
  const created = await createContract({ clientId: draft.clientId, ...draftToInput(draft) });
  if (!created.data) {
    return { result: { ok: false, error: created.error, fieldErrors: firstFieldErrors(created.fieldErrors) } };
  }
  return { result: { ok: true }, contractId: created.data.contract.id };
}
