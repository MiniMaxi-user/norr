"use client";

import { useMemo } from "react";
import { WebHint } from "@yourorg/ui/web";
import { KeyValueCard, TextCard, type EditSchema, type SaveResult } from "@yourorg/ui/web-client";
import { saveInvoiceEmailSettings, type InvoiceEmailSettings } from "@/app/(app)/quotes/invoice-email-settings-actions";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_INVOICE_EMAIL_SUBJECT,
  INVOICE_EMAIL_PLACEHOLDERS,
} from "@/app/(app)/quotes/invoice-email-schema";
import { firstFieldErrors, SettingsFormPage, useSettingsEdit } from "./settings-form-page";

export interface InvoiceEmailSettingsFormProps {
  initial: InvoiceEmailSettings;
  /** `can(actor, "invoicing", "create")` - without it there is no Edit button. */
  canWrite: boolean;
}

type InvoiceEmailDraft = {
  fromEmail: string;
  fromName: string;
  ccEmail: string;
  subjectTemplate: string;
  bodyTemplate: string;
  attachUbl: boolean;
};

type InvoiceEmailKey = keyof InvoiceEmailDraft & string;

// Same shape check as the server's `z.string().email()` for a typical address.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(label: string, value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length > 254) return `${label} is too long: use at most 254 characters`;
  return EMAIL_PATTERN.test(text) ? null : `Enter a valid ${label.toLowerCase()} address, like invoices@yourcompany.com`;
}

function tooLong(label: string, value: string, max: number): string | null {
  const length = value.trim().length;
  return length > max ? `${label} is ${length} characters, the maximum is ${max}. Remove ${length - max}` : null;
}

function draftFrom(settings: InvoiceEmailSettings): InvoiceEmailDraft {
  return {
    fromEmail: settings.fromEmail ?? "",
    fromName: settings.fromName ?? "",
    ccEmail: settings.ccEmail ?? "",
    subjectTemplate: settings.subjectTemplate ?? "",
    bodyTemplate: settings.bodyTemplate ?? "",
    attachUbl: settings.attachUbl ?? true,
  };
}

/**
 * Invoice email settings (issues #210/#211) on the web design system (issue
 * #222): a Sender card (from email, from name, CC), a Message card (subject)
 * and a Body text card, plus a read-only placeholder legend. An empty subject
 * or body means the default template applies (shown as the placeholder and in
 * read mode); a blank sender field clears the stored value. One Edit button in
 * the header.
 */
export function InvoiceEmailSettingsForm({ initial, canWrite }: InvoiceEmailSettingsFormProps) {
  const record = useMemo<InvoiceEmailDraft>(
    () => draftFrom(initial),
    [initial],
  );

  const schema = useMemo<EditSchema<InvoiceEmailDraft>>(
    () => ({
      fromEmail: { label: "From email", validate: (value) => validateEmail("From email", value) },
      fromName: { label: "From name", validate: (value) => tooLong("From name", value, 120) },
      ccEmail: { label: "CC email", validate: (value) => validateEmail("CC email", value) },
      subjectTemplate: { label: "Subject", validate: (value) => tooLong("Subject", value, 300) },
      bodyTemplate: {
        label: "Body",
        // The server does not trim the body, so the limit counts raw characters.
        validate: (value) =>
          value.length > 5000 ? `Body is ${value.length} characters, the maximum is 5000. Remove ${value.length - 5000}` : null,
      },
      attachUbl: { label: "E-invoice (UBL)", format: (value) => (value ? "on" : "off") },
    }),
    [],
  );

  const edit = useSettingsEdit<InvoiceEmailDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: "invoice-email",
    firstFieldKey: "fromEmail",
    onSave: async (draft): Promise<SaveResult<InvoiceEmailDraft>> => {
      const result = await saveInvoiceEmailSettings({
        fromEmail: draft.fromEmail,
        fromName: draft.fromName,
        ccEmail: draft.ccEmail,
        subjectTemplate: draft.subjectTemplate,
        bodyTemplate: draft.bodyTemplate,
        attachUbl: draft.attachUbl,
      });
      if (!result.data) {
        return {
          ok: false,
          error: result.error ?? "Could not save invoice email settings",
          fieldErrors: firstFieldErrors<InvoiceEmailKey>(result.fieldErrors),
        };
      }
      return { ok: true };
    },
  });

  const saved = edit.record;

  return (
    <SettingsFormPage
      navKey="invoice_email"
      edit={edit}
      readOnlyNote="Only an owner or administratie member can change these settings."
    >
      <KeyValueCard
        title="Sender"
        edit={edit}
        fields={[
          {
            key: "fromEmail",
            label: "From email",
            read: saved.fromEmail,
            placeholder: "invoices@yourcompany.com",
            autoComplete: "off",
          },
          { key: "fromName", label: "From name", read: saved.fromName, placeholder: "Your organization's name", maxLength: 120 },
          { key: "ccEmail", label: "CC email", read: saved.ccEmail, placeholder: "administration@yourcompany.com" },
        ]}
      />
      <KeyValueCard
        title="Message"
        edit={edit}
        fields={[
          {
            key: "subjectTemplate",
            label: "Subject",
            read: saved.subjectTemplate.trim() ? saved.subjectTemplate : `Default: ${DEFAULT_INVOICE_EMAIL_SUBJECT}`,
            placeholder: DEFAULT_INVOICE_EMAIL_SUBJECT,
            maxLength: 300,
          },
        ]}
      />
      <KeyValueCard
        title="Attachments"
        edit={edit}
        fields={[
          {
            key: "attachUbl",
            label: "E-invoice (UBL)",
            kind: "checkbox",
            checkboxLabel: "Attach UBL e-invoice (XML)",
            read: saved.attachUbl ? "On" : "Off",
            note: "Only for clients with UBL e-invoicing switched on.",
          },
        ]}
      />
      <TextCard
        title="Body"
        fieldKey="bodyTemplate"
        text={saved.bodyTemplate}
        emptyText={`Default: ${DEFAULT_INVOICE_EMAIL_BODY}`}
        placeholder={DEFAULT_INVOICE_EMAIL_BODY}
        rows={9}
        edit={edit}
      />
      <KeyValueCard
        title="Available placeholders"
        fields={INVOICE_EMAIL_PLACEHOLDERS.map((placeholder) => ({
          key: placeholder.key,
          label: placeholder.token,
          read: placeholder.description,
        }))}
      />
      <WebHint>
        The sender domain must be verified with your email provider, otherwise invoice emails will fail to send. A From
        email is required before invoices can be emailed.
      </WebHint>
      <WebHint>
        How invoices are emailed to your clients&rsquo; invoice contact. Leave a field empty to use the default.
      </WebHint>
    </SettingsFormPage>
  );
}
