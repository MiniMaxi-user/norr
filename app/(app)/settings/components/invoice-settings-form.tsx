"use client";

import { useMemo } from "react";
import { WebHint } from "@yourorg/ui/web";
import { KeyValueCard, type EditSchema, type KvField, type SaveResult } from "@yourorg/ui/web-client";
import { saveInvoiceSettings, type InvoiceSettings } from "@/app/(app)/quotes/invoice-settings-actions";
import { SettingsFormPage, useSettingsEdit } from "./settings-form-page";

export interface InvoiceSettingsFormProps {
  initial: InvoiceSettings;
  /** `can(actor, "invoicing", "create")` (owner / administratie). */
  canWrite: boolean;
}

type InvoiceSettingsDraft = {
  paymentTermDays: string;
};

function validatePaymentTerm(value: string): string | null {
  const text = value.trim();
  if (!text) return "Enter a payment term in days, for example 30";
  if (!/^\d+$/.test(text)) return "Enter the payment term as a whole number of days, for example 30";
  if (Number(text) > 365) return "The payment term can be at most 365 days";
  return null;
}

function termText(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (text === "0") return "Immediately (0 days)";
  return `${text} ${text === "1" ? "day" : "days"}`;
}

/**
 * Settings → Billing → Invoicing (issue #232): the organization's default
 * payment term. Every new invoice stores its own term and due date at
 * invoicing time (client term if set, else this one), so changing it never
 * touches existing invoices.
 */
export function InvoiceSettingsForm({ initial, canWrite }: InvoiceSettingsFormProps) {
  const record = useMemo<InvoiceSettingsDraft>(() => ({ paymentTermDays: String(initial.paymentTermDays) }), [initial]);

  const schema = useMemo<EditSchema<InvoiceSettingsDraft>>(
    () => ({
      paymentTermDays: { label: "Payment term", required: true, validate: validatePaymentTerm, format: termText },
    }),
    [],
  );

  const edit = useSettingsEdit<InvoiceSettingsDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: "invoice-settings",
    firstFieldKey: "paymentTermDays",
    onSave: async (draft): Promise<SaveResult<InvoiceSettingsDraft>> => {
      const result = await saveInvoiceSettings({ paymentTermDays: draft.paymentTermDays.trim() });
      if (result.error || !result.data) {
        const message = result.fieldErrors?.paymentTermDays?.[0];
        return {
          ok: false,
          error: result.error ?? "Could not save invoicing settings",
          fieldErrors: message ? { paymentTermDays: message } : {},
        };
      }
      return { ok: true };
    },
  });

  const fields: KvField[] = [
    {
      key: "paymentTermDays",
      label: "Default payment term (days)",
      kind: "number",
      read: termText(edit.record.paymentTermDays),
      placeholder: "30",
      min: "0",
      step: "1",
    },
  ];

  return (
    <SettingsFormPage
      navKey="invoicing"
      edit={edit}
      readOnlyNote="Only an owner or administratie member can change these settings."
    >
      <KeyValueCard title="Payment" edit={edit} fields={fields} />
      <WebHint>
        The due date of a new invoice is the invoice date plus this term. A client can have its own payment term (on the
        client page, Business details); that one wins. Each invoice keeps the term and due date it was created with, so
        changing this setting never changes existing invoices.
      </WebHint>
    </SettingsFormPage>
  );
}
