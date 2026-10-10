"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { invoiceEmailSettingsSchema } from "./invoice-email-schema";

/**
 * Per-tenant invoice e-mail settings (issue #211): one `invoice_email_settings`
 * row per organization. Same boundary as invoicing itself (owner /
 * administratie): `read` to load, `create` to save. Placeholders and defaults
 * live in `./invoice-email-schema.ts` (`INVOICE_EMAIL_PLACEHOLDERS`,
 * `DEFAULT_INVOICE_EMAIL_SUBJECT`, `DEFAULT_INVOICE_EMAIL_BODY`).
 */

export interface InvoiceEmailSettings {
  fromEmail: string | null;
  fromName: string | null;
  ccEmail: string | null;
  /** null = the default subject template applies. */
  subjectTemplate: string | null;
  /** null = the default body template applies. */
  bodyTemplate: string | null;
}

interface SettingsRow {
  from_email: string | null;
  from_name: string | null;
  cc_email: string | null;
  subject_template: string | null;
  body_template: string | null;
}

const SETTINGS_COLUMNS = "from_email, from_name, cc_email, subject_template, body_template";

function toSettings(row: SettingsRow | null): InvoiceEmailSettings {
  return {
    fromEmail: row?.from_email ?? null,
    fromName: row?.from_name ?? null,
    ccEmail: row?.cc_email ?? null,
    subjectTemplate: row?.subject_template ?? null,
    bodyTemplate: row?.body_template ?? null,
  };
}

export async function getInvoiceEmailSettings(): Promise<ActionResult<{ settings: InvoiceEmailSettings }>> {
  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "invoicing", "read")) {
    return fail("You do not have permission to view invoice e-mail settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoice_email_settings")
    .select(SETTINGS_COLUMNS)
    .eq("organization_id", ctx.context.organizationId)
    .maybeSingle<SettingsRow>();
  if (error) return fail(mapDbError(error));
  return ok({ settings: toSettings(data) });
}

/** Saves (insert or update) the whole settings form; blank fields clear the
 * stored value. */
export async function saveInvoiceEmailSettings(
  input: unknown,
): Promise<ActionResult<{ settings: InvoiceEmailSettings }>> {
  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner or administratie member can change invoice e-mail settings.");
  }

  const parsed = invoiceEmailSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }
  const v = parsed.data;
  const values = {
    from_email: v.fromEmail ?? null,
    from_name: v.fromName ?? null,
    cc_email: v.ccEmail ?? null,
    subject_template: v.subjectTemplate ?? null,
    body_template: v.bodyTemplate ?? null,
  };

  const supabase = await createSupabaseServerClient();
  // Select-then-write rather than upsert: organization_id is insert-only (not
  // in the UPDATE column grant), which an ON CONFLICT DO UPDATE would touch.
  const { data: existing, error: lookupError } = await supabase
    .from("invoice_email_settings")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (lookupError) return fail(mapDbError(lookupError));

  const { data, error } = existing
    ? await supabase
        .from("invoice_email_settings")
        .update(values)
        .eq("organization_id", organizationId)
        .select(SETTINGS_COLUMNS)
        .maybeSingle<SettingsRow>()
    : await supabase
        .from("invoice_email_settings")
        .insert({ organization_id: organizationId, ...values })
        .select(SETTINGS_COLUMNS)
        .maybeSingle<SettingsRow>();

  if (error) return fail(error.code === "23514" ? "Enter valid e-mail addresses." : mapDbError(error));
  if (!data) return fail("Could not save the settings, or you do not have permission.");
  return ok({ settings: toSettings(data) });
}
