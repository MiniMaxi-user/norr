"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { contractNumberingSettingsSchema } from "./schema";

/**
 * Per-tenant contract numbering settings (issue #216): prefix + next number
 * of the `contract_number_sequences` row, read/written only through the
 * `get_/update_contract_numbering_settings` RPCs (owner + administratie,
 * enforced in the DB as well). Gated on the `contracts` feature flag and the
 * `contract_numbering` RBAC module.
 */

export interface ContractNumberingSettings {
  prefix: string;
  nextNumber: number;
}

interface SettingsRow {
  prefix: string;
  next_number: number;
}

function toSettings(row: SettingsRow): ContractNumberingSettings {
  return { prefix: row.prefix, nextNumber: row.next_number };
}

/** Loads the current settings. Throws (error boundary) when the caller is not
 * entitled or the lookup fails - pages already gate with `notFound()` first. */
export async function getContractNumberingSettings(): Promise<ContractNumberingSettings> {
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) throw new Error(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "contract_numbering", "read")) {
    throw new Error("You do not have permission to view contract numbering settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_contract_numbering_settings", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(mapDbError(error));
  const row = (Array.isArray(data) ? data[0] : data) as SettingsRow | undefined;
  if (!row) throw new Error("Contract numbering settings not found.");
  return toSettings(row);
}

export async function updateContractNumberingSettings(
  input: unknown,
): Promise<ActionResult<{ settings: ContractNumberingSettings }>> {
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "contract_numbering", "update")) {
    return fail("Only an owner or administratie member can change contract numbering.");
  }

  const parsed = contractNumberingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_contract_numbering_settings", {
    p_organization_id: organizationId,
    p_prefix: parsed.data.prefix,
    p_next_number: parsed.data.nextNumber,
  });

  if (error) {
    if (error.code === "42501") {
      return fail("You do not have permission to change contract numbering.");
    }
    if (error.code === "23514") {
      const message = error.message ?? "";
      if (message.includes("can only be raised")) {
        const current = message.match(/current: (\d+)/)?.[1];
        // The RPC reports the current number; the prefix is read separately
        // so the message can show a full example number.
        const { data: currentData } = await supabase.rpc("get_contract_numbering_settings", {
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
        return fail("Prefix must be 1-10 characters: letters A-Z and digits 0-9 only.", {
          prefix: ["Invalid prefix."],
        });
      }
      return fail("The next number must be a positive whole number.", { nextNumber: ["Invalid number."] });
    }
    return fail(mapDbError(error));
  }

  const row = (Array.isArray(data) ? data[0] : data) as SettingsRow | undefined;
  if (!row) return fail("Contract numbering settings could not be saved.");

  revalidatePath("/settings/contract-numbering");
  return ok({ settings: toSettings(row) });
}
