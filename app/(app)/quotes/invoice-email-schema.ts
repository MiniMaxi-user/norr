import { z } from "zod";

/**
 * Per-tenant invoice e-mail configuration (issue #211): Zod schema, template
 * placeholders and defaults. Deliberately NOT a "use server" file (Server
 * Action files may only export async functions) so both the actions and the
 * settings UI can import these constants.
 */

/** Placeholders usable in the subject/body templates — the UI can list these. */
export const INVOICE_EMAIL_PLACEHOLDERS = [
  { key: "invoice_number", token: "{{invoice_number}}", description: "The invoice number" },
  { key: "client_name", token: "{{client_name}}", description: "Name of the client being invoiced" },
  { key: "quote_name", token: "{{quote_name}}", description: "Name of the invoiced quote" },
  { key: "total", token: "{{total}}", description: "Invoice total incl. VAT, formatted (e.g. EUR 1,234.50)" },
  { key: "due_date", token: "{{due_date}}", description: "Payment due date" },
  { key: "organization_name", token: "{{organization_name}}", description: "Your organization's name" },
] as const;

export type InvoiceEmailPlaceholderKey = (typeof INVOICE_EMAIL_PLACEHOLDERS)[number]["key"];

export const DEFAULT_INVOICE_EMAIL_SUBJECT = "Invoice {{invoice_number}} from {{organization_name}}";

export const DEFAULT_INVOICE_EMAIL_BODY = [
  "Dear {{client_name}},",
  "",
  "Please find attached invoice {{invoice_number}} ({{quote_name}}) for {{total}}.",
  "Kindly pay the amount before {{due_date}}.",
  "",
  "Kind regards,",
  "{{organization_name}}",
].join("\n");

/** Replaces `{{key}}` tokens; unknown tokens are left untouched. */
export function renderInvoiceEmailTemplate(
  template: string,
  values: Record<InvoiceEmailPlaceholderKey, string>,
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key as InvoiceEmailPlaceholderKey] : match,
  );
}

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalEmail = (message: string) =>
  z.preprocess(emptyToUndefined, z.string().trim().email(message).max(254).optional());

export const invoiceEmailSettingsSchema = z.object({
  fromEmail: optionalEmail("Enter a valid sender e-mail address."),
  fromName: z.preprocess(emptyToUndefined, z.string().trim().max(120, "Sender name is too long.").optional()),
  ccEmail: optionalEmail("Enter a valid CC e-mail address."),
  subjectTemplate: z.preprocess(emptyToUndefined, z.string().trim().max(300, "Subject is too long.").optional()),
  bodyTemplate: z.preprocess(emptyToUndefined, z.string().max(5000, "Body is too long.").optional()),
});

export type InvoiceEmailSettingsInput = z.infer<typeof invoiceEmailSettingsSchema>;
