"use client";

import { useState } from "react";
import { Badge, Checkbox, FormGrid, Heading, Inline, Input, Label, Select, Stack, Text } from "@yourorg/ui";
import { formatCurrency } from "@/lib/format/currency";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { RateOverrideRecord } from "./schema";

export interface RateSettingsSectionErrors {
  travelArticleId?: string[];
  workArticleId?: string[];
  travelSalePrice?: string[];
  workSalePrice?: string[];
}

export interface RateSettingsSectionProps {
  /** Unique per instance (this component is never rendered twice on the same
   * page today, but element ids must still be unique) — e.g.
   * `"client-rate"` / `"engineer-rate"`. */
  idPrefix: string;
  initial: RateOverrideRecord;
  /** `listArticlesForSelect()`'s result — every active article, with
   * `sale_price`/`purchase_price` already attached so picking one can
   * default-fill the sale price and show the read-only purchase price
   * without a second round trip. */
  articles: ArticleSelectOption[];
  /** A slice of the enclosing form's `fieldErrors` (see
   * `lib/actions/result.ts`) — same keys `rateOverrideSchema` produces. */
  errors?: RateSettingsSectionErrors;
  /** Short noun describing what this override applies to, used only in the
   * helper copy under the checkbox — "client" or "engineer". */
  subjectLabel: string;
}

function priceInputValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Shared "Custom rate" ("Afwijkend tarief") section (issue #93, "Reistijd en
 * werktijd artikelen beheren") — a checkbox that reveals a Travel-time/
 * Work-time article picker pair, each with an editable sale price (defaulted
 * from the picked article's own `sale_price` the instant it's picked, then
 * freely editable) and a READ-ONLY purchase price that always mirrors the
 * picked article's own `purchase_price` — purchase price is never stored on
 * the override row itself (see `./schema.ts`'s header comment), only ever
 * read live off `articles` here.
 *
 * ONE shared implementation for both call sites — the Client edit/new panels
 * (`app/(app)/clients/components/{edit,new}-client-panel.tsx`) and the
 * Engineer edit dialog (`app/(app)/settings/team/components/
 * edit-team-member-dialog.tsx`) — mirroring `./schema.ts`'s own "one shared
 * schema/mapper for both tables" reuse rather than duplicating this
 * interactive picker twice.
 *
 * Same controlled-`Checkbox`-toggles-a-conditional-block interaction pattern
 * as `ArticleFormPanel`'s "Composite article" checkbox
 * (`app/(app)/articles/components/article-form-panel.tsx`) — reused
 * verbatim rather than inventing a new show/hide convention.
 *
 * This component is NOT its own `<form>` — it renders plain `name`d fields
 * (`hasCustomRate`, `travelArticleId`, `workArticleId`, `travelSalePrice`,
 * `workSalePrice`) meant to live inside a caller's own
 * `<form action={formAction}>`, exactly like `FormSection`/`FormField`
 * elsewhere in this codebase. The caller's own `action()` must convert
 * `formData.get("hasCustomRate") === "on"` itself before calling
 * `updateClientRateSettings`/`updateTeamMemberRateSettings` — a `<Checkbox>`
 * that's unchecked is simply absent from `FormData`, not `false`, same fix
 * `article-form-panel.tsx` applies for its own `isComposite`/`isActive`
 * fields.
 */
export function RateSettingsSection({ idPrefix, initial, articles, errors, subjectLabel }: RateSettingsSectionProps) {
  const [hasCustomRate, setHasCustomRate] = useState(initial.hasCustomRate);
  const [travelArticleId, setTravelArticleId] = useState(initial.travelArticleId ?? "");
  const [workArticleId, setWorkArticleId] = useState(initial.workArticleId ?? "");
  const [travelSalePrice, setTravelSalePrice] = useState(priceInputValue(initial.travelSalePrice));
  const [workSalePrice, setWorkSalePrice] = useState(priceInputValue(initial.workSalePrice));

  const travelArticle = articles.find((article) => article.id === travelArticleId) ?? null;
  const workArticle = articles.find((article) => article.id === workArticleId) ?? null;

  return (
    <Stack gap="md">
      <Inline gap="sm" align="center">
        <Checkbox
          id={`${idPrefix}-has-custom-rate`}
          name="hasCustomRate"
          checked={hasCustomRate}
          onChange={(event) => setHasCustomRate(event.target.checked)}
        />
        <Label htmlFor={`${idPrefix}-has-custom-rate`}>Custom rate</Label>
        {hasCustomRate && <Badge variant="accent">Custom rate</Badge>}
      </Inline>
      <Text tone="muted">
        Override the default Travel-time and Work-time billing articles and sale prices for this {subjectLabel}.
        Purchase price always mirrors the picked article and can&rsquo;t be edited here.
      </Text>

      {hasCustomRate && (
        <Stack gap="md">
          <RateArticleRow
            idPrefix={`${idPrefix}-travel`}
            label="Travel time"
            articleFieldName="travelArticleId"
            salePriceFieldName="travelSalePrice"
            articleId={travelArticleId}
            onArticleChange={(id) => {
              setTravelArticleId(id);
              const picked = articles.find((article) => article.id === id);
              setTravelSalePrice(priceInputValue(picked?.sale_price ?? null));
            }}
            salePrice={travelSalePrice}
            onSalePriceChange={setTravelSalePrice}
            purchasePrice={travelArticle?.purchase_price ?? null}
            articles={articles}
            articleErrors={errors?.travelArticleId}
            salePriceErrors={errors?.travelSalePrice}
          />
          <RateArticleRow
            idPrefix={`${idPrefix}-work`}
            label="Work time"
            articleFieldName="workArticleId"
            salePriceFieldName="workSalePrice"
            articleId={workArticleId}
            onArticleChange={(id) => {
              setWorkArticleId(id);
              const picked = articles.find((article) => article.id === id);
              setWorkSalePrice(priceInputValue(picked?.sale_price ?? null));
            }}
            salePrice={workSalePrice}
            onSalePriceChange={setWorkSalePrice}
            purchasePrice={workArticle?.purchase_price ?? null}
            articles={articles}
            articleErrors={errors?.workArticleId}
            salePriceErrors={errors?.workSalePrice}
          />
        </Stack>
      )}
    </Stack>
  );
}

/** One Travel-time/Work-time row: article picker, editable sale price,
 * read-only purchase price — three columns via `FormGrid`, same field-row
 * shape as every other paired-fields row in this codebase. */
function RateArticleRow({
  idPrefix,
  label,
  articleFieldName,
  salePriceFieldName,
  articleId,
  onArticleChange,
  salePrice,
  onSalePriceChange,
  purchasePrice,
  articles,
  articleErrors,
  salePriceErrors,
}: {
  idPrefix: string;
  label: string;
  articleFieldName: "travelArticleId" | "workArticleId";
  salePriceFieldName: "travelSalePrice" | "workSalePrice";
  articleId: string;
  onArticleChange: (id: string) => void;
  salePrice: string;
  onSalePriceChange: (value: string) => void;
  purchasePrice: number | null;
  articles: ArticleSelectOption[];
  articleErrors?: string[];
  salePriceErrors?: string[];
}) {
  return (
    <Stack gap="xs">
      <Heading level={6}>{label}</Heading>
      <FormGrid columns={3}>
        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-article`}>Article</Label>
          <Select
            id={`${idPrefix}-article`}
            name={articleFieldName}
            value={articleId}
            onChange={(event) => onArticleChange(event.target.value)}
            required
          >
            <option value="">Select an article…</option>
            {articles.map((article) => (
              <option key={article.id} value={article.id}>
                {article.article_number} — {article.description}
              </option>
            ))}
          </Select>
          {articleErrors?.map((message) => (
            <Text key={message} tone="danger">
              {message}
            </Text>
          ))}
        </Stack>

        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-sale-price`}>Sale price</Label>
          <Input
            id={`${idPrefix}-sale-price`}
            name={salePriceFieldName}
            type="number"
            step="0.01"
            min="0"
            value={salePrice}
            onChange={(event) => onSalePriceChange(event.target.value)}
            required
          />
          {salePriceErrors?.map((message) => (
            <Text key={message} tone="danger">
              {message}
            </Text>
          ))}
        </Stack>

        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-purchase-price`}>Purchase price</Label>
          <Input
            id={`${idPrefix}-purchase-price`}
            readOnly
            tabIndex={-1}
            value={articleId ? formatCurrency(purchasePrice) : ""}
            placeholder="Select an article"
          />
        </Stack>
      </FormGrid>
    </Stack>
  );
}
