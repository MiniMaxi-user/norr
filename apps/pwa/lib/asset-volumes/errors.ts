/**
 * Friendly English messages for the asset volume reading trigger errors
 * (issue #221, `validate_asset_volume_reading`). Mirror of the root app's
 * `lib/asset-volumes/errors.ts` (the two apps share no source).
 */

export interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
}

export function formatVolumeValue(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 3 }) : String(value);
}

function formatPgTimestamp(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  let v = raw.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(v)) v += ":00";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseDetail(details: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (details ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

/** Friendly message + HTTP status for known reading errors, else `null`. */
export function mapVolumeReadingError(
  error: PostgrestLikeError,
  value: number,
): { message: string; status: number } | null {
  switch (error.code) {
    case "AV001":
      return {
        message:
          "This counter is not configured on the asset's model (or the asset has no model). Ask the office to add it in Settings.",
        status: 409,
      };
    case "AV002": {
      const d = parseDetail(error.details);
      const prev = d.previous_value !== undefined ? formatVolumeValue(d.previous_value) : "?";
      return {
        message: `Value ${formatVolumeValue(value)} is lower than the previous reading (${prev} on ${formatPgTimestamp(d.previous_read_at, "an earlier date")}). Delete that reading first.`,
        status: 409,
      };
    }
    case "AV003": {
      const d = parseDetail(error.details);
      const next = d.next_value !== undefined ? formatVolumeValue(d.next_value) : "?";
      return {
        message: `Value ${formatVolumeValue(value)} is higher than the next reading (${next} on ${formatPgTimestamp(d.next_read_at, "a later date")}). Delete that reading first.`,
        status: 409,
      };
    }
    case "23505":
      return { message: "A reading for this counter already exists at that exact date and time.", status: 409 };
    case "23514":
      return { message: "That reading isn't valid for this counter.", status: 400 };
    case "42501":
      return { message: "You do not have permission to do that.", status: 403 };
    default:
      return null;
  }
}
