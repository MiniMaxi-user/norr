"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { workReceiptEmailSettingsSchema } from "@/app/(app)/work-orders/work-receipt-email-schema";

/**
 * Per-tenant work receipt e-mail settings (issue #226): one
 * `work_receipt_email_settings` row per organization. Same boundary as the
 * invoice e-mail settings (owner / administratie, checked through the
 * `invoicing` permission row: `read` to load, `create` to save), but the
 * entitlement is the `planning` feature (work orders), not `invoicing`.
 * Placeholders and defaults live in `work-orders/work-receipt-email-schema.ts`.
 */

export interface WorkReceiptEmailSettings {
  fromEmail: string | null;
  fromName: string | null;
  ccEmail: string | null;
  /** null = the default subject template applies. */
  subjectTemplate: string | null;
  /** null = the default body template applies. */
  bodyTemplate: string | null;
  /** E-mail work receipts at all (default true). */
  emailWorkReceipts: boolean;
  /** E-mail the latest work receipt automatically when a work order is completed (default false). */
  autoSendOnCompleted: boolean;
}

interface SettingsRow {
  from_email: string | null;
  from_name: string | null;
  cc_email: string | null;
  subject_template: string | null;
  body_template: string | null;
  email_work_receipts: boolean | null;
  auto_send_on_completed: boolean | null;
}

const SETTINGS_COLUMNS = "from_email, from_name, cc_email, subject_template, body_template, email_work_receipts, auto_send_on_completed";

function toSettings(row: SettingsRow | null): WorkReceiptEmailSettings {
  return {
    fromEmail: row?.from_email ?? null,
    fromName: row?.from_name ?? null,
    ccEmail: row?.cc_email ?? null,
    subjectTemplate: row?.subject_template ?? null,
    bodyTemplate: row?.body_template ?? null,
    emailWorkReceipts: row?.email_work_receipts ?? true,
    autoSendOnCompleted: row?.auto_send_on_completed ?? false,
  };
}

export async function getWorkReceiptEmailSettings(): Promise<
  ActionResult<{ settings: WorkReceiptEmailSettings; canWrite: boolean }>
> {
  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "invoicing", "read")) {
    return fail("You do not have permission to view work receipt e-mail settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_receipt_email_settings")
    .select(SETTINGS_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle<SettingsRow>();
  if (error) return fail(mapDbError(error));
  return ok({ settings: toSettings(data), canWrite: can(actor, "invoicing", "create") });
}

/** Saves (insert or update) the whole settings form; blank fields clear the
 * stored value. */
export async function updateWorkReceiptEmailSettings(
  input: unknown,
): Promise<ActionResult<{ settings: WorkReceiptEmailSettings }>> {
  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner or administratie member can change work receipt e-mail settings.");
  }

  const parsed = workReceiptEmailSettingsSchema.safeParse(input);
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
    ...(v.emailWorkReceipts !== undefined ? { email_work_receipts: v.emailWorkReceipts } : {}),
    ...(v.autoSendOnCompleted !== undefined ? { auto_send_on_completed: v.autoSendOnCompleted } : {}),
  };

  const supabase = await createSupabaseServerClient();
  // Select-then-write rather than upsert: organization_id is insert-only (not
  // in the UPDATE column grant), which an ON CONFLICT DO UPDATE would touch.
  const { data: existing, error: lookupError } = await supabase
    .from("work_receipt_email_settings")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (lookupError) return fail(mapDbError(lookupError));

  const { data, error } = existing
    ? await supabase
        .from("work_receipt_email_settings")
        .update(values)
        .eq("organization_id", organizationId)
        .select(SETTINGS_COLUMNS)
        .maybeSingle<SettingsRow>()
    : await supabase
        .from("work_receipt_email_settings")
        .insert({ organization_id: organizationId, ...values })
        .select(SETTINGS_COLUMNS)
        .maybeSingle<SettingsRow>();

  if (error) return fail(error.code === "23514" ? "Enter valid e-mail addresses." : mapDbError(error));
  if (!data) return fail("Could not save the settings, or you do not have permission.");
  return ok({ settings: toSettings(data) });
}
