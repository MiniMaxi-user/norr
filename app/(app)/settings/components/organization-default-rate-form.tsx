"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Card, FormGrid, Heading, Label, Select, Stack, Text } from "@yourorg/ui";
import { formatCurrency } from "@/lib/format/currency";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import {
  updateOrganizationDefaultRateSettings,
  type OrganizationDefaultRateSettings,
} from "../organization-rate-actions";

export interface OrganizationDefaultRateFormProps {
  initial: OrganizationDefaultRateSettings;
  /** `listArticlesForSelect()`'s result — every active article, same list the
   * client/engineer "Custom rate" pickers (`lib/rate-overrides/
   * rate-settings-section.tsx`) already use. */
  articles: ArticleSelectOption[];
  /** `can(actor, "settings", "update")` — owner-only, matching this action's
   * own gate (see `../organization-rate-actions.ts`'s header comment for why
   * this deviates from a literal "owner/planner" reading of the issue). A
   * non-owner never sees the form fields at all, only a read-only summary —
   * per docs/ARCHITECTURE.md's "hide, don't just disable" read-only pattern. */
  canWrite: boolean;
}

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  saved?: OrganizationDefaultRateSettings;
}

const initialState: FormState = {};

/**
 * Org-level default Travel/Work billing rate settings (issue #109 acceptance
 * criterion 4) — layer 3 of `resolve_billing_rate`'s 4-layer precedence
 * (client override -> engineer override -> ORG DEFAULT -> unresolved). Two
 * article pickers, each showing the picked article's own live sale price and
 * purchase price as a read-only preview (same pair `RateSettingsSection`
 * shows) — unlike `RateSettingsSection` (`lib/rate-overrides/rate-settings-
 * section.tsx`), there is no separate override sale price to edit at this
 * layer: the price IS the linked article's own `sale_price`, always read
 * live off the FK (see `../organization-rate-actions.ts`'s header comment),
 * so this is its own smaller component rather than a forced reuse of that
 * one — same visual language (article `<Select>` + read-only price
 * previews), just without the "Custom rate" checkbox or an editable sale
 * price field neither applies here.
 */
export function OrganizationDefaultRateForm({ initial, articles, canWrite }: OrganizationDefaultRateFormProps) {
  const [travelArticleId, setTravelArticleId] = useState(initial.defaultTravelArticleId ?? "");
  const [workArticleId, setWorkArticleId] = useState(initial.defaultWorkArticleId ?? "");

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const input = {
      defaultTravelArticleId: (formData.get("defaultTravelArticleId") as string) || null,
      defaultWorkArticleId: (formData.get("defaultWorkArticleId") as string) || null,
    };
    const result = await updateOrganizationDefaultRateSettings(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Could not save default rates.", fieldErrors: result.fieldErrors };
    }
    return { success: true, saved: result.data };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success && state.saved) {
      setTravelArticleId(state.saved.defaultTravelArticleId ?? "");
      setWorkArticleId(state.saved.defaultWorkArticleId ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  if (!canWrite) {
    return (
      <Card>
        <Stack gap="md">
          <RateReadOnlyRow label="Travel time" articleId={initial.defaultTravelArticleId} articles={articles} />
          <RateReadOnlyRow label="Work time" articleId={initial.defaultWorkArticleId} articles={articles} />
          <Text tone="muted">Only the organization owner can change these defaults.</Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}
          {state.success && <Text tone="success">Default rates saved.</Text>}

          <RateArticleField
            idPrefix="org-default-travel"
            label="Travel time"
            name="defaultTravelArticleId"
            articleId={travelArticleId}
            onArticleChange={setTravelArticleId}
            articles={articles}
            errors={state.fieldErrors?.defaultTravelArticleId}
          />
          <RateArticleField
            idPrefix="org-default-work"
            label="Work time"
            name="defaultWorkArticleId"
            articleId={workArticleId}
            onArticleChange={setWorkArticleId}
            articles={articles}
            errors={state.fieldErrors?.defaultWorkArticleId}
          />

          <div>
            <SubmitButton />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function RateArticleField({
  idPrefix,
  label,
  name,
  articleId,
  onArticleChange,
  articles,
  errors,
}: {
  idPrefix: string;
  label: string;
  name: "defaultTravelArticleId" | "defaultWorkArticleId";
  articleId: string;
  onArticleChange: (id: string) => void;
  articles: ArticleSelectOption[];
  errors?: string[];
}) {
  const picked = articles.find((article) => article.id === articleId) ?? null;

  return (
    <Stack gap="xs">
      <Heading level={6}>{label}</Heading>
      <FormGrid columns={3}>
        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-article`}>Article</Label>
          <Select
            id={`${idPrefix}-article`}
            name={name}
            value={articleId}
            onChange={(event) => onArticleChange(event.target.value)}
          >
            <option value="">Not set</option>
            {articles.map((article) => (
              <option key={article.id} value={article.id}>
                {article.article_number} — {article.description}
              </option>
            ))}
          </Select>
          {errors?.map((message) => (
            <Text key={message} tone="danger">
              {message}
            </Text>
          ))}
        </Stack>
        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-sale-price`}>Current sale price</Label>
          <Text id={`${idPrefix}-sale-price`}>{picked ? formatCurrency(picked.sale_price) : "—"}</Text>
        </Stack>
        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-purchase-price`}>Purchase price</Label>
          <Text id={`${idPrefix}-purchase-price`}>{picked ? formatCurrency(picked.purchase_price) : "—"}</Text>
        </Stack>
      </FormGrid>
    </Stack>
  );
}

function RateReadOnlyRow({
  label,
  articleId,
  articles,
}: {
  label: string;
  articleId: string | null;
  articles: ArticleSelectOption[];
}) {
  const picked = articleId ? (articles.find((article) => article.id === articleId) ?? null) : null;
  return (
    <FormGrid columns={3}>
      <Stack gap="xs">
        <Label>{label} article</Label>
        <Text>{picked ? `${picked.article_number} — ${picked.description}` : "Not set"}</Text>
      </Stack>
      <Stack gap="xs">
        <Label>Current sale price</Label>
        <Text>{picked ? formatCurrency(picked.sale_price) : "—"}</Text>
      </Stack>
      <Stack gap="xs">
        <Label>Purchase price</Label>
        <Text>{picked ? formatCurrency(picked.purchase_price) : "—"}</Text>
      </Stack>
    </FormGrid>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}
