import { formatDateTime } from "@/lib/format/date";

/**
 * Maps Postgres errors raised by `validate_asset_volume_reading` (issue #221,
 * `supabase/migrations/20261118090000_asset_volumes.sql`) to friendly English
 * messages. Pure module (no `server-only`): safe to import anywhere. The PWA
 * has its own copy (`apps/pwa/lib/asset-volumes/errors.ts`) since the two apps
 * share no source.
 */

export function formatVolumeValue(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** Postgres timestamptz text ("2026-11-12 14:00:00+00") -> ISO that `Date` parses everywhere. */
function pgTimestampToIso(raw: string): string {
  let v = raw.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(v)) v += ":00";
  return v;
}

/** Parses a trigger DETAIL like `previous_value=1500.000; previous_read_at=2026-11-12 14:00:00+00`. */
function parseDetail(details: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (details ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Returns a friendly message for the reading-specific error codes, or `null`
 * when the error is not one of them (caller falls back to `mapDbError`).
 * `value` is the value the user tried to save (for the AV002/AV003 text).
 */
export function mapVolumeReadingError(error: PostgrestLikeError, value: number): string | null {
  switch (error.code) {
    case "AV001":
      return "This counter is not configured on the asset's model (or the asset has no model). Add it to the asset model in Settings first.";
    case "AV002": {
      const d = parseDetail(error.details);
      const prev = d.previous_value !== undefined ? formatVolumeValue(d.previous_value) : "?";
      const at = d.previous_read_at ? formatDateTime(pgTimestampToIso(d.previous_read_at)) : "an earlier date";
      return `Value ${formatVolumeValue(value)} is lower than the previous reading (${prev} on ${at}). Delete that reading first.`;
    }
    case "AV003": {
      const d = parseDetail(error.details);
      const next = d.next_value !== undefined ? formatVolumeValue(d.next_value) : "?";
      const at = d.next_read_at ? formatDateTime(pgTimestampToIso(d.next_read_at)) : "a later date";
      return `Value ${formatVolumeValue(value)} is higher than the next reading (${next} on ${at}). Delete that reading first.`;
    }
    case "23505":
      return "A reading for this counter already exists at that exact date and time.";
    default:
      return null;
  }
}
