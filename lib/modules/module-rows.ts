import { z } from "zod";
import { isCatalogKey, type CatalogFeatureKey } from "@/lib/rbac/module-catalog";

/**
 * One row of the module list as the Modules tab (#245) and the default
 * bundle card (#246) show it. Pure and client-safe (no "server-only").
 */
export interface ModuleRow {
  key: CatalogFeatureKey;
  enabled: boolean;
  /** 'manual' | 'stripe' | 'default'; null for the default bundle (no source). */
  source: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export type ModuleChanges = Partial<Record<CatalogFeatureKey, boolean>>;

interface RpcModuleRow {
  feature_key: string;
  enabled: boolean | null;
  source?: string | null;
  updated_at?: string | null;
  updated_by_name?: string | null;
}

/** Maps the `list_*_features` RPC rows; unknown keys (not in the TS catalog) are dropped. */
export function mapModuleRows(rows: RpcModuleRow[] | null): ModuleRow[] {
  return (rows ?? []).flatMap((row) =>
    isCatalogKey(row.feature_key)
      ? [
          {
            key: row.feature_key,
            enabled: row.enabled ?? false,
            source: row.source ?? null,
            updatedAt: row.updated_at ?? null,
            updatedByName: row.updated_by_name ?? null,
          },
        ]
      : [],
  );
}

/** DB rule violations carry the readable message - pass it through. */
export function mapModuleError(error: { code?: string; message: string }): string {
  if (error.code === "23514" || error.code === "42501" || error.code === "P0002") return error.message;
  return "Could not save the modules. Please try again.";
}

/** Zod schema for a module change set: a non-empty record of catalog key -> boolean. */
export const moduleChangesSchema = z
  .record(z.string(), z.boolean())
  .refine((value) => Object.keys(value).length > 0, "Invalid module change.")
  .refine((value) => Object.keys(value).every(isCatalogKey), "Invalid module change.");
