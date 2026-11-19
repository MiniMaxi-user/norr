"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";

/**
 * Read side of the meter readings registered ON a work order (issues #221,
 * #225). Runs under the caller's own session (RLS scopes the rows); rides on
 * the `planning` module's read/read_own for the work order AND the
 * `asset_volumes` read permission for the readings themselves. The `assets`
 * entitlement is enforced by the page (the tab does not exist otherwise).
 */

export type VolumeReviewReason = "below_previous" | "above_next";

export interface WorkOrderVolumeReadingRecord {
  id: string;
  counterLabel: string;
  unitLabel: string | null;
  value: number;
  readAt: string;
  enteredByName: string | null;
  notes: string | null;
  needsReview: boolean;
  reviewReason: VolumeReviewReason | null;
  /** Nearest earlier / later reading of the same asset + counter; only fetched for flagged readings. */
  previousValue: number | null;
  nextValue: number | null;
}

export interface WorkOrderVolumesData {
  readings: WorkOrderVolumeReadingRecord[];
  /** The work order's asset has counters configured on its model. */
  hasConfiguredCounters: boolean;
}

const uuidSchema = z.string().uuid("Invalid id.");

interface ReadingRow {
  id: string;
  asset_id: string;
  volume_item_id: string;
  value: number | string;
  read_at: string;
  notes: string | null;
  needs_review: boolean;
  review_reason: VolumeReviewReason | null;
  creator: { email: string; full_name: string | null } | null;
}

export async function listWorkOrderVolumes(workOrderId: string): Promise<ActionResult<WorkOrderVolumesData>> {
  if (!uuidSchema.safeParse(workOrderId).success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor } = ctx.context;
  if (!canAny(actor, "planning", ["read", "read_own"])) return fail("You do not have permission to view volumes.");
  if (!can(actor, "asset_volumes", "read")) return fail("You do not have permission to view volumes.");

  const supabase = await createSupabaseServerClient();

  const [readingsResult, workOrderResult] = await Promise.all([
    supabase
      .from("asset_volume_readings")
      .select(
        "id, asset_id, volume_item_id, value, read_at, notes, needs_review, review_reason, creator:users!asset_volume_readings_created_by_fkey(email, full_name)",
      )
      .eq("work_order_id", workOrderId)
      .order("read_at", { ascending: true })
      .returns<ReadingRow[]>(),
    supabase.from("work_orders").select("asset:assets(model_id)").eq("id", workOrderId).maybeSingle(),
  ]);
  if (readingsResult.error) return fail(mapDbError(readingsResult.error));
  const rows = readingsResult.data ?? [];

  const modelId = (workOrderResult.data as { asset: { model_id: string | null } | null } | null)?.asset?.model_id ?? null;
  let hasConfiguredCounters = false;
  if (modelId) {
    const { count } = await supabase
      .from("asset_model_volumes")
      .select("volume_item_id", { count: "exact", head: true })
      .eq("asset_model_id", modelId);
    hasConfiguredCounters = (count ?? 0) > 0;
  }

  if (rows.length === 0) return ok({ readings: [], hasConfiguredCounters });

  // Counter labels + units (parent article_unit item).
  const counterIds = Array.from(new Set(rows.map((r) => r.volume_item_id)));
  const { data: items, error: itemsError } = await supabase
    .from("reference_list_items")
    .select("id, label, parent_item_id")
    .in("id", counterIds);
  if (itemsError) return fail(mapDbError(itemsError));
  const parentIds = Array.from(
    new Set((items ?? []).map((i) => i.parent_item_id as string | null).filter((p): p is string => !!p)),
  );
  const unitById = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: units } = await supabase.from("reference_list_items").select("id, label").in("id", parentIds);
    for (const u of units ?? []) unitById.set(u.id as string, u.label as string);
  }
  const itemById = new Map<string, { label: string; unit: string | null }>();
  for (const i of items ?? []) {
    itemById.set(i.id as string, {
      label: i.label as string,
      unit: i.parent_item_id ? (unitById.get(i.parent_item_id as string) ?? null) : null,
    });
  }

  // Neighbouring values for flagged readings only (a handful at most).
  const neighbours = new Map<string, { previous: number | null; next: number | null }>();
  await Promise.all(
    rows
      .filter((r) => r.needs_review)
      .map(async (r) => {
        const base = () =>
          supabase
            .from("asset_volume_readings")
            .select("value")
            .eq("asset_id", r.asset_id)
            .eq("volume_item_id", r.volume_item_id)
            .neq("id", r.id)
            .limit(1);
        const [prev, next] = await Promise.all([
          base().lt("read_at", r.read_at).order("read_at", { ascending: false }),
          base().gt("read_at", r.read_at).order("read_at", { ascending: true }),
        ]);
        neighbours.set(r.id, {
          previous: prev.data?.[0] ? Number(prev.data[0].value) : null,
          next: next.data?.[0] ? Number(next.data[0].value) : null,
        });
      }),
  );

  const readings: WorkOrderVolumeReadingRecord[] = rows.map((r) => {
    const item = itemById.get(r.volume_item_id);
    const near = neighbours.get(r.id);
    return {
      id: r.id,
      counterLabel: item?.label ?? "Counter",
      unitLabel: item?.unit ?? null,
      value: Number(r.value),
      readAt: r.read_at,
      enteredByName: r.creator ? r.creator.full_name?.trim() || r.creator.email : null,
      notes: r.notes,
      needsReview: r.needs_review,
      reviewReason: r.review_reason,
      previousValue: near?.previous ?? null,
      nextValue: near?.next ?? null,
    };
  });
  return ok({ readings, hasConfiguredCounters });
}
