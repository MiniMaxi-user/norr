import { NextResponse } from "next/server";
import { can } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/features/server";
import { mapVolumeReadingError } from "@/lib/asset-volumes/errors";
import type {
  CreateWorkOrderVolumeReadingResponse,
  WorkOrderVolumeCounter,
  WorkOrderVolumeReading,
  WorkOrderVolumesResponse,
} from "@/lib/asset-volumes/types";

/**
 * GET/POST /api/work-orders/[id]/volumes — asset volume (counter/meter)
 * readings for the asset of a work order (issue #221).
 *
 * GET: counters configured on the work order's asset's CURRENT model, each
 * with the latest reading (by anyone) and the signed-in engineer's own recent
 * readings (with ids, so they can be deleted).
 * POST: records a reading for one counter; `work_order_id` is set to this
 * work order and the asset is always the work order's own (never client-sent).
 *
 * POST is the ONLINE path (the DB validates against the previous/next
 * reading, AV002/AV003). Offline, the PWA queues readings locally (Dexie
 * `localVolumeReadings`) and sends them with `POST /api/work-orders/[id]/
 * finish`, which inserts them flagged `needs_review` (issue #225). Same session -> permission -> RLS-scoped query pattern
 * as the sibling routes. Issue #230: values are whole numbers and a new one
 * replaces the engineer's earlier reading of that counter on this work order; RLS (`asset_volume_readings_*`) is the real boundary.
 *
 * Note: the PWA has no `hasFeature()` helper; the `assets` entitlement is
 * enforced by the web app's pages, and RLS here only checks org membership +
 * role (same as every other engineer route in this app).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MY_READINGS_PER_COUNTER = 5;
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const MAX_VALUE = 999_999_999_999.999;
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

interface ReadingRow {
  id: string;
  volume_item_id: string;
  value: number | string;
  read_at: string;
  notes: string | null;
  work_order_id: string | null;
  created_at: string;
}

function toReading(row: ReadingRow): WorkOrderVolumeReading {
  return {
    id: row.id,
    value: Number(row.value),
    readAt: row.read_at,
    notes: row.notes,
    workOrderId: row.work_order_id,
    createdAt: row.created_at,
  };
}

async function resolveWorkOrder(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  // RLS (work_orders_select_scoped) hides work orders not assigned to this engineer.
  return supabase
    .from("work_orders")
    .select("id, asset:assets!work_orders_asset_id_fkey(id, name, model_id)")
    .eq("id", id)
    .maybeSingle();
}

type WorkOrderAssetRow = { id: string; asset: { id: string; name: string; model_id: string | null } | null };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid work order id." }, { status: 400 });

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const metersOff = await requireFeature(session.organization?.id, "meters");
  if (metersOff) return metersOff;
  if (!can({ role: session.role }, "asset_volumes", "read")) {
    return NextResponse.json({ error: "You do not have permission to view asset volumes." }, { status: 403 });
  }

  const supabase = await createClient();
  const woResult = await resolveWorkOrder(supabase, id);
  if (woResult.error) {
    console.error("GET /api/work-orders/[id]/volumes: failed to load work order", woResult.error);
    return NextResponse.json({ error: "Failed to load work order." }, { status: 500 });
  }
  const wo = woResult.data as unknown as WorkOrderAssetRow | null;
  if (!wo) return NextResponse.json({ error: "Work order not found." }, { status: 404 });

  const canCreate = can({ role: session.role }, "asset_volumes", "create_own");
  const asset = wo.asset;
  if (!asset || !asset.model_id) {
    const empty: WorkOrderVolumesResponse = {
      workOrderId: wo.id,
      asset: asset ? { id: asset.id, name: asset.name } : null,
      counters: [],
      canCreate,
    };
    return NextResponse.json(empty);
  }

  const [configuredResult, latestResult, mineResult, onWorkOrderResult] = await Promise.all([
    supabase
      .from("asset_model_volumes")
      .select("volume_item_id, sort_order, item:reference_list_items(id, label, description, parent_item_id)")
      .eq("asset_model_id", asset.model_id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("asset_volume_latest_readings")
      .select("reading_id, volume_item_id, value, read_at")
      .eq("asset_id", asset.id),
    supabase
      .from("asset_volume_readings")
      .select("id, volume_item_id, value, read_at, notes, work_order_id, created_at")
      .eq("asset_id", asset.id)
      .eq("created_by", session.userId)
      .order("read_at", { ascending: false })
      .limit(200),
    supabase.from("asset_volume_readings").select("volume_item_id").eq("work_order_id", wo.id),
  ]);
  for (const r of [configuredResult, latestResult, mineResult, onWorkOrderResult]) {
    if (r.error) {
      console.error("GET /api/work-orders/[id]/volumes: query failed", r.error);
      return NextResponse.json({ error: "Failed to load asset volumes." }, { status: 500 });
    }
  }

  const configured = (configuredResult.data ?? []) as unknown as {
    volume_item_id: string;
    item: { id: string; label: string; description: string | null; parent_item_id: string | null } | null;
  }[];

  const parentIds = Array.from(
    new Set(configured.map((c) => c.item?.parent_item_id).filter((p): p is string => !!p)),
  );
  const unitLabels = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: units, error: unitError } = await supabase
      .from("reference_list_items")
      .select("id, label")
      .in("id", parentIds);
    if (unitError) {
      console.error("GET /api/work-orders/[id]/volumes: failed to load units", unitError);
      return NextResponse.json({ error: "Failed to load asset volumes." }, { status: 500 });
    }
    for (const u of (units ?? []) as { id: string; label: string }[]) unitLabels.set(u.id, u.label);
  }

  const latestByCounter = new Map(
    (
      (latestResult.data ?? []) as {
        reading_id: string;
        volume_item_id: string;
        value: number | string;
        read_at: string;
      }[]
    ).map((l) => [l.volume_item_id, { readingId: l.reading_id, value: Number(l.value), readAt: l.read_at }] as const),
  );
  const mineByCounter = new Map<string, WorkOrderVolumeReading[]>();
  for (const row of (mineResult.data ?? []) as ReadingRow[]) {
    const list = mineByCounter.get(row.volume_item_id) ?? [];
    if (list.length < MY_READINGS_PER_COUNTER) list.push(toReading(row));
    mineByCounter.set(row.volume_item_id, list);
  }

  const onWorkOrder = new Set(
    ((onWorkOrderResult.data ?? []) as { volume_item_id: string }[]).map((r) => r.volume_item_id),
  );

  const counters: WorkOrderVolumeCounter[] = [];
  for (const c of configured) {
    if (!c.item) continue;
    counters.push({
      volumeItemId: c.volume_item_id,
      label: c.item.label,
      description: c.item.description,
      unitLabel: c.item.parent_item_id ? (unitLabels.get(c.item.parent_item_id) ?? null) : null,
      latest: latestByCounter.get(c.volume_item_id) ?? null,
      myReadings: mineByCounter.get(c.volume_item_id) ?? [],
      hasReadingOnWorkOrder: onWorkOrder.has(c.volume_item_id),
    });
  }

  const response: WorkOrderVolumesResponse = {
    workOrderId: wo.id,
    asset: { id: asset.id, name: asset.name },
    counters,
    canCreate,
  };
  return NextResponse.json(response);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid work order id." }, { status: 400 });

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const metersOff = await requireFeature(session.organization?.id, "meters");
  if (metersOff) return metersOff;
  if (!can({ role: session.role }, "asset_volumes", "create_own")) {
    return NextResponse.json({ error: "You do not have permission to add readings." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const volumeItemId = typeof b.volumeItemId === "string" ? b.volumeItemId : "";
  if (!UUID_RE.test(volumeItemId)) {
    return NextResponse.json({ error: "Invalid counter." }, { status: 400 });
  }

  const rawValue = typeof b.value === "string" ? b.value.trim() : b.value;
  const value =
    typeof rawValue === "number" || (typeof rawValue === "string" && rawValue !== "") ? Number(rawValue) : NaN;
  if (!Number.isFinite(value)) return NextResponse.json({ error: "Value must be a number." }, { status: 400 });
  if (value < 0) return NextResponse.json({ error: "Value cannot be negative." }, { status: 400 });
  if (value > MAX_VALUE) return NextResponse.json({ error: "Value is too large." }, { status: 400 });
  // Issue #230: the PWA counters are whole numbers (the fixed "Volumes"
  // checklist); decimals are rejected on this route.
  if (!Number.isInteger(value)) {
    return NextResponse.json({ error: "Value must be a whole number." }, { status: 400 });
  }

  let readAt = new Date().toISOString();
  if (b.readAt !== undefined && b.readAt !== null && b.readAt !== "") {
    if (typeof b.readAt !== "string" || !ISO_WITH_OFFSET_RE.test(b.readAt) || Number.isNaN(Date.parse(b.readAt))) {
      return NextResponse.json({ error: "Invalid date and time." }, { status: 400 });
    }
    if (Date.parse(b.readAt) > Date.now() + FUTURE_TOLERANCE_MS) {
      return NextResponse.json({ error: "Reading date cannot be in the future." }, { status: 400 });
    }
    readAt = b.readAt;
  }

  let notes: string | null = null;
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== "string") return NextResponse.json({ error: "Invalid notes." }, { status: 400 });
    const trimmed = b.notes.trim();
    if (trimmed.length > 2000) return NextResponse.json({ error: "Notes are too long." }, { status: 400 });
    notes = trimmed === "" ? null : trimmed;
  }

  const supabase = await createClient();
  const woResult = await resolveWorkOrder(supabase, id);
  if (woResult.error) {
    console.error("POST /api/work-orders/[id]/volumes: failed to load work order", woResult.error);
    return NextResponse.json({ error: "Failed to load work order." }, { status: 500 });
  }
  const wo = woResult.data as unknown as WorkOrderAssetRow | null;
  if (!wo) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  if (!wo.asset) return NextResponse.json({ error: "This work order has no asset." }, { status: 400 });

  // Issue #230: one reading per counter per work order from this flow. The RPC
  // replaces the engineer's earlier reading of the counter on THIS work order
  // atomically (delete + insert in one transaction, advisory-locked, RLS and the
  // monotonic trigger apply as the caller); on any error the old reading stays.
  const { data, error } = await supabase.rpc("replace_work_order_volume_reading", {
    p_work_order_id: wo.id,
    p_volume_item_id: volumeItemId,
    p_value: value,
    p_read_at: readAt,
    p_notes: notes,
  });

  if (error || !data) {
    if (error) {
      const friendly = mapVolumeReadingError(error, value);
      if (friendly) return NextResponse.json({ error: friendly.message }, { status: friendly.status });
    }
    console.error("POST /api/work-orders/[id]/volumes: replace failed", error);
    return NextResponse.json({ error: "Failed to save reading." }, { status: 500 });
  }

  const row = data as unknown as ReadingRow;
  const response: CreateWorkOrderVolumeReadingResponse = {
    reading: { ...toReading(row), volumeItemId: row.volume_item_id },
  };
  return NextResponse.json(response, { status: 201 });
}
