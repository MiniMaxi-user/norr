import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Labels of the counters (of the work order's asset model) that have no
 * reading registered ON the work order yet — the "Enter volumes" approval
 * blocker (issue #230). Plain module (not a Server Action file): it takes the
 * caller's own RLS-scoped client. Returns `[]` when there is no asset, no
 * model or no counters.
 */
export async function missingVolumeCounters(
  supabase: SupabaseClient,
  workOrderId: string,
  assetId: string | null,
): Promise<{ labels: string[]; error?: string }> {
  if (!assetId) return { labels: [] };

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("model_id")
    .eq("id", assetId)
    .maybeSingle<{ model_id: string | null }>();
  if (assetError) return { labels: [], error: assetError.message };
  if (!asset?.model_id) return { labels: [] };

  const { data: counters, error: countersError } = await supabase
    .from("asset_model_volumes")
    .select("volume_item_id, sort_order")
    .eq("asset_model_id", asset.model_id)
    .order("sort_order", { ascending: true });
  if (countersError) return { labels: [], error: countersError.message };
  if (!counters || counters.length === 0) return { labels: [] };
  const ids = counters.map((c) => c.volume_item_id as string);

  const [readings, items] = await Promise.all([
    supabase.from("asset_volume_readings").select("volume_item_id").eq("work_order_id", workOrderId).in("volume_item_id", ids),
    supabase.from("reference_list_items").select("id, label").in("id", ids),
  ]);
  if (readings.error) return { labels: [], error: readings.error.message };
  if (items.error) return { labels: [], error: items.error.message };

  const done = new Set((readings.data ?? []).map((r) => r.volume_item_id as string));
  const labelById = new Map((items.data ?? []).map((i) => [i.id as string, i.label as string]));
  return { labels: ids.filter((id) => !done.has(id)).map((id) => labelById.get(id) ?? "Counter") };
}
