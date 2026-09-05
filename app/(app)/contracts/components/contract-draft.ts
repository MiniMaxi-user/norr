import type { ContractRecord } from "../actions";

/**
 * The contract's own editable fields, as one flat draft object — the single
 * source of truth `ContractScreen` owns for the unified create/view/edit
 * screen (issue #122, mirroring `app/(app)/assets/components/asset-draft.ts`).
 * Every section of the page (Contract details/Terms/Dates/Notes) reads from
 * this and writes back through `ContractScreen`'s own `commitPatch`.
 *
 * `value`/`autoRenew` mirror every other free-text/date field here as plain
 * strings (`value`) or a real boolean (`autoRenew`) — `draftToInput` below is
 * what does the actual coercion `contractCreateSchema`/`contractUpdateSchema`
 * (`../schema.ts`) expect.
 */
export interface ContractDraft {
  clientId: string;
  name: string;
  typeId: string;
  slaTierId: string;
  billingTermsId: string;
  billingPeriodId: string;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  value: string;
  notes: string;
}

export function draftFromContract(contract: ContractRecord): ContractDraft {
  return {
    clientId: contract.client_id,
    name: contract.name,
    typeId: contract.type_id,
    slaTierId: contract.sla_tier_id ?? "",
    billingTermsId: contract.billing_terms_id ?? "",
    billingPeriodId: contract.billing_period_id ?? "",
    startDate: contract.start_date,
    endDate: contract.end_date ?? "",
    autoRenew: contract.auto_renew,
    value: contract.value === null ? "" : String(contract.value),
    notes: contract.notes ?? "",
  };
}

export function emptyDraft(options: {
  /** Pre-scopes (and hides the picker for) the client — a future
   * client-scoped "New contract" entry point, or `/contracts/new?clientId=...`
   * — same convention `AssetDraft`'s `emptyDraft` documents for itself. */
  lockedClientId?: string;
}): ContractDraft {
  return {
    clientId: options.lockedClientId ?? "",
    name: "",
    typeId: "",
    slaTierId: "",
    billingTermsId: "",
    billingPeriodId: "",
    startDate: "",
    endDate: "",
    autoRenew: false,
    value: "",
    notes: "",
  };
}

/** Converts a draft (or a partial patch of one) into the shape
 * `createContract`/`updateContract` (`../actions.ts`) expect — empty-string
 * "unset" values become `undefined` (not sent) rather than an empty string
 * that would fail the schema's `uuid()`/date shape checks. */
export function draftToInput(patch: Partial<ContractDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.clientId !== undefined) input.clientId = patch.clientId || undefined;
  if (patch.name !== undefined) input.name = patch.name;
  if (patch.typeId !== undefined) input.typeId = patch.typeId || undefined;
  if (patch.slaTierId !== undefined) input.slaTierId = patch.slaTierId || undefined;
  if (patch.billingTermsId !== undefined) input.billingTermsId = patch.billingTermsId || undefined;
  if (patch.billingPeriodId !== undefined) input.billingPeriodId = patch.billingPeriodId || undefined;
  if (patch.startDate !== undefined) input.startDate = patch.startDate || undefined;
  if (patch.endDate !== undefined) input.endDate = patch.endDate || undefined;
  if (patch.autoRenew !== undefined) input.autoRenew = patch.autoRenew;
  if (patch.value !== undefined) input.value = patch.value || undefined;
  if (patch.notes !== undefined) input.notes = patch.notes || undefined;
  return input;
}
