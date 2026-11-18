"use client";

import { useMemo } from "react";
import { WebCardPair, WebHint } from "@yourorg/ui/web";
import { KeyValueCard, type EditSchema, type KvField, type KvOption, type SaveResult } from "@yourorg/ui/web-client";
import { formatCurrency } from "@/lib/format/currency";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import {
  updateOrganizationDefaultRateSettings,
  type OrganizationDefaultRateSettings,
} from "../organization-rate-actions";
import { firstFieldErrors, SettingsFormPage, useSettingsEdit } from "./settings-form-page";

export interface OrganizationDefaultRateFormProps {
  initial: OrganizationDefaultRateSettings;
  /** `listArticlesForSelect()`'s result — every active article, same list the
   * client/engineer "Custom rate" pickers (`lib/rate-overrides/
   * rate-settings-section.tsx`) already use. */
  articles: ArticleSelectOption[];
  /** `can(actor, "settings", "update")` — owner-only, matching this action's
   * own gate (see `../organization-rate-actions.ts`'s header comment). Without
   * it the page has no Edit button, only the read view. */
  canWrite: boolean;
}

type RateDraft = {
  defaultTravelArticleId: string;
  defaultWorkArticleId: string;
};

type RateKey = keyof RateDraft & string;

/**
 * Org-level default Travel/Work billing rate settings (issue #109 acceptance
 * criterion 4) — layer 3 of `resolve_billing_rate`'s 4-layer precedence
 * (client override -> engineer override -> ORG DEFAULT -> unresolved), on the
 * web design system (issue #222): a pair of cards (Travel time, Work time),
 * each with the article picker and the picked article's own sale and purchase
 * price as grey derived values (the sale price always mirrors the article and
 * can't be overridden here). One Edit button in the header.
 */
export function OrganizationDefaultRateForm({ initial, articles, canWrite }: OrganizationDefaultRateFormProps) {
  const record = useMemo<RateDraft>(
    () => ({
      defaultTravelArticleId: initial.defaultTravelArticleId ?? "",
      defaultWorkArticleId: initial.defaultWorkArticleId ?? "",
    }),
    [initial.defaultTravelArticleId, initial.defaultWorkArticleId],
  );

  const schema = useMemo<EditSchema<RateDraft>>(() => {
    const labelFor = (id: string) => {
      const article = articles.find((candidate) => candidate.id === id);
      return article ? `${article.article_number} — ${article.description}` : "";
    };
    return {
      defaultTravelArticleId: { label: "Travel time article", format: (value) => (value ? labelFor(value) : "") },
      defaultWorkArticleId: { label: "Work time article", format: (value) => (value ? labelFor(value) : "") },
    };
  }, [articles]);

  const edit = useSettingsEdit<RateDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: "default-rates",
    firstFieldKey: "defaultTravelArticleId",
    onSave: async (draft): Promise<SaveResult<RateDraft>> => {
      const result = await updateOrganizationDefaultRateSettings({
        defaultTravelArticleId: draft.defaultTravelArticleId || null,
        defaultWorkArticleId: draft.defaultWorkArticleId || null,
      });
      if (result.error || !result.data) {
        return {
          ok: false,
          error: result.error ?? "Could not save default rates",
          fieldErrors: firstFieldErrors<RateKey>(result.fieldErrors),
        };
      }
      return { ok: true };
    },
  });

  function optionsFor(savedId: string, draftId: string): KvOption[] {
    const options: KvOption[] = articles.map((article) => ({
      value: article.id,
      label: `${article.article_number} — ${article.description}`,
    }));
    // A saved article that is no longer in the active list must stay visible
    // (otherwise saving would silently clear it).
    for (const id of [savedId, draftId]) {
      if (id && !options.some((option) => option.value === id)) {
        options.push({ value: id, label: "Current article (not in the active list)" });
      }
    }
    return options;
  }

  function fieldsFor(kind: "travel" | "work", key: RateKey): KvField[] {
    const savedId = edit.record[key];
    const pickedSaved = articles.find((article) => article.id === savedId) ?? null;
    const pickedShown = articles.find((article) => article.id === (edit.isEditing ? edit.draft[key] : savedId)) ?? null;
    return [
      {
        key,
        label: "Article",
        kind: "select",
        read: savedId ? (pickedSaved ? `${pickedSaved.article_number} — ${pickedSaved.description}` : "Current article") : "",
        options: optionsFor(savedId, edit.draft[key]),
        emptyLabel: "Not set",
      },
      {
        key: `${key}-sale`,
        label: "Current sale price",
        kind: "derived",
        read: pickedShown ? formatCurrency(pickedShown.sale_price) : "",
        note: `Mirrors the ${kind} article`,
      },
      {
        key: `${key}-purchase`,
        label: "Purchase price",
        kind: "derived",
        read: pickedShown ? formatCurrency(pickedShown.purchase_price) : "",
      },
    ];
  }

  return (
    <SettingsFormPage
      navKey="default_rates"
      edit={edit}
      readOnlyNote="Only the organization owner can change these defaults."
    >
      <WebCardPair>
        <KeyValueCard title="Travel time" edit={edit} fields={fieldsFor("travel", "defaultTravelArticleId")} />
        <KeyValueCard title="Work time" edit={edit} fields={fieldsFor("work", "defaultWorkArticleId")} />
      </WebCardPair>
      <WebHint>
        Fallback Travel-time and Work-time billing articles, used whenever a client or engineer has no custom rate of
        their own (Settings, Team, or a client&rsquo;s own page). The sale price always mirrors the picked article and
        can&rsquo;t be overridden here.
      </WebHint>
    </SettingsFormPage>
  );
}
