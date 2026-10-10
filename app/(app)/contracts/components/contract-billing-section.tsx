"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
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
import { formatDate } from "@/lib/format/date";
import type { ContractDraft } from "./contract-draft";

type BillingPatch = Pick<ContractDraft, "billingTermsId" | "billingPeriodId" | "value">;

export interface ContractBillingSectionProps {
  draft: BillingPatch;
  contract: ContractRecord;
  billingTerms: ReferenceListItemRecord[];
  billingPeriods: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  loadingOptions?: boolean;
  onSave: (patch: BillingPatch) => Promise<{ ok: boolean; error?: string }>;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function cadenceHint(intervalMonths: number | null | undefined): string {
  if (!intervalMonths) return "Non-recurring";
  return intervalMonths === 1 ? "Every month" : `Every ${intervalMonths} months`;
}

/**
 * "Billing" section (issue #209) — billing terms/period, value, and the
 * read-only, DB-computed next invoice date. Split out of `ContractTermsSection`
 * with its own edit state, same read-card/edit-card pattern.
 */
export function ContractBillingSection({
  draft,
  contract,
  billingTerms,
  billingPeriods,
  editing,
  onEditToggle,
  readOnly,
  loadingOptions,
  onSave,
}: ContractBillingSectionProps) {
  const [billingTermsId, setBillingTermsId] = useState(draft.billingTermsId);
  const [billingPeriodId, setBillingPeriodId] = useState(draft.billingPeriodId);
  const [value, setValue] = useState(draft.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setBillingTermsId(draft.billingTermsId);
    setBillingPeriodId(draft.billingPeriodId);
    setValue(draft.value);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setBillingTermsId(draft.billingTermsId);
    setBillingPeriodId(draft.billingPeriodId);
    setValue(draft.value);
    setError(null);
    onEditToggle?.(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ billingTermsId, billingPeriodId, value });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onEditToggle?.(false);
  }

  const nextInvoiceDate = contract.next_invoice_date;
  const isDue = nextInvoiceDate !== null && nextInvoiceDate <= todayIso();

  const nextInvoiceValue = (
    <Stack gap="xs">
      {nextInvoiceDate ? (
        <Inline gap="sm" align="center">
          <Text>{formatDate(nextInvoiceDate, { month: "long" })}</Text>
          {isDue && <Badge variant="warning">Due</Badge>}
        </Inline>
      ) : (
        <Text tone="muted">Fully invoiced</Text>
      )}
      <Text tone="muted">{cadenceHint(contract.billing_terms?.interval_months)}</Text>
    </Stack>
  );

  return (
    <EditableSection
      icon={Receipt}
      title="Billing"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit billing"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="contract-billing-terms">Billing terms</Label>
            <Select
              id="contract-billing-terms"
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

          <Stack gap="xs">
            <Label htmlFor="contract-billing-period">Billing period</Label>
            <Select
              id="contract-billing-period"
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
              <Label htmlFor="contract-billing-value">Value</Label>
              <Input
                id="contract-billing-value"
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </Stack>
          </FormGrid>

          <Inline gap="sm" justify="end">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Inline>
        </Stack>
      }
    >
      <KeyValueList
        items={[
          { key: "billing-terms", label: "Billing terms", value: <Text>{contract.billing_terms?.label ?? "—"}</Text> },
          { key: "billing-period", label: "Billing period", value: <Text>{contract.billing_period?.label ?? "—"}</Text> },
          { key: "value", label: "Value", value: <Text>{formatCurrency(contract.value ?? null)}</Text> },
          { key: "next-invoice", label: "Next invoice date", value: nextInvoiceValue },
        ]}
      />
    </EditableSection>
  );
}
