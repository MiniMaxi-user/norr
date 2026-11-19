"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";

/**
 * Per-tenant invoicing settings (issue #232): one `invoice_settings` row per
 * organization; no row = defaults. Today only the default payment term, which
 * `create_invoice` uses when the client has no own term
 * (`clients.payment_term_days`). Same boundary as invoicing itself (owner /
 * finance / administratie): `read` to load, `create` to save.
 */

// Not exported: a "use server" file may only export async functions.
const DEFAULT_PAYMENT_TERM_DAYS = 30;

export interface InvoiceSettings {
  paymentTermDays: number;
}

const invoiceSettingsSchema = z.object({
  paymentTermDays: z.coerce
    .number({ invalid_type_error: "Enter the payment term as a whole number of days." })
    .int("Enter the payment term as a whole number of days.")
    .min(0, "The payment term cannot be negative: enter 0 (pay immediately) or more.")
    .max(365, "The payment term can be at most 365 days."),
});

export async function getInvoiceSettings(): Promise<ActionResult<{ settings: InvoiceSettings }>> {
  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "invoicing", "read")) {
    return fail("You do not have permission to view invoicing settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoice_settings")
    .select("payment_term_days")
    .eq("organization_id", ctx.context.organizationId)
    .maybeSingle<{ payment_term_days: number }>();
  if (error) return fail(mapDbError(error));
  return ok({ settings: { paymentTermDays: data?.payment_term_days ?? DEFAULT_PAYMENT_TERM_DAYS } });
}

export async function saveInvoiceSettings(input: unknown): Promise<ActionResult<{ settings: InvoiceSettings }>> {
  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner, finance or administratie member can change invoicing settings.");
  }

  const parsed = invoiceSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }
  const values = { payment_term_days: parsed.data.paymentTermDays };

  const supabase = await createSupabaseServerClient();
  // Select-then-write rather than upsert: organization_id is insert-only (not
  // in the UPDATE column grant), which an ON CONFLICT DO UPDATE would touch.
  const { data: existing, error: lookupError } = await supabase
    .from("invoice_settings")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (lookupError) return fail(mapDbError(lookupError));

  const { data, error } = existing
    ? await supabase
        .from("invoice_settings")
        .update(values)
        .eq("organization_id", organizationId)
        .select("payment_term_days")
        .maybeSingle<{ payment_term_days: number }>()
    : await supabase
        .from("invoice_settings")
        .insert({ organization_id: organizationId, ...values })
        .select("payment_term_days")
        .maybeSingle<{ payment_term_days: number }>();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Could not save the settings, or you do not have permission.");
  return ok({ settings: { paymentTermDays: data.payment_term_days } });
}
