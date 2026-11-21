/**
 * Server-side counter data loading shared by "Generate contract quotes"
 * (contract-quote-actions.ts) and the contract end flow (contracts/end-actions.ts),
 * issues #239/#271. NOT a "use server" file (it exports plain functions/types);
 * it only runs on the server with the caller's RLS-scoped Supabase client.
 */

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { mapDbError } from "@/lib/actions/result";
import type { BalanceContractLine, DateRange, UsageProvider, WindowUsage } from "./contract-balance";
import { addDaysIso } from "./contract-quote-helpers";
import { computeCounterUsage, type CounterAsset, type CounterReading } from "./counter-settlement";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const IN_CHUNK = 100;
const PAGE_SIZE = 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface CounterContractInput {
  id: string;
  startDate: string;
  /** Counters (volume items) of the contract's volume lines. */
  volumeItemIds: readonly string[];
}

export interface CounterData {
  /** contract id -> covered asset id -> coverage start (ISO date; direct + all
   * component descendants, from the `contract_covered_assets` SQL function). */
  coveredByContract: Map<string, Map<string, string>>;
  assets: Map<string, CounterAsset & { modelId: string | null; serialNumber: string | null }>;
  /** model id -> configured counter (volume item) ids. */
  countersByModel: Map<string, Set<string>>;
  /** `assetId|volumeItemId` -> readings (newest first). */
  readings: Map<string, CounterReading[]>;
}

/**
 * Bulk-loads everything counter settlement needs for the given contracts: coverage +
 * per-asset coverage start (one RPC per contract), asset names/models, counters per
 * model and the readings before the end of `latestPeriodEnd`. A handful of queries per
 * run, not per asset.
 */
export async function loadCounterData(
  supabase: Supabase,
  contracts: readonly CounterContractInput[],
  latestPeriodEnd: string,
): Promise<{ data: CounterData } | { error: string }> {
  const coveredByContract = new Map<string, Map<string, string>>();
  const allAssetIdSet = new Set<string>();
  for (const contract of contracts) {
    const { data, error } = await supabase.rpc("contract_covered_assets", { p_contract_id: contract.id });
    if (error) return { error: mapDbError(error) };
    const covered = new Map<string, string>();
    for (const row of (data ?? []) as { asset_id: string; coverage_start: string | null }[]) {
      covered.set(row.asset_id, row.coverage_start ?? contract.startDate);
      allAssetIdSet.add(row.asset_id);
    }
    coveredByContract.set(contract.id, covered);
  }

  const allAssetIds = [...allAssetIdSet];
  const assets = new Map<string, CounterAsset & { modelId: string | null; serialNumber: string | null }>();
  for (const ids of chunk(allAssetIds, IN_CHUNK)) {
    const { data, error } = await supabase.from("assets").select("id, name, model_id, serial_number").in("id", ids);
    if (error) return { error: mapDbError(error) };
    for (const row of data ?? []) {
      assets.set(row.id as string, {
        id: row.id as string,
        name: row.name as string,
        modelId: (row.model_id as string | null) ?? null,
        serialNumber: (row.serial_number as string | null) ?? null,
      });
    }
  }

  const modelIds = [...new Set([...assets.values()].map((a) => a.modelId).filter((id): id is string => Boolean(id)))];
  const countersByModel = new Map<string, Set<string>>();
  for (const ids of chunk(modelIds, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("asset_model_volumes")
      .select("asset_model_id, volume_item_id")
      .in("asset_model_id", ids);
    if (error) return { error: mapDbError(error) };
    for (const row of data ?? []) {
      const set = countersByModel.get(row.asset_model_id as string) ?? new Set<string>();
      set.add(row.volume_item_id as string);
      countersByModel.set(row.asset_model_id as string, set);
    }
  }

  // Only assets whose model has a counter that some contract line uses.
  const wantedVolumeIds = new Set<string>();
  for (const contract of contracts) for (const id of contract.volumeItemIds) wantedVolumeIds.add(id);
  const readingAssetIds = allAssetIds.filter((id) => {
    const modelId = assets.get(id)?.modelId;
    const counters = modelId ? countersByModel.get(modelId) : undefined;
    return counters ? [...wantedVolumeIds].some((v) => counters.has(v)) : false;
  });

  const readings = new Map<string, CounterReading[]>();
  const readUntil = `${addDaysIso(latestPeriodEnd, 1)}T00:00:00.000Z`;
  for (const ids of chunk(readingAssetIds, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("asset_volume_readings")
        .select("id, asset_id, volume_item_id, value, read_at, needs_review")
        .in("asset_id", ids)
        .in("volume_item_id", [...wantedVolumeIds])
        .lt("read_at", readUntil)
        .order("read_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) return { error: mapDbError(error) };
      for (const row of data ?? []) {
        const key = `${row.asset_id as string}|${row.volume_item_id as string}`;
        const list = readings.get(key) ?? [];
        list.push({
          assetId: row.asset_id as string,
          readAt: row.read_at as string,
          value: Number(row.value),
          needsReview: Boolean(row.needs_review),
        });
        readings.set(key, list);
      }
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
  }

  return { data: { coveredByContract, assets, countersByModel, readings } };
}

/** Covered assets of a contract whose model has `volumeItemId` as a counter. */
export function coveredAssetsForCounter(
  data: CounterData,
  contractId: string,
  volumeItemId: string,
): { id: string; name: string; serialNumber: string | null; baseline: string }[] {
  const baselines = data.coveredByContract.get(contractId) ?? new Map<string, string>();
  const out: { id: string; name: string; serialNumber: string | null; baseline: string }[] = [];
  for (const [assetId, baseline] of baselines) {
    const asset = data.assets.get(assetId);
    if (!asset?.modelId) continue;
    if (!data.countersByModel.get(asset.modelId)?.has(volumeItemId)) continue;
    out.push({ id: asset.id, name: asset.name, serialNumber: asset.serialNumber, baseline });
  }
  return out;
}

export interface UsageProviderOptions {
  contractId: string;
  data: CounterData;
  /** Closing readings entered on the end page (not saved yet): `assetId|volumeItemId` -> value.
   * They replace any reading on `closingDate` for that asset/counter. */
  closingReadings?: ReadonlyMap<string, number>;
  closingDate?: string;
}

/** Usage per window and counter line (computeCounterUsage over the covered assets);
 * applies entered closing readings when given. */
export function makeUsageProvider(options: UsageProviderOptions): UsageProvider {
  const { contractId, data, closingReadings, closingDate } = options;
  const baselines = data.coveredByContract.get(contractId) ?? new Map<string, string>();
  return (window: DateRange, line: BalanceContractLine): WindowUsage => {
    const volumeItemId = line.volumeItemId;
    if (!volumeItemId) return { usage: 0, issues: [], reviewReadingsInPeriod: 0 };
    const covered = coveredAssetsForCounter(data, contractId, volumeItemId);
    const readings = covered.flatMap((a) => {
      const key = `${a.id}|${volumeItemId}`;
      const list = data.readings.get(key) ?? [];
      const entered = closingReadings?.get(key);
      if (entered === undefined || !closingDate) return list;
      return [
        ...list.filter((r) => r.readAt.slice(0, 10) !== closingDate),
        { assetId: a.id, readAt: `${closingDate}T12:00:00.000Z`, value: entered, needsReview: false },
      ];
    });
    return computeCounterUsage(
      covered.map((a) => ({ id: a.id, name: a.name })),
      readings,
      window.start,
      window.end,
      baselines,
    );
  };
}
