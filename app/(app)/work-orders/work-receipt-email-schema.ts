import { z } from "zod";

/**
 * Per-tenant work receipt e-mail configuration (issue #226): Zod schema,
 * template placeholders and defaults. Mirrors
 * `app/(app)/quotes/invoice-email-schema.ts`. Deliberately NOT a "use server"
 * file (Server Action files may only export async functions) so both the
 * actions and the settings UI can import these constants.
 */

/** Placeholders usable in the subject/body templates - the UI can list these. */
export const WORK_RECEIPT_EMAIL_PLACEHOLDERS = [
  { key: "receipt_number", token: "{{receipt_number}}", description: "The work receipt number" },
  { key: "work_order_number", token: "{{work_order_number}}", description: "The work order number" },
  { key: "client_name", token: "{{client_name}}", description: "Name of the client" },
  { key: "site_address", token: "{{site_address}}", description: "Address of the site where the work was done" },
  { key: "asset_name", token: "{{asset_name}}", description: "Name of the asset the work was done on" },
  { key: "completed_date", token: "{{completed_date}}", description: "Date the work was completed" },
  { key: "organization_name", token: "{{organization_name}}", description: "Your organization's name" },
] as const;

export type WorkReceiptEmailPlaceholderKey = (typeof WORK_RECEIPT_EMAIL_PLACEHOLDERS)[number]["key"];

export const DEFAULT_WORK_RECEIPT_EMAIL_SUBJECT = "Work receipt {{receipt_number}} from {{organization_name}}";

export const DEFAULT_WORK_RECEIPT_EMAIL_BODY = [
  "Dear {{client_name}},",
  "",
  "Please find attached work receipt {{receipt_number}} for work order {{work_order_number}}, completed on {{completed_date}}.",
  "",
  "Kind regards,",
  "{{organization_name}}",
].join("\n");

/** Replaces `{{key}}` tokens; unknown tokens are left untouched. */
export function renderWorkReceiptEmailTemplate(
  template: string,
  values: Record<WorkReceiptEmailPlaceholderKey, string>,
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key as WorkReceiptEmailPlaceholderKey] : match,
  );
}

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalEmail = (message: string) =>
  z.preprocess(emptyToUndefined, z.string().trim().email(message).max(254).optional());

export const workReceiptEmailSettingsSchema = z.object({
  fromEmail: optionalEmail("Enter a valid sender e-mail address."),
  fromName: z.preprocess(emptyToUndefined, z.string().trim().max(120, "Sender name is too long.").optional()),
  ccEmail: optionalEmail("Enter a valid CC e-mail address."),
  subjectTemplate: z.preprocess(emptyToUndefined, z.string().trim().max(300, "Subject is too long.").optional()),
  bodyTemplate: z.preprocess(emptyToUndefined, z.string().max(5000, "Body is too long.").optional()),
  /** E-mail work receipts at all. Omitted = unchanged / default true. */
  emailWorkReceipts: z.boolean({ invalid_type_error: "Invalid value." }).optional(),
  /** E-mail the latest work receipt automatically when a work order is completed (#273). Omitted = unchanged / default false. */
  autoSendOnCompleted: z.boolean({ invalid_type_error: "Invalid value." }).optional(),
});

export type WorkReceiptEmailSettingsInput = z.infer<typeof workReceiptEmailSettingsSchema>;
