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
  /** Edit mode only — the read view's SLA Tier/Billing terms/Billing period
   * badges source their label/color straight from this already-resolved
   * record. */
  contract?: ContractRecord;
  /** This org's `sla_tier` picklist values — a *dependent* list
   * (`parent_list_key = "contract_type"`). Passed down unfiltered; the SLA
   * Tier `<CascadingSelect>` below filters against `draft.typeId` (owned by
   * the sibling Contract details section, not editable here). */
  slaTiers: ReferenceListItemRecord[];
  billingTerms: ReferenceListItemRecord[];
  billingPeriods: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  loadingOptions?: boolean;
  onSave: (
    patch: Pick<ContractDraft, "slaTierId" | "billingTermsId" | "billingPeriodId" | "value" | "autoRenew">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Terms" section (issue #122) — service level, billing cadence/period, and
 * value. SLA Tier cascades off the Contract details section's own Type field
 * (`draft.typeId`, read-only here — Type isn't editable in this section):
 * remounted (via `key={draft.typeId}`) whenever the Contract details section
 * saves a new Type, so its uncontrolled `defaultValue` resets to whichever
 * option matches the new Type (or the placeholder, if none does) — same trick
 * the old `contract-form.tsx` used, copied verbatim rather than reinvented
 * (see this module's own doc comment in the story for why: Type and SLA Tier
 * now live in two independently-toggled `EditableSection`s instead of one
 * shared uncontrolled `<form>`).
 */
export function ContractTermsSection({
  mode,
  draft,
  contract,
  slaTiers,
  billingTerms,
  billingPeriods,
  editing,
  onEditToggle,
  readOnly,
  loadingOptions,
  onSave,
}: ContractTermsSectionProps) {
  const [slaTierId, setSlaTierId] = useState(draft.slaTierId);
  const [billingTermsId, setBillingTermsId] = useState(draft.billingTermsId);
  const [billingPeriodId, setBillingPeriodId] = useState(draft.billingPeriodId);
  const [value, setValue] = useState(draft.value);
  const [autoRenew, setAutoRenew] = useState(draft.autoRenew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setSlaTierId(draft.slaTierId);
    setBillingTermsId(draft.billingTermsId);
    setBillingPeriodId(draft.billingPeriodId);
    setValue(draft.value);
    setAutoRenew(draft.autoRenew);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const slaTierCascadeOptions = useMemo(
    () => slaTiers.map((item) => ({ id: item.id, label: item.label, parentId: item.parent_item_id ?? "" })),
    [slaTiers],
  );

  function handleCancel() {
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
    const result = await onSave({ slaTierId, billingTermsId, billingPeriodId, value, autoRenew });
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
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="contract-terms-sla-tier">SLA Tier</Label>
              <CascadingSelect
                id="contract-terms-sla-tier"
                key={draft.typeId}
                defaultValue={slaTierId}
                parentValue={draft.typeId}
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
