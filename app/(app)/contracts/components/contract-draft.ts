import type { ContractRecord } from "../actions";
import type { ContractInvoicingTiming } from "../schema";

/**
 * The contract's own editable fields, as one flat draft object — the raw
 * input-shaped record `useEditMode` (web design system, issue #222) edits on
 * `/contracts/[id]` and `/contracts/new`. Strings for every input
 * (`value` is the typed amount), a real boolean for `autoRenew`;
 * `draftToInput` below does the coercion `contractCreateSchema`/
 * `contractUpdateSchema` (`../schema.ts`) expect.
 *
 * `clientId` is part of the draft so the new page can validate it, but it is
 * never sent on update (a contract's client is fixed at creation, issue #217).
 */
// A `type` alias (not an `interface`) so it is assignable to the
// `Record<string, string | boolean>` `useEditMode` edits.
export type ContractDraft = {
  clientId: string;
  externalReference: string;
  typeId: string;
  slaTierId: string;
  billingTermsId: string;
  billingPeriodId: string;
  invoicingTiming: ContractInvoicingTiming;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  value: string;
  notes: string;
};

export function draftFromContract(contract: ContractRecord): ContractDraft {
  return {
    clientId: contract.client_id,
    externalReference: contract.external_reference ?? "",
    typeId: contract.type_id,
    slaTierId: contract.sla_tier_id ?? "",
    billingTermsId: contract.billing_terms_id ?? "",
    billingPeriodId: contract.billing_period_id ?? "",
    invoicingTiming: contract.invoicing_timing,
    startDate: contract.start_date,
    endDate: contract.end_date ?? "",
    autoRenew: contract.auto_renew,
    value: contract.value === null ? "" : String(contract.value),
    notes: contract.notes ?? "",
  };
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Empty draft of the new page: start date today, client pre-scoped when the
 * user came from a client's Contracts tab. */
export function emptyDraft(options: { lockedClientId?: string; defaultTypeId?: string } = {}): ContractDraft {
  return {
    clientId: options.lockedClientId ?? "",
    externalReference: "",
    typeId: options.defaultTypeId ?? "",
    slaTierId: "",
    billingTermsId: "",
    billingPeriodId: "",
    invoicingTiming: "in_advance",
    startDate: todayIso(),
    endDate: "",
    autoRenew: false,
    value: "",
    notes: "",
  };
}

/** Converts a draft (or a partial patch of one) into the shape
 * `createContract`/`updateContract` (`../actions.ts`) expect. An emptied
 * optional field is sent as an empty string, which the schema turns into
 * `null` (clears the column); `typeId`/`startDate` are required, so an empty
 * value there is simply not sent. */
export function draftToInput(patch: Partial<ContractDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.externalReference !== undefined) input.externalReference = patch.externalReference;
  if (patch.typeId) input.typeId = patch.typeId;
  if (patch.slaTierId !== undefined) input.slaTierId = patch.slaTierId;
  if (patch.billingTermsId !== undefined) input.billingTermsId = patch.billingTermsId;
  if (patch.billingPeriodId !== undefined) input.billingPeriodId = patch.billingPeriodId;
  if (patch.invoicingTiming) input.invoicingTiming = patch.invoicingTiming;
  if (patch.startDate) input.startDate = patch.startDate;
  if (patch.endDate !== undefined) input.endDate = patch.endDate;
  if (patch.autoRenew !== undefined) input.autoRenew = patch.autoRenew;
  if (patch.value !== undefined) input.value = patch.value;
  if (patch.notes !== undefined) input.notes = patch.notes;
  return input;
}
