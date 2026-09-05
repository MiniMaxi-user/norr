"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  CascadingSelect,
  Checkbox,
  EditableSection,
  FormGrid,
  Inline,
  Input,
  KeyValueList,
  Label,
  Select,
  Stack,
  Text,
} from "@yourorg/ui";
import { Receipt } from "@yourorg/ui/icons";
import type { ContractRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatCurrency } from "@/lib/format/currency";
import type { ContractDraft } from "./contract-draft";

export interface ContractTermsSectionProps {
  mode: "create" | "edit";
  draft: Pick<ContractDraft, "typeId" | "slaTierId" | "billingTermsId" | "billingPeriodId" | "value" | "autoRenew">;
  /** Edit mode only — the read view's Type/SLA Tier/Billing terms/Billing
   * period badges source their label/color straight from this already-
   * resolved record. */
  contract?: ContractRecord;
  contractTypes: ReferenceListItemRecord[];
  /** This org's `sla_tier` picklist values — a *dependent* list
   * (`parent_list_key = "contract_type"`). Passed down unfiltered; the SLA
   * Tier `<CascadingSelect>` below filters against this section's own local
   * `typeId` state. */
  slaTiers: ReferenceListItemRecord[];
  billingTerms: ReferenceListItemRecord[];
  billingPeriods: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  loadingOptions?: boolean;
  onSave: (
    patch: Pick<ContractDraft, "typeId" | "slaTierId" | "billingTermsId" | "billingPeriodId" | "value" | "autoRenew">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Terms" section (issue #122, restructured by the Contract detail "1b"
 * layout, docs/designinstructieskanweg/"Contract detail 1b - implementatie
 * .md") — service level, billing cadence/period, and value, now WITH Type as
 * its first field (moved out of the deleted `ContractDetailsSection`: Name
 * went to the hero title, Client to the rail's `RelationCard`, and Type here
 * since it's the one field SLA Tier actually cascades against).
 *
 * Type and SLA Tier now live in the SAME `EditableSection`/local edit state,
 * so the old `key={draft.typeId}` remount trick on `CascadingSelect` (needed
 * back when Type lived in a sibling section that saved independently) is
 * gone — `typeId` is a normal local `useState` here, and `slaTierId`'s
 * `CascadingSelect` is now fully controlled (`value`, not `defaultValue`) so
 * clearing it when `typeId` changes just works through React state, no
 * remount needed. `handleTypeChange` clears `slaTierId` whenever `typeId`
 * changes, since a tier valid for the old type may not exist under the new
 * one (docs/ARCHITECTURE.md "Domain completeness" — re-filter/clear a
 * dependent field when its parent changes).
 */
export function ContractTermsSection({
  mode,
  draft,
  contract,
  contractTypes,
  slaTiers,
  billingTerms,
  billingPeriods,
  editing,
  onEditToggle,
  readOnly,
  loadingOptions,
  onSave,
}: ContractTermsSectionProps) {
  const [typeId, setTypeId] = useState(draft.typeId);
  const [slaTierId, setSlaTierId] = useState(draft.slaTierId);
  const [billingTermsId, setBillingTermsId] = useState(draft.billingTermsId);
  const [billingPeriodId, setBillingPeriodId] = useState(draft.billingPeriodId);
  const [value, setValue] = useState(draft.value);
  const [autoRenew, setAutoRenew] = useState(draft.autoRenew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setTypeId(draft.typeId);
    setSlaTierId(draft.slaTierId);
    setBillingTermsId(draft.billingTermsId);
    setBillingPeriodId(draft.billingPeriodId);
    setValue(draft.value);
    setAutoRenew(draft.autoRenew);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const defaultType = contractTypes.find((item) => item.is_default);

  const slaTierCascadeOptions = useMemo(
    () => slaTiers.map((item) => ({ id: item.id, label: item.label, parentId: item.parent_item_id ?? "" })),
    [slaTiers],
  );

  function handleTypeChange(nextTypeId: string) {
    setTypeId(nextTypeId);
    setSlaTierId("");
  }

  function handleCancel() {
    setTypeId(draft.typeId);
    setSlaTierId(draft.slaTierId);
    setBillingTermsId(draft.billingTermsId);
    setBillingPeriodId(draft.billingPeriodId);
    setValue(draft.value);
    setAutoRenew(draft.autoRenew);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ typeId, slaTierId, billingTermsId, billingPeriodId, value, autoRenew });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  return (
    <EditableSection
      icon={Receipt}
      title="Terms"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit terms"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="contract-terms-type">Type</Label>
            <Select
              id="contract-terms-type"
              value={typeId}
              onChange={(event) => handleTypeChange(event.target.value)}
              disabled={loadingOptions}
            >
              <option value="">{defaultType ? `Use default (${defaultType.label})` : "Use organization default"}</option>
              {contractTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Stack>

          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="contract-terms-sla-tier">SLA Tier</Label>
              <CascadingSelect
                id="contract-terms-sla-tier"
                value={slaTierId}
                parentValue={typeId}
                options={slaTierCascadeOptions}
                placeholder="None"
                emptyParentPlaceholder="Set a contract type first…"
                disabled={loadingOptions}
                onChange={(event) => setSlaTierId(event.target.value)}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="contract-terms-billing-terms">Billing terms</Label>
              <Select
                id="contract-terms-billing-terms"
                value={billingTermsId}
                onChange={(event) => setBillingTermsId(event.target.value)}
                disabled={loadingOptions}
              >
                <option value="">No billing terms</option>
                {billingTerms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Stack>
          </FormGrid>

          <Stack gap="xs">
            <Label htmlFor="contract-terms-billing-period">Billing period</Label>
            <Select
              id="contract-terms-billing-period"
              value={billingPeriodId}
              onChange={(event) => setBillingPeriodId(event.target.value)}
              disabled={loadingOptions}
            >
              <option value="">No billing period</option>
              {billingPeriods.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Text tone="muted">
              Billing terms is how often this contract is invoiced; billing period is how the contract&rsquo;s own
              value accrues (e.g. a monthly value invoiced annually).
            </Text>
          </Stack>

          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="contract-terms-value">Value</Label>
              <Input
                id="contract-terms-value"
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </Stack>
            <Stack gap="xs">
              <Label>&nbsp;</Label>
              <Inline gap="sm" align="center">
                <Checkbox
                  id="contract-terms-auto-renew"
                  checked={autoRenew}
                  onChange={(event) => setAutoRenew(event.target.checked)}
                />
                <Label htmlFor="contract-terms-auto-renew">Auto-renews</Label>
              </Inline>
            </Stack>
          </FormGrid>

          <Inline gap="sm" justify="end">
            {mode === "edit" && (
              <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Inline>
        </Stack>
      }
    >
      <KeyValueList
        items={[
          {
            key: "type",
            label: "Type",
            value: (
              <Badge color={contract?.contract_type?.color} variant="muted">
                {contract?.contract_type?.label ?? "—"}
              </Badge>
            ),
          },
          {
            key: "sla-tier",
            label: "SLA Tier",
            value: contract?.sla_tier ? (
              <Badge color={contract.sla_tier.color} variant="muted">
                {contract.sla_tier.label}
              </Badge>
            ) : (
              <Text tone="muted">—</Text>
            ),
          },
          { key: "billing-terms", label: "Billing terms", value: <Text>{contract?.billing_terms?.label ?? "—"}</Text> },
          { key: "billing-period", label: "Billing period", value: <Text>{contract?.billing_period?.label ?? "—"}</Text> },
          { key: "value", label: "Value", value: <Text>{formatCurrency(contract?.value ?? null)}</Text> },
          { key: "auto-renew", label: "Auto-renews", value: <Text>{contract?.auto_renew ? "Yes" : "No"}</Text> },
        ]}
      />
    </EditableSection>
  );
}
