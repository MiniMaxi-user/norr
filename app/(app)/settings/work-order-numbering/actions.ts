"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { workOrderNumberingSettingsSchema } from "./schema";

/**
 * Per-tenant work order numbering settings (issue #218): prefix + next number
 * of the `work_order_number_sequences` row, read/written only through the
 * `get_/update_work_order_numbering_settings` RPCs (owner + administratie,
 * enforced in the DB as well). Gated on the `planning` feature flag and the
 * `work_order_numbering` RBAC module.
 */

export interface WorkOrderNumberingSettings {
  prefix: string;
  nextNumber: number;
}

interface SettingsRow {
  prefix: string;
  next_number: number;
}

function toSettings(row: SettingsRow): WorkOrderNumberingSettings {
  return { prefix: row.prefix, nextNumber: row.next_number };
}

/** Loads the current settings. Throws (error boundary) when the caller is not
 * entitled or the lookup fails - pages already gate with `notFound()` first. */
export async function getWorkOrderNumberingSettings(): Promise<WorkOrderNumberingSettings> {
  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) throw new Error(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "work_order_numbering", "read")) {
    throw new Error("You do not have permission to view work order numbering settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_work_order_numbering_settings", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(mapDbError(error));
  const row = (Array.isArray(data) ? data[0] : data) as SettingsRow | undefined;
  if (!row) throw new Error("Work order numbering settings not found.");
  return toSettings(row);
}

export async function updateWorkOrderNumberingSettings(
  input: unknown,
): Promise<ActionResult<{ settings: WorkOrderNumberingSettings }>> {
  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "work_order_numbering", "update")) {
    return fail("Only an owner or administratie member can change work order numbering.");
  }

  const parsed = workOrderNumberingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_work_order_numbering_settings", {
    p_organization_id: organizationId,
    p_prefix: parsed.data.prefix,
    p_next_number: parsed.data.nextNumber,
  });

  if (error) {
    if (error.code === "42501") {
      return fail("You do not have permission to change work order numbering.");
    }
    if (error.code === "23514") {
      const message = error.message ?? "";
      if (message.includes("can only be raised")) {
        const current = message.match(/current: (\d+)/)?.[1];
        // The RPC reports the current number; the prefix is read separately
        // so the message can show a full example number.
        const { data: currentData } = await supabase.rpc("get_work_order_numbering_settings", {
          p_organization_id: organizationId,
        });
        const currentRow = (Array.isArray(currentData) ? currentData[0] : currentData) as SettingsRow | undefined;
        const example = currentRow ? `${currentRow.prefix}${currentRow.next_number}` : current;
        return fail(
          `The next number can't be lower than the current one${example ? ` (${example})` : ""}.`,
          { nextNumber: ["Can't be lower than the current next number."] },
        );
      }
      const highest = message.match(/for prefix (\S+) \((\d+)\)/);
      if (highest) {
        return fail(
          `The next number must be higher than the highest existing number with this prefix (${highest[1]}${highest[2]}).`,
          { nextNumber: ["Must be higher than the highest existing number."] },
        );
      }
      if (message.includes("prefix")) {
        return fail("Prefix must be 1-10 characters: letters A-Z, digits 0-9 and - _ . / only.", {
          prefix: ["Invalid prefix."],
        });
      }
      return fail("The next number must be a positive whole number.", { nextNumber: ["Invalid number."] });
    }
    return fail(mapDbError(error));
  }

  const row = (Array.isArray(data) ? data[0] : data) as SettingsRow | undefined;
  if (!row) return fail("Work order numbering settings could not be saved.");

  revalidatePath("/settings/work-order-numbering");
  return ok({ settings: toSettings(row) });
}
