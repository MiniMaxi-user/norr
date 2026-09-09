"use client";

import { EditableSection, FormGrid, Input, KeyValueList, Label, Select, Stack, Text } from "@yourorg/ui";
import { CreditCard } from "@yourorg/ui/icons";
import type { ArticleRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatCurrency } from "@/lib/format/currency";
import type { ArticleDraft } from "./article-draft";

export interface ArticlePricingSectionProps {
  draft: Pick<ArticleDraft, "purchasePrice" | "salePrice" | "vatRateItemId">;
  article: ArticleRecord;
  vatRates: ReferenceListItemRecord[];
  editing: boolean;
  /** See `ArticleInfoSectionProps.onFieldChange`'s own doc comment. */
  onFieldChange: (patch: Partial<Pick<ArticleDraft, "purchasePrice" | "salePrice" | "vatRateItemId">>) => void;
}

/**
 * "Pricing & VAT" section — Purchase price, Sale price, VAT rate. Same
 * read-card/accent-edit-card toggle as every other section on this screen,
 * `editing` driven purely by the parent's single `pageEditing` boolean (see
 * `article-screen.tsx`'s own module doc comment) — no per-section pencil/
 * Save here.
 */
export function ArticlePricingSection({ draft, article, vatRates, editing, onFieldChange }: ArticlePricingSectionProps) {
  const defaultVatRate = vatRates.find((item) => item.is_default);

  return (
    <EditableSection
      icon={CreditCard}
      title="Pricing & VAT"
      editing={editing}
      editLabel="Edit pricing"
      editContent={
        <FormGrid columns={3}>
          <Stack gap="xs">
            <Label htmlFor="article-price-purchase">Purchase price</Label>
            <Input
              id="article-price-purchase"
              type="number"
              step="0.01"
              min="0"
              value={draft.purchasePrice}
              onChange={(event) => onFieldChange({ purchasePrice: event.target.value })}
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
              value={draft.salePrice}
              onChange={(event) => onFieldChange({ salePrice: event.target.value })}
              prefix="€"
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="article-price-vat">VAT rate</Label>
            <Select
              id="article-price-vat"
              value={draft.vatRateItemId}
              onChange={(event) => onFieldChange({ vatRateItemId: event.target.value })}
            >
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
      }
    >
      <KeyValueList
        items={[
          { key: "purchase", label: "Purchase price", value: <Text>{formatCurrency(article.purchase_price)}</Text> },
          { key: "sale", label: "Sale price", value: <Text>{formatCurrency(article.sale_price)}</Text> },
          {
            key: "vat",
            label: "VAT rate",
            value: <Text>{article.vat_rate ? `${article.vat_rate.value}%` : "—"}</Text>,
          },
        ]}
      />
    </EditableSection>
  );
}
