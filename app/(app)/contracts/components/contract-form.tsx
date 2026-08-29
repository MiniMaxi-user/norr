"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CascadingSelect,
  Checkbox,
  FormField,
  FormGrid,
  FormSection,
  FormSelectField,
  Inline,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import type { ContractRecord } from "../actions";
import {
  createContractFormAction,
  updateContractFormAction,
  type ContractFormState,
} from "../contract-form-actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

const initialState: ContractFormState = { ok: false };

export interface ContractFormProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  contract?: ContractRecord;
  /** Org's clients, for the client picker. Ignored (and the picker hidden
   * entirely) when `lockedClientId` is set. */
  clients: ClientRecord[];
  /**
   * Pre-scopes the contract to a single client and hides the client selector
   * entirely — used when this form is opened in a client-scoped context (a
   * future Client detail page "New contract" action, via
   * `/contracts/new?clientId=...`), where the client is already implied and
   * re-picking it makes no sense. Mirrors `AssetForm`/`WorkOrderForm`'s
   * `lockedClientId`.
   */
  lockedClientId?: string;
  /** This org's `contract_type` picklist values. */
  contractTypes: ReferenceListItemRecord[];
  /** This org's `sla_tier` picklist values — a *dependent* list
   * (`parent_list_key = "contract_type"`, each item's `parent_item_id` points
   * at the `contract_type` item it belongs under). Passed down unfiltered;
   * the SLA Tier `<CascadingSelect>` below does its own filtering against the
   * currently selected Contract Type. */
  slaTiers: ReferenceListItemRecord[];
  /** This org's `billing_terms` picklist values — flat, standalone (not
   * dependent on Contract Type). */
  billingTerms: ReferenceListItemRecord[];
  /** Where "Cancel" navigates to. */
  cancelHref: string;
}

/**
 * Create/edit form for a contract, rendered as a real page (`/contracts/new`,
 * `/contracts/[id]/edit`) rather than a `Dialog` — per docs/ARCHITECTURE.md
 * "Popup vs. full page — pick by weight, not habit" (Contracts is named
 * there as a top-level module entity, same tier as Clients/Assets/Work
 * Orders).
 *
 * Contract Type -> SLA Tier cascade mirrors `asset-form.tsx`'s Type ->
 * Sub-type `<CascadingSelect>` wiring exactly: the SLA Tier select is
 * remounted (via `key={selectedTypeId}`) whenever the selected Contract Type
 * changes, so its uncontrolled `defaultValue` resets to whichever option
 * matches the new type (or the placeholder, if none does). Unlike Asset
 * Sub-type, SLA Tier has no `is_default` item at all (see the migration's
 * seeding comment — "one default tier per contract type" doesn't map onto
 * the list-wide `is_default` mechanism), so its placeholder always reads
 * "None" once a type is selected, never "Use default (...)".
 */
export function ContractForm({
  mode,
  contract,
  clients,
  lockedClientId,
  contractTypes,
  slaTiers,
  billingTerms,
  cancelHref,
}: ContractFormProps) {
  const router = useRouter();
  const action =
    mode === "edit" && contract ? updateContractFormAction.bind(null, contract.id) : createContractFormAction;
  const [state, formAction] = useActionState(action, initialState);

  const [selectedClientId, setSelectedClientId] = useState(lockedClientId ?? contract?.client_id ?? "");
  // Controlled (not just `defaultValue`) because the SLA Tier
  // `<CascadingSelect>` below needs to know the currently selected Contract
  // Type on every render to filter/disable itself — same reasoning as
  // `asset-form.tsx`'s `selectedTypeId`.
  const [selectedTypeId, setSelectedTypeId] = useState(contract?.type_id ?? "");

  useEffect(() => {
    if (state.ok && state.contract) {
      router.push(`/contracts/${state.contract.id}`);
    }
    // Only re-run when the action result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.contract]);

  const defaultType = contractTypes.find((item) => item.is_default);

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}

          <FormSection title="Contract" description="Who this agreement is with, and what kind it is.">
            <Stack gap="md">
              {!lockedClientId && (
                <Stack gap="sm">
                  <Label htmlFor="contract-client">Client</Label>
                  <Select
                    id="contract-client"
                    name="clientId"
                    value={selectedClientId}
                    onChange={(event) => setSelectedClientId(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select a client…
                    </option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.clientId && <Text tone="danger">{state.fieldErrors.clientId[0]}</Text>}
                </Stack>
              )}
              {lockedClientId && <input type="hidden" name="clientId" value={lockedClientId} />}

              <FormField
                label="Name"
                name="name"
                defaultValue={contract?.name}
                required
                maxLength={200}
                errors={state.fieldErrors?.name}
              />

              <Stack gap="sm">
                <Label htmlFor="contract-type">Type</Label>
                <Select
                  id="contract-type"
                  name="typeId"
                  value={selectedTypeId}
                  onChange={(event) => setSelectedTypeId(event.target.value)}
                >
                  <option value="">
                    {defaultType ? `Use default (${defaultType.label})` : "Use organization default"}
                  </option>
                  {contractTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                {state.fieldErrors?.typeId && <Text tone="danger">{state.fieldErrors.typeId[0]}</Text>}
              </Stack>
            </Stack>
          </FormSection>

          <FormSection title="Terms" description="Service level, billing cadence, and value.">
            <Stack gap="md">
              <FormGrid columns={2}>
                <Stack gap="sm">
                  <Label htmlFor="contract-sla-tier">SLA Tier</Label>
                  {/* Remounted (via `key`) whenever the selected Type
                      changes, so its uncontrolled `defaultValue` resets to
                      whichever option matches the new Type (or the
                      placeholder, if none does) — same trick
                      `asset-form.tsx`'s Sub-type select uses. */}
                  <CascadingSelect
                    id="contract-sla-tier"
                    name="slaTierId"
                    key={selectedTypeId}
                    defaultValue={contract?.type_id === selectedTypeId ? contract?.sla_tier_id ?? "" : ""}
                    parentValue={selectedTypeId}
                    options={slaTiers.map((item) => ({
                      id: item.id,
                      label: item.label,
                      parentId: item.parent_item_id ?? "",
                    }))}
                    placeholder="None"
                    emptyParentPlaceholder="Select a contract type first…"
                  />
                  {state.fieldErrors?.slaTierId && <Text tone="danger">{state.fieldErrors.slaTierId[0]}</Text>}
                </Stack>

                <FormSelectField
                  label="Billing terms"
                  name="billingTermsId"
                  defaultValue={contract?.billing_terms_id ?? ""}
                  errors={state.fieldErrors?.billingTermsId}
                >
                  <option value="">No billing terms</option>
                  {billingTerms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </FormSelectField>
              </FormGrid>

              <FormGrid columns={2}>
                <FormField
                  label="Value"
                  name="value"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={contract?.value ?? ""}
                  errors={state.fieldErrors?.value}
                />

                <Stack gap="sm">
                  <Label>&nbsp;</Label>
                  <Inline gap="sm" align="center">
                    <Checkbox id="contract-auto-renew" name="autoRenew" defaultChecked={contract?.auto_renew ?? false} />
                    <Label htmlFor="contract-auto-renew">Auto-renews</Label>
                  </Inline>
                </Stack>
              </FormGrid>
            </Stack>
          </FormSection>

          <FormSection title="Dates" description="When this contract is (or was) in effect.">
            <FormGrid columns={2}>
              <FormField
                label="Start date"
                name="startDate"
                type="date"
                defaultValue={contract?.start_date ?? ""}
                required
                errors={state.fieldErrors?.startDate}
              />

              <Stack gap="xs">
                <FormField
                  label="End date"
                  name="endDate"
                  type="date"
                  defaultValue={contract?.end_date ?? ""}
                  errors={state.fieldErrors?.endDate}
                />
                <Text tone="muted">Leave blank for an open-ended contract.</Text>
              </Stack>
            </FormGrid>
          </FormSection>

          <FormSection title="Notes">
            <Stack gap="sm">
              <Label htmlFor="contract-notes">Notes</Label>
              <Textarea id="contract-notes" name="notes" defaultValue={contract?.notes ?? ""} rows={4} />
              {state.fieldErrors?.notes && <Text tone="danger">{state.fieldErrors.notes[0]}</Text>}
            </Stack>
          </FormSection>

          <div>
            <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
              Cancel
            </Button>{" "}
            <SubmitButton mode={mode} />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : mode === "create" ? "Add contract" : "Save changes"}
    </Button>
  );
}
