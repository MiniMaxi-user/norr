"use client";

import { useEffect, useState } from "react";
import { Button, EditableSection, FormGrid, Inline, Input, KeyValueList, Label, Select, Stack, Text } from "@yourorg/ui";
import { CreditCard } from "@yourorg/ui/icons";
import type { ArticleRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatCurrency } from "@/lib/format/currency";
import type { ArticleDraft } from "./article-draft";

export interface ArticlePricingSectionProps {
  mode: "create" | "edit";
  draft: Pick<ArticleDraft, "purchasePrice" | "salePrice" | "vatRateItemId">;
  article?: ArticleRecord;
  vatRates: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (
    patch: Pick<ArticleDraft, "purchasePrice" | "salePrice" | "vatRateItemId">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Pricing & VAT" section (issue #123, converting the old `ArticleFormPanel`
 * slide-in) — Purchase price, Sale price, VAT rate. Same read-card/
 * accent-edit-card toggle as every other section on this screen.
 */
export function ArticlePricingSection({ mode, draft, article, vatRates, editing, onEditToggle, readOnly, onSave }: ArticlePricingSectionProps) {
  const [purchasePrice, setPurchasePrice] = useState(draft.purchasePrice);
  const [salePrice, setSalePrice] = useState(draft.salePrice);
  const [vatRateItemId, setVatRateItemId] = useState(draft.vatRateItemId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setPurchasePrice(draft.purchasePrice);
    setSalePrice(draft.salePrice);
    setVatRateItemId(draft.vatRateItemId);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setPurchasePrice(draft.purchasePrice);
    setSalePrice(draft.salePrice);
    setVatRateItemId(draft.vatRateItemId);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ purchasePrice, salePrice, vatRateItemId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  const defaultVatRate = vatRates.find((item) => item.is_default);

  return (
    <EditableSection
      icon={CreditCard}
      title="Pricing & VAT"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit pricing"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <FormGrid columns={3}>
            <Stack gap="xs">
              <Label htmlFor="article-price-purchase">Purchase price</Label>
              <Input
                id="article-price-purchase"
                type="number"
                step="0.01"
                min="0"
                value={purchasePrice}
                onChange={(event) => setPurchasePrice(event.target.value)}
                prefix="€"
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-price-sale">Sale price</Label>
              <Input
                id="article-price-sale"
                type="number"
                step="0.01"
                min="0"
                value={salePrice}
                onChange={(event) => setSalePrice(event.target.value)}
                prefix="€"
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-price-vat">VAT rate</Label>
              <Select id="article-price-vat" value={vatRateItemId} onChange={(event) => setVatRateItemId(event.target.value)}>
                <option value="">
                  {defaultVatRate ? `Use default (${defaultVatRate.label})` : "Use organization default"}
                </option>
                {vatRates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
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
          { key: "purchase", label: "Purchase price", value: <Text>{formatCurrency(article?.purchase_price ?? null)}</Text> },
          { key: "sale", label: "Sale price", value: <Text>{formatCurrency(article?.sale_price ?? null)}</Text> },
          {
            key: "vat",
            label: "VAT rate",
            value: <Text>{article?.vat_rate ? `${article.vat_rate.value}%` : "—"}</Text>,
          },
        ]}
      />
    </EditableSection>
  );
}
