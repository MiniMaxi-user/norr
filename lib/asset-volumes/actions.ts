"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { workOrderLabel } from "@/lib/format/work-order-label";
import { z } from "zod";
import { assetVolumeReadingCreateSchema, assetVolumeReadingDeleteSchema } from "./schema";
import { mapVolumeReadingError } from "./errors";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";

/**
 * Server Actions + loaders for asset volumes (issue #221): counters (items of
 * the tenant `volume` reference list) configured per asset model, and meter
 * readings per asset. Same preamble as every module: module context
 * (`hasFeature(org, "assets")` + RBAC actor) -> `can()` -> Zod -> query under
 * the caller's own RLS-scoped session.
 *
 * RBAC (`asset_volumes` module): owner/planner create/read/delete; engineer
 * read + create_own + delete_own; finance/administratie read. RLS mirrors
 * this exactly (see the migration header), so `can()` and RLS agree.
 * Readings are immutable: correction = delete + re-add.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const uuidSchema = z.string().uuid("Invalid id.");

/** Cap on readings loaded for one asset's history (all counters together). */
const MAX_READINGS_PER_ASSET = 2000;

// ---------------------------------------------------------------------------
// Types (consumed by the UI)
// ---------------------------------------------------------------------------

export interface AssetVolumeReading {
  id: string;
  volumeItemId: string;
  value: number;
  /** ISO timestamp. */
  readAt: string;
  notes: string | null;
  workOrderId: string | null;
  /** "WO2872 · External ref"; null when the reading is not tied to a work order (or it was deleted). */
  workOrderLabel: string | null;
  createdBy: string | null;
  /** Full name, else email; null when the author no longer exists. */
  createdByName: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** Issue #225: accepted offline although inconsistent with a neighbour; awaits office review. */
  needsReview: boolean;
  /** 'below_previous' | 'above_next' when `needsReview`. */
  reviewReason: string | null;
  /** Whether the current actor may delete THIS reading (any, or own for engineers). */
  canDelete: boolean;
}

export interface AssetVolumeCounter {
  volumeItemId: string;
  label: string;
  description: string | null;
  /** Label of the counter's parent `article_unit` item (e.g. "Prints"), if any. */
  unitLabel: string | null;
  /** The counter was retired on the Volume list (`is_active = false`). */
  isActive: boolean;
  /** true = counter is no longer configured on the asset's current model:
   * history is shown, but no new readings can be added (DB error AV001). */
  notConfigured: boolean;
  /** Newest reading (by `readAt`), or null when there are none yet. */
  latest: { readingId: string; value: number; readAt: string } | null;
  /** Newest first (by `readAt`). */
  readings: AssetVolumeReading[];
}

export interface AssetVolumesData {
  assetId: string;
  /** `assets.model_id`; counters are only configurable through a model. */
  modelId: string | null;
  /** Configured counters first (model `sort_order`), then `notConfigured` ones (by label). */
  counters: AssetVolumeCounter[];
  /** May add readings (`asset_volumes` create or create_own). */
  canCreate: boolean;
  /** May delete ANY reading (owner/planner). Engineers: use `reading.canDelete`. */
  canDelete: boolean;
}

export interface ClientVolumeTotal {
  volumeItemId: string;
  label: string;
  unitLabel: string | null;
  /** Sum of the latest reading of every asset of this client for this counter. */
  total: number;
  /** Number of assets that have at least one reading for this counter. */
  assetCount: number;
  /** ISO timestamp of the most recent reading among those assets. */
  lastReadAt: string | null;
}

export interface ClientVolumeAssetRow {
  assetId: string;
  assetName: string;
  siteId: string | null;
  siteName: string | null;
  volumeItemId: string;
  counterLabel: string;
  value: number;
  /** ISO timestamp. */
  readAt: string;
}

export interface ClientVolumeTotalsData {
  totals: ClientVolumeTotal[];
  /** Per-asset breakdown, sorted by counter label, then site, then asset name. */
  rows: ClientVolumeAssetRow[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface CounterItemRow {
  id: string;
  label: string;
  description: string | null;
  is_active: boolean;
  parent_item_id: string | null;
}

/** Loads counter items by id and resolves their unit labels (parent `article_unit` items). */
async function loadCounterItems(
  supabase: SupabaseServerClient,
  ids: string[],
): Promise<{ ok: true; items: Map<string, CounterItemRow & { unitLabel: string | null }> } | { ok: false; error: string }> {
  const items = new Map<string, CounterItemRow & { unitLabel: string | null }>();
  if (ids.length === 0) return { ok: true, items };

  const { data, error } = await supabase
    .from("reference_list_items")
    .select("id, label, description, is_active, parent_item_id")
    .in("id", ids);
  if (error) return { ok: false, error: mapDbError(error) };
  const rows = (data ?? []) as CounterItemRow[];

  const parentIds = Array.from(new Set(rows.map((r) => r.parent_item_id).filter((p): p is string => !!p)));
  const unitLabels = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: units, error: unitError } = await supabase
      .from("reference_list_items")
      .select("id, label")
      .in("id", parentIds);
    if (unitError) return { ok: false, error: mapDbError(unitError) };
    for (const u of (units ?? []) as { id: string; label: string }[]) unitLabels.set(u.id, u.label);
  }

  for (const row of rows) {
    items.set(row.id, { ...row, unitLabel: row.parent_item_id ? (unitLabels.get(row.parent_item_id) ?? null) : null });
  }
  return { ok: true, items };
}

async function revalidateAssetPages(supabase: SupabaseServerClient, assetId: string): Promise<void> {
  revalidatePath(`/assets/${assetId}`);
  const { data } = await supabase.from("assets").select("client_id").eq("id", assetId).maybeSingle();
  const clientId = (data as { client_id: string } | null)?.client_id;
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

interface ReadingRow {
  id: string;
  volume_item_id: string;
  value: number | string;
  read_at: string;
  notes: string | null;
  work_order_id: string | null;
  created_by: string | null;
  created_at: string;
  needs_review: boolean;
  review_reason: string | null;
  work_order: { work_order_number: string; external_reference: string | null } | null;
  creator: { email: string; full_name: string | null } | null;
}

/**
 * Counters + readings history for one asset (web asset page). Configured
 * counters come from the asset's CURRENT model; counters that have readings
 * but are no longer configured are included with `notConfigured: true` so
 * history never disappears. Requires the `assets` feature and
 * `asset_volumes` read.
 */
export async function getAssetVolumes(assetId: string): Promise<ActionResult<AssetVolumesData>> {
  if (!uuidSchema.safeParse(assetId).success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, session } = ctx.context;

  if (!canAny(actor, "asset_volumes", ["read", "read_own"])) {
    return fail("You do not have permission to view asset volumes.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id, model_id")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) return fail(mapDbError(assetError));
  if (!asset) return fail("Asset not found.");
  const modelId = (asset as { model_id: string | null }).model_id;

  const [configuredResult, readingsResult] = await Promise.all([
    modelId
      ? supabase
          .from("asset_model_volumes")
          .select("volume_item_id, sort_order")
          .eq("asset_model_id", modelId)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as { volume_item_id: string; sort_order: number }[], error: null }),
    supabase
      .from("asset_volume_readings")
      .select(
        "id, volume_item_id, value, read_at, notes, work_order_id, created_by, created_at, needs_review, review_reason, work_order:work_orders(work_order_number, external_reference), creator:users!asset_volume_readings_created_by_fkey(email, full_name)",
      )
      .eq("asset_id", assetId)
      .order("read_at", { ascending: false })
      .limit(MAX_READINGS_PER_ASSET),
  ]);
  if (configuredResult.error) return fail(mapDbError(configuredResult.error));
  if (readingsResult.error) return fail(mapDbError(readingsResult.error));

  const configuredIds = (configuredResult.data ?? []).map((c) => c.volume_item_id as string);
  const readingRows = (readingsResult.data ?? []) as unknown as ReadingRow[];

  const allIds = Array.from(new Set([...configuredIds, ...readingRows.map((r) => r.volume_item_id)]));
  const itemsResult = await loadCounterItems(supabase, allIds);
  if (!itemsResult.ok) return fail(itemsResult.error);

  const canDeleteAny = can(actor, "asset_volumes", "delete");
  const canDeleteOwn = can(actor, "asset_volumes", "delete_own");

  const readingsByCounter = new Map<string, AssetVolumeReading[]>();
  for (const r of readingRows) {
    const reading: AssetVolumeReading = {
      id: r.id,
      volumeItemId: r.volume_item_id,
      value: Number(r.value),
      readAt: r.read_at,
      notes: r.notes,
      workOrderId: r.work_order_id,
      workOrderLabel: r.work_order ? workOrderLabel(r.work_order) : null,
      createdBy: r.created_by,
      createdByName: r.creator ? r.creator.full_name?.trim() || r.creator.email : null,
      createdAt: r.created_at,
      needsReview: r.needs_review,
      reviewReason: r.review_reason,
      canDelete: canDeleteAny || (canDeleteOwn && r.created_by !== null && r.created_by === session.userId),
    };
    const list = readingsByCounter.get(r.volume_item_id);
    if (list) list.push(reading);
    else readingsByCounter.set(r.volume_item_id, [reading]);
  }

  const toCounter = (id: string, notConfigured: boolean): AssetVolumeCounter | null => {
    const item = itemsResult.items.get(id);
    if (!item) return null;
    const readings = readingsByCounter.get(id) ?? [];
    const newest = readings[0];
    return {
      volumeItemId: id,
      label: item.label,
      description: item.description,
      unitLabel: item.unitLabel,
      isActive: item.is_active,
      notConfigured,
      latest: newest ? { readingId: newest.id, value: newest.value, readAt: newest.readAt } : null,
      readings,
    };
  };

  const configuredSet = new Set(configuredIds);
  const counters: AssetVolumeCounter[] = [];
  for (const id of configuredIds) {
    const c = toCounter(id, false);
    if (c) counters.push(c);
  }
  const orphaned: AssetVolumeCounter[] = [];
  for (const id of readingsByCounter.keys()) {
    if (configuredSet.has(id)) continue;
    const c = toCounter(id, true);
    if (c) orphaned.push(c);
  }
  orphaned.sort((a, b) => a.label.localeCompare(b.label));
  counters.push(...orphaned);

  return ok({
    assetId,
    modelId,
    counters,
    canCreate: canAny(actor, "asset_volumes", ["create", "create_own"]),
    canDelete: canDeleteAny,
  });
}

/**
 * Client-level volume totals (Volumes tab on the client page): for every
 * counter, the sum of each asset's LATEST reading, plus the per-asset
 * breakdown. Reads the `asset_volume_latest_readings` view (security_invoker,
 * so RLS applies). Requires the `assets` feature and `asset_volumes` read.
 */
export async function getClientVolumeTotals(clientId: string): Promise<ActionResult<ClientVolumeTotalsData>> {
  if (!uuidSchema.safeParse(clientId).success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "asset_volumes", ["read", "read_own"])) {
    return fail("You do not have permission to view asset volumes.");
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("asset_volume_latest_readings")
    .select("asset_id, volume_item_id, value, read_at, site_id")
    .eq("client_id", clientId);
  if (error) return fail(mapDbError(error));

  const latest = (data ?? []) as { asset_id: string; volume_item_id: string; value: number | string; read_at: string; site_id: string }[];
  if (latest.length === 0) return ok({ totals: [], rows: [] });

  const assetIds = Array.from(new Set(latest.map((l) => l.asset_id)));
  const siteIds = Array.from(new Set(latest.map((l) => l.site_id).filter((s): s is string => Boolean(s))));
  const counterIds = Array.from(new Set(latest.map((l) => l.volume_item_id)));

  // Sites have no `name` column (issue #42) — they're labelled by address.
  const [assetsResult, sitesResult, countersResult] = await Promise.all([
    supabase.from("assets").select("id, name").in("id", assetIds),
    supabase.from("sites").select("id, address_line1, city").in("id", siteIds),
    loadCounterItems(supabase, counterIds),
  ]);
  if (assetsResult.error) return fail(mapDbError(assetsResult.error));
  if (sitesResult.error) return fail(mapDbError(sitesResult.error));
  if (!countersResult.ok) return fail(countersResult.error);

  const assetNames = new Map((assetsResult.data ?? []).map((a) => [a.id as string, a.name as string]));
  const siteNames = new Map(
    ((sitesResult.data ?? []) as { id: string; address_line1: string | null; city: string | null }[]).map((s) => [
      s.id,
      formatSiteAddressShort(s) ?? "—",
    ]),
  );

  const rows: ClientVolumeAssetRow[] = latest.map((l) => ({
    assetId: l.asset_id,
    assetName: assetNames.get(l.asset_id) ?? "—",
    siteId: l.site_id ?? null,
    siteName: siteNames.get(l.site_id) ?? null,
    volumeItemId: l.volume_item_id,
    counterLabel: countersResult.items.get(l.volume_item_id)?.label ?? "—",
    value: Number(l.value),
    readAt: l.read_at,
  }));
  rows.sort(
    (a, b) =>
      a.counterLabel.localeCompare(b.counterLabel) ||
      (a.siteName ?? "").localeCompare(b.siteName ?? "") ||
      a.assetName.localeCompare(b.assetName),
  );

  const totalsByCounter = new Map<string, ClientVolumeTotal>();
  for (const row of rows) {
    const existing = totalsByCounter.get(row.volumeItemId);
    if (existing) {
      existing.total += row.value;
      existing.assetCount += 1;
      if (!existing.lastReadAt || row.readAt > existing.lastReadAt) existing.lastReadAt = row.readAt;
    } else {
      totalsByCounter.set(row.volumeItemId, {
        volumeItemId: row.volumeItemId,
        label: row.counterLabel,
        unitLabel: countersResult.items.get(row.volumeItemId)?.unitLabel ?? null,
        total: row.value,
        assetCount: 1,
        lastReadAt: row.readAt,
      });
    }
  }
  const totals = Array.from(totalsByCounter.values()).sort((a, b) => a.label.localeCompare(b.label));
  // Avoid float drift from summing 3-decimal values.
  for (const t of totals) t.total = Math.round(t.total * 1000) / 1000;

  return ok({ totals, rows });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Adds a reading. `value` accepts a number or numeric string; `readAt` is an
 * ISO timestamp with offset (omit = now). `workOrderId` is never accepted
 * from web input (only the PWA route sets it). Owner/planner, or an engineer
 * (create_own). DB-validated: counter must be configured on the asset's
 * model, and the value must stay chronologically monotonic (friendly
 * messages for AV001/AV002/AV003/duplicate timestamp).
 */
export async function createAssetVolumeReading(
  input: unknown,
): Promise<ActionResult<{ reading: { id: string; assetId: string; volumeItemId: string; value: number; readAt: string } }>> {
  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "asset_volumes", ["create", "create_own"])) {
    return fail("You do not have permission to add readings.");
  }

  // Strip workOrderId: the web never links a reading to a work order.
  const raw = input && typeof input === "object" ? { ...(input as Record<string, unknown>), workOrderId: undefined } : input;
  const parsed = assetVolumeReadingCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }
  const { assetId, volumeItemId, value, readAt, notes } = parsed.data;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("asset_volume_readings")
    .insert({
      asset_id: assetId,
      volume_item_id: volumeItemId,
      value,
      read_at: readAt ?? new Date().toISOString(),
      notes: notes ?? null,
    })
    .select("id, asset_id, volume_item_id, value, read_at")
    .single();

  if (error) {
    const friendly = mapVolumeReadingError(error, value);
    return fail(friendly ?? mapDbError(error));
  }

  await revalidateAssetPages(supabase, assetId);
  const row = data as { id: string; asset_id: string; volume_item_id: string; value: number | string; read_at: string };
  return ok({
    reading: {
      id: row.id,
      assetId: row.asset_id,
      volumeItemId: row.volume_item_id,
      value: Number(row.value),
      readAt: row.read_at,
    },
  });
}

/**
 * Deletes a reading (correction = delete + re-add; readings are immutable).
 * Owner/planner: any reading. Engineer: only readings they created (checked
 * here AND by RLS).
 */
export async function deleteAssetVolumeReading(
  input: unknown,
): Promise<ActionResult<{ deletedId: string; assetId: string }>> {
  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, session } = ctx.context;

  const canAnyDelete = can(actor, "asset_volumes", "delete");
  if (!canAnyDelete && !can(actor, "asset_volumes", "delete_own")) {
    return fail("You do not have permission to delete readings.");
  }

  const parsed = assetVolumeReadingDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Invalid reading id.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: selectError } = await supabase
    .from("asset_volume_readings")
    .select("id, asset_id, created_by")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (selectError) return fail(mapDbError(selectError));
  if (!existing) return fail("Reading not found.");
  const row = existing as { id: string; asset_id: string; created_by: string | null };

  if (!canAnyDelete && row.created_by !== session.userId) {
    return fail("You can only delete your own readings.");
  }

  const { data, error } = await supabase
    .from("asset_volume_readings")
    .delete()
    .eq("id", row.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(mapDbError(error));
  if (!data) return fail("Reading not found, or you do not have permission to delete it.");

  await revalidateAssetPages(supabase, row.asset_id);
  return ok({ deletedId: row.id, assetId: row.asset_id });
}
