"use client";

import { useMemo } from "react";
import { WebCardPair, WebCardStack } from "@yourorg/ui/web";
import {
  KeyValueCard,
  TextCard,
  type EditModeApi,
  type KvEditBinder,
  type KvField,
} from "@yourorg/ui/web-client";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import { CLIENT_STATUS_OPTIONS } from "../kanban";
import type { ClientDraft } from "./client-draft";
import { articleOptionLabel } from "./client-form-schema";

export interface ClientOverviewCardsProps {
  /** The page's `useEditMode<ClientDraft>()` result. Read mode renders
   * `edit.record` (the saved values), edit/new mode the inputs. */
  edit: EditModeApi<ClientDraft>;
  accountManagers: AccountManagerRecord[];
  articles: ArticleSelectOption[];
  /** Derived, never editable here — they come from the client's primary site
   * (managed on the Sites tab). */
  derived: { address: string | null; phone: string | null };
  isNew: boolean;
}

/**
 * The Overview tab's cards, per the design system (docs 02): Business details
 * as ONE two-column card, Pipeline and Rate as a pair of separate cards, Notes
 * at the bottom. The SAME component renders read, edit and new mode — each row
 * shows the saved value or the matching input in the same place, so nothing
 * jumps when the mode changes. There are no per-card pencils: the single Edit
 * button lives in the page header.
 */
export function ClientOverviewCards({ edit, accountManagers, articles, derived, isNew }: ClientOverviewCardsProps) {
  const saved = edit.record;
  const managerName = useMemo(() => {
    const byId = new Map(
      accountManagers.map((manager) => [manager.id, `${manager.first_name} ${manager.last_name}`.trim()] as const),
    );
    return (id: string) => byId.get(id) ?? "";
  }, [accountManagers]);
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article] as const)), [articles]);
  const articleName = (id: string) => {
    const article = articleById.get(id);
    return article ? articleOptionLabel(article) : "";
  };

  // Picking a rate article pre-fills its sale price (existing behaviour of the
  // shared rate section) — wrap the binder rather than special-casing the card.
  const rateEdit = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key as keyof ClientDraft & string);
        const priceKey = key === "travelArticleId" ? "travelSalePrice" : key === "workArticleId" ? "workSalePrice" : null;
        if (!priceKey) return binding;
        return {
          ...binding,
          onChange: (value) => {
            binding.onChange(value);
            const sale = typeof value === "string" ? articleById.get(value)?.sale_price : null;
            edit.setValue(priceKey, sale !== null && sale !== undefined ? String(sale) : "");
          },
        };
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [articleById, edit],
  );

  const customRateOn = edit.isEditing ? Boolean(edit.draft.hasCustomRate) : saved.hasCustomRate;
  const rateDisabledNote = "Turn on custom rate first";

  const businessFields: KvField[] = [
    { key: "name", label: "Name", read: saved.name, placeholder: "e.g. Peeters Auto", autoComplete: "organization" },
    { key: "kvkNumber", label: "KvK number", read: saved.kvkNumber, mono: true, placeholder: "e.g. 12345678" },
    { key: "vatNumber", label: "VAT number", read: saved.vatNumber, mono: true, placeholder: "e.g. NL123456789B01" },
    { key: "iban", label: "IBAN", read: saved.iban, mono: true, placeholder: "e.g. NL91ABNA0417164300" },
    {
      key: "paymentTermDays",
      label: "Payment term (days)",
      kind: "number",
      read: saved.paymentTermDays ? `${saved.paymentTermDays} days` : "",
      placeholder: "Organization default",
      min: "0",
      step: "1",
    },
    {
      key: "address",
      label: "Address",
      kind: "derived",
      read: derived.address,
      note: isNew ? "Added under Sites after you create the client" : "Managed under Sites",
    },
    {
      key: "phone",
      label: "Phone",
      kind: "derived",
      read: derived.phone,
      note: isNew ? "Added under Sites after you create the client" : "Managed under Sites",
    },
  ];

  const statusLabel = (value: string) => CLIENT_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
  const pipelineFields: KvField[] = [
    {
      key: "status",
      label: "Status",
      kind: "select",
      read: statusLabel(saved.status),
      options: CLIENT_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      emptyLabel: "Select status…",
    },
    {
      key: "accountManagerId",
      label: "Account manager",
      kind: "select",
      read: saved.accountManagerId ? managerName(saved.accountManagerId) : null,
      options: accountManagers.map((manager) => ({
        value: manager.id,
        label: `${manager.first_name} ${manager.last_name}`.trim(),
      })),
      emptyLabel: "No account manager",
    },
    {
      key: "potentialValue",
      label: "Potential",
      kind: "money",
      read: saved.potentialValue ? formatMoneyWeb(Number(saved.potentialValue)) : null,
      placeholder: "e.g. 12500.00",
    },
    {
      key: "clientSince",
      label: "Client since",
      kind: "date",
      read: saved.clientSince ? formatDateWeb(saved.clientSince) : null,
    },
  ];

  const articleOptions = articles.map((article) => ({ value: article.id, label: articleOptionLabel(article) }));
  const rateFields: KvField[] = [
    {
      key: "hasCustomRate",
      label: "Custom rate",
      kind: "checkbox",
      checkboxLabel: "Use a custom rate for this client",
      read: saved.hasCustomRate ? "On" : "Off",
    },
    {
      key: "travelArticleId",
      label: "Travel article",
      kind: "select",
      read: saved.travelArticleId ? articleName(saved.travelArticleId) : null,
      options: articleOptions,
      emptyLabel: "Select an article…",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
    {
      key: "travelSalePrice",
      label: "Travel price",
      kind: "money",
      read: saved.travelSalePrice ? formatMoneyWeb(Number(saved.travelSalePrice)) : null,
      placeholder: "e.g. 85.00",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
    {
      key: "workArticleId",
      label: "Work article",
      kind: "select",
      read: saved.workArticleId ? articleName(saved.workArticleId) : null,
      options: articleOptions,
      emptyLabel: "Select an article…",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
    {
      key: "workSalePrice",
      label: "Work price",
      kind: "money",
      read: saved.workSalePrice ? formatMoneyWeb(Number(saved.workSalePrice)) : null,
      placeholder: "e.g. 95.00",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
  ];
  // Read mode: only show the article/price rows when a custom rate is on.
  const visibleRateFields = edit.isEditing || saved.hasCustomRate ? rateFields : rateFields.slice(0, 1);

  return (
    <WebCardStack>
      <KeyValueCard title="Business details" columns={2} split={3} fields={businessFields} edit={edit} />
      <WebCardPair>
        <KeyValueCard title="Pipeline" fields={pipelineFields} edit={edit} />
        <KeyValueCard title="Rate" fields={visibleRateFields} edit={rateEdit} />
      </WebCardPair>
      <TextCard
        title="Notes"
        fieldKey="notes"
        text={saved.notes}
        emptyText="No notes yet"
        placeholder="Anything worth knowing about this client"
        edit={edit}
      />
    </WebCardStack>
  );
}
