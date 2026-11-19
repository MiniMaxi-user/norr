"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { hasFeature } from "@/lib/rbac/features";
import { mapVolumeReadingError } from "@/lib/asset-volumes/errors";
import { isWorkOrderCheckedOutInField } from "./checkout-lock";

/**
 * The fixed, non-editable "Volumes" checklist of a work order (issues #230,
 * #221, #225): one row per counter configured on the work order's asset
 * model, showing the value registered ON this work order. Runs under the
 * caller's own session (RLS scopes the rows); rides on the `planning`
 * module's read/read_own for the work order AND the `asset_volumes` read
 * permission. The `assets` entitlement is enforced here too (and by the page).
 *
 * Editing replaces this work order's reading for the counter (atomic RPC,
 * readings are immutable) — see `saveWorkOrderVolumeValue`.
 */

export type VolumeReviewReason = "below_previous" | "above_next";

export interface WorkOrderVolumeRow {
  volumeItemId: string;
  label: string;
  unitLabel: string | null;
  /** The latest reading registered on THIS work order, if any. */
  readingId: string | null;
  value: number | null;
  readAt: string | null;
  enteredByName: string | null;
  needsReview: boolean;
  reviewReason: VolumeReviewReason | null;
  /** The reading before this one (or the latest one when none is registered here). */
  previousValue: number | null;
  previousReadAt: string | null;
}

export interface WorkOrderVolumeChecklist {
  assetId: string;
  rows: WorkOrderVolumeRow[];
}

const uuidSchema = z.string().uuid("Invalid id.");

interface ReadingRow {
  id: string;
  volume_item_id: string;
  value: number | string;
  read_at: string;
  needs_review: boolean;
  review_reason: VolumeReviewReason | null;
  creator: { email: string; full_name: string | null } | null;
}

/** `data: null` = the work order has no asset, or its model has no counters. */
export async function getWorkOrderVolumeChecklist(
  workOrderId: string,
): Promise<ActionResult<WorkOrderVolumeChecklist | null>> {
  if (!uuidSchema.safeParse(workOrderId).success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, session } = ctx.context;
  if (!session.organization || !(await hasFeature(session.organization, "assets"))) {
    return fail("This module is not enabled for your organization.");
  }
  if (!canAny(actor, "planning", ["read", "read_own"])) return fail("You do not have permission to view volumes.");
  if (!can(actor, "asset_volumes", "read")) return fail("You do not have permission to view volumes.");

  const supabase = await createSupabaseServerClient();

  const { data: wo, error: woError } = await supabase
    .from("work_orders")
    .select("asset_id, asset:assets(model_id)")
    .eq("id", workOrderId)
    .maybeSingle();
  if (woError) return fail(mapDbError(woError));
  const woRow = wo as { asset_id: string | null; asset: { model_id: string | null } | null } | null;
  const assetId = woRow?.asset_id ?? null;
  const modelId = woRow?.asset?.model_id ?? null;
  if (!assetId || !modelId) return ok(null);

  const { data: counters, error: countersError } = await supabase
    .from("asset_model_volumes")
    .select("volume_item_id, sort_order")
    .eq("asset_model_id", modelId)
    .order("sort_order", { ascending: true });
  if (countersError) return fail(mapDbError(countersError));
  if (!counters || counters.length === 0) return ok(null);
  const counterIds = counters.map((c) => c.volume_item_id as string);

  const [readingsResult, itemsResult] = await Promise.all([
    supabase
      .from("asset_volume_readings")
      .select(
        "id, volume_item_id, value, read_at, needs_review, review_reason, creator:users!asset_volume_readings_created_by_fkey(email, full_name)",
      )
      .eq("work_order_id", workOrderId)
      .in("volume_item_id", counterIds)
      .order("read_at", { ascending: false })
      .returns<ReadingRow[]>(),
    supabase.from("reference_list_items").select("id, label, parent_item_id").in("id", counterIds),
  ]);
  if (readingsResult.error) return fail(mapDbError(readingsResult.error));
  if (itemsResult.error) return fail(mapDbError(itemsResult.error));

  const parentIds = Array.from(
    new Set((itemsResult.data ?? []).map((i) => i.parent_item_id as string | null).filter((p): p is string => !!p)),
  );
  const unitById = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: units } = await supabase.from("reference_list_items").select("id, label").in("id", parentIds);
    for (const u of units ?? []) unitById.set(u.id as string, u.label as string);
  }
  const itemById = new Map<string, { label: string; unit: string | null }>();
  for (const i of itemsResult.data ?? []) {
    itemById.set(i.id as string, {
      label: i.label as string,
      unit: i.parent_item_id ? (unitById.get(i.parent_item_id as string) ?? null) : null,
    });
  }

  // Latest reading per counter on this work order (rows are read_at desc).
  const latestByCounter = new Map<string, ReadingRow>();
  for (const r of readingsResult.data ?? []) {
    if (!latestByCounter.has(r.volume_item_id)) latestByCounter.set(r.volume_item_id, r);
  }

  const rows = await Promise.all(
    counterIds.map(async (volumeItemId): Promise<WorkOrderVolumeRow> => {
      const item = itemById.get(volumeItemId);
      const reading = latestByCounter.get(volumeItemId) ?? null;

      // Previous reading hint: the nearest earlier reading of this asset +
      // counter, other than the one registered here.
      let query = supabase
        .from("asset_volume_readings")
        .select("id, value, read_at")
        .eq("asset_id", assetId)
        .eq("volume_item_id", volumeItemId)
        .order("read_at", { ascending: false })
        .limit(2);
      if (reading) query = query.lt("read_at", reading.read_at);
      const { data: prevRows } = await query;
      const prev = (prevRows ?? []).find((p) => p.id !== reading?.id) ?? null;

      return {
        volumeItemId,
        label: item?.label ?? "Counter",
        unitLabel: item?.unit ?? null,
        readingId: reading?.id ?? null,
        value: reading ? Number(reading.value) : null,
        readAt: reading?.read_at ?? null,
        enteredByName: reading?.creator ? reading.creator.full_name?.trim() || reading.creator.email : null,
        needsReview: reading?.needs_review ?? false,
        reviewReason: reading?.review_reason ?? null,
        previousValue: prev ? Number(prev.value) : null,
        previousReadAt: prev ? (prev.read_at as string) : null,
      };
    }),
  );

  return ok({ assetId, rows });
}

/** Strict whole-number parse: digits only (optional leading minus), no empty, whitespace, exponent or decimals. */
const wholeNumberSchema = z
  .union([z.string(), z.number()], { errorMap: () => ({ message: "Enter a whole number." }) })
  .transform((raw, ctx) => {
    if (typeof raw === "number") {
      if (Number.isSafeInteger(raw)) return raw;
    } else if (/^-?\d{1,15}$/.test(raw)) {
      return Number(raw);
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a whole number." });
    return z.NEVER;
  })
  .pipe(z.number().min(0, "Value cannot be negative.").max(999_999_999_999, "Value is too large."));

const saveSchema = z.object({
  workOrderId: uuidSchema,
  volumeItemId: uuidSchema,
  value: wholeNumberSchema,
});

/**
 * Autosave of one Volumes-checklist field: REPLACES this work order's
 * reading(s) for the counter with `value` through the atomic
 * `replace_work_order_volume_reading` RPC (keeping the replaced reading's
 * `read_at`, or now when none exists). Owner/planner only (`asset_volumes`
 * create AND delete); refused while the engineer is out in the field with the
 * work order (same lock as hours/material). The DB trigger keeps the value
 * consistent with neighbouring readings; its below-previous / above-next
 * errors come back as messages and leave the old reading untouched.
 */
export async function saveWorkOrderVolumeValue(input: unknown): Promise<ActionResult<{ readingId: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Enter a whole number.");
  }
  const { workOrderId, volumeItemId, value } = parsed.data;

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, session } = ctx.context;
  if (!session.organization || !(await hasFeature(session.organization, "assets"))) {
    return fail("This module is not enabled for your organization.");
  }
  if (!can(actor, "asset_volumes", "create")|| !can(actor, "asset_volumes", "delete")) {
    return fail("You do not have permission to change volumes.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: wo, error: woError } = await supabase
    .from("work_orders")
    .select("id, status_id, asset_id, asset:assets(model_id)")
    .eq("id", workOrderId)
    .maybeSingle();
  if (woError) return fail(mapDbError(woError));
  const woRow = wo as {
    id: string;
    status_id: string | null;
    asset_id: string | null;
    asset: { model_id: string | null } | null;
  } | null;
  if (!woRow) return fail("Work order not found.");
  if (!woRow.asset_id || !woRow.asset?.model_id) return fail("This work order has no asset with counters.");
  if (await isWorkOrderCheckedOutInField(woRow.status_id)) {
    return fail("This work order is checked out in the field; volumes are read-only until it comes back.");
  }

  const { data: configured, error: configuredError } = await supabase
    .from("asset_model_volumes")
    .select("volume_item_id")
    .eq("asset_model_id", woRow.asset.model_id)
    .eq("volume_item_id", volumeItemId)
    .maybeSingle();
  if (configuredError) return fail(mapDbError(configuredError));
  if (!configured) return fail("This counter is not configured on the asset's model.");

  // Keep the read_at of the reading being replaced (latest on this work order), else now.
  const { data: existing, error: existingError } = await supabase
    .from("asset_volume_readings")
    .select("read_at")
    .eq("work_order_id", workOrderId)
    .eq("volume_item_id", volumeItemId)
    .order("read_at", { ascending: false })
    .limit(1);
  if (existingError) return fail(mapDbError(existingError));
  const readAt = (existing?.[0]?.read_at as string | undefined) ?? new Date().toISOString();

  // Atomic delete + insert in one transaction (RLS and the monotonic trigger
  // apply as the caller); any error leaves the old reading untouched.
  const { data: inserted, error: replaceError } = await supabase.rpc("replace_work_order_volume_reading", {
    p_work_order_id: workOrderId,
    p_volume_item_id: volumeItemId,
    p_value: value,
    p_read_at: readAt,
  });

  if (replaceError || !inserted) {
    const friendly = replaceError ? mapVolumeReadingError(replaceError, value) : null;
    return fail(friendly ?? (replaceError ? mapDbError(replaceError) : "Could not save the value."));
  }

  revalidatePath(`/assets/${woRow.asset_id}`);
  revalidatePath(`/work-orders/${workOrderId}`);
  return ok({ readingId: (inserted as { id: string }).id });
}
