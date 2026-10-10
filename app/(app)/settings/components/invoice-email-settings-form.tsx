"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Callout, Card, FormGrid, Heading, Input, Label, Stack, Text, Textarea } from "@yourorg/ui";
import { Mail } from "@yourorg/ui/icons";
import { saveInvoiceEmailSettings, type InvoiceEmailSettings } from "@/app/(app)/quotes/invoice-email-settings-actions";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_INVOICE_EMAIL_SUBJECT,
  INVOICE_EMAIL_PLACEHOLDERS,
} from "@/app/(app)/quotes/invoice-email-schema";

export interface InvoiceEmailSettingsFormProps {
  initial: InvoiceEmailSettings;
  /** `can(actor, "invoicing", "create")` - a read-only caller sees the saved
   * values as text, no inputs ("hide, don't just disable"). */
  canWrite: boolean;
}

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  saved?: InvoiceEmailSettings;
}

const initialState: FormState = {};

/**
 * Invoice email settings form (issue #211): From email / From name / CC /
 * Subject / Body, with the defaults shown as placeholders (empty = default)
 * and a legend of the available `{{placeholders}}`. Same `useActionState` +
 * plain `<form action>` shape as `OrganizationTimeRoundingForm`.
 */
export function InvoiceEmailSettingsForm({ initial, canWrite }: InvoiceEmailSettingsFormProps) {
  async function action(_prev: FormState, formData: FormData): Promise<FormState> {
    const result = await saveInvoiceEmailSettings({
      fromEmail: String(formData.get("fromEmail") ?? ""),
      fromName: String(formData.get("fromName") ?? ""),
      ccEmail: String(formData.get("ccEmail") ?? ""),
      subjectTemplate: String(formData.get("subjectTemplate") ?? ""),
      bodyTemplate: String(formData.get("bodyTemplate") ?? ""),
    });
    if (!result.data) {
      return { error: result.error ?? "Could not save invoice email settings.", fieldErrors: result.fieldErrors };
    }
    return { success: true, saved: result.data.settings };
  }

  const [state, formAction] = useActionState(action, initialState);
  const current = state.saved ?? initial;

  const legend = (
    <Stack gap="xs">
      <Heading level={6}>Available placeholders</Heading>
      {INVOICE_EMAIL_PLACEHOLDERS.map((placeholder) => (
        <Text key={placeholder.key} tone="muted">
          <code>{placeholder.token}</code> - {placeholder.description}
        </Text>
      ))}
    </Stack>
  );

  if (!canWrite) {
    return (
      <Card>
        <Stack gap="md">
          <FormGrid columns={2}>
            <ReadOnlyValue label="From email" value={current.fromEmail} />
            <ReadOnlyValue label="From name" value={current.fromName} />
            <ReadOnlyValue label="CC email" value={current.ccEmail} />
          </FormGrid>
          <ReadOnlyValue label="Subject" value={current.subjectTemplate} fallback={DEFAULT_INVOICE_EMAIL_SUBJECT} />
          <ReadOnlyValue label="Body" value={current.bodyTemplate} fallback={DEFAULT_INVOICE_EMAIL_BODY} />
          {legend}
          <Text tone="muted">Only an owner or administratie member can change these settings.</Text>
        </Stack>
      </Card>
    );
  }

  const errors = state.fieldErrors ?? {};

  return (
    <Card>
      {/* Remounted after a successful save so the inputs show the stored values. */}
      <form action={formAction} key={state.saved ? "saved" : "initial"}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}
          {state.success && <Text tone="success">Invoice email settings saved.</Text>}

          <Callout icon={Mail}>
            The sender domain must be verified with your email provider, otherwise invoice emails will fail to
            send. A From email is required before invoices can be emailed.
          </Callout>

          <FormGrid columns={2}>
            <Field id="invoice-email-from-email" label="From email" errors={errors.fromEmail}>
              <Input
                id="invoice-email-from-email"
                name="fromEmail"
                type="email"
                defaultValue={current.fromEmail ?? ""}
                placeholder="invoices@yourcompany.com"
              />
            </Field>
            <Field id="invoice-email-from-name" label="From name" errors={errors.fromName}>
              <Input
                id="invoice-email-from-name"
                name="fromName"
                defaultValue={current.fromName ?? ""}
                placeholder="Your organization's name"
              />
            </Field>
            <Field id="invoice-email-cc" label="CC email" errors={errors.ccEmail}>
              <Input
                id="invoice-email-cc"
                name="ccEmail"
                type="email"
                defaultValue={current.ccEmail ?? ""}
                placeholder="administration@yourcompany.com"
              />
            </Field>
          </FormGrid>

          <Field id="invoice-email-subject" label="Subject" errors={errors.subjectTemplate}>
            <Input
              id="invoice-email-subject"
              name="subjectTemplate"
              defaultValue={current.subjectTemplate ?? ""}
              placeholder={DEFAULT_INVOICE_EMAIL_SUBJECT}
            />
          </Field>

          <Field id="invoice-email-body" label="Body" errors={errors.bodyTemplate}>
            <Textarea
              id="invoice-email-body"
              name="bodyTemplate"
              rows={9}
              defaultValue={current.bodyTemplate ?? ""}
              placeholder={DEFAULT_INVOICE_EMAIL_BODY}
            />
          </Field>

          {legend}

          <div>
            <SubmitButton />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function Field({
  id,
  label,
  errors,
  children,
}: {
  id: string;
  label: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <Stack gap="xs">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {errors?.map((message) => (
        <Text key={message} tone="danger">
          {message}
        </Text>
      ))}
    </Stack>
  );
}

function ReadOnlyValue({ label, value, fallback }: { label: string; value: string | null; fallback?: string }) {
  return (
    <Stack gap="xs">
      <Label>{label}</Label>
      {value ? (
        <Text>{value}</Text>
      ) : (
        <Text tone="muted">
          {fallback ? `Default: ${fallback}` : "Not set"}
        </Text>
      )}
    </Stack>
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
