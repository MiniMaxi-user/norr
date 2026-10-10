/**
 * Pure helpers for contract quote generation (issue #210). Not a "use server"
 * file. Dates are ISO `YYYY-MM-DD` strings handled in UTC so no timezone shift
 * can move a billing date.
 */

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y as number, m: m as number, d: d as number };
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `iso` + n months, clamping the day to the target month's length
 * (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const { y, m, d } = parseIso(iso);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toIso(target);
}

export function addDaysIso(iso: string, days: number): string {
  const { y, m, d } = parseIso(iso);
  return toIso(new Date(Date.UTC(y, m - 1, d + days)));
}

/**
 * Invoiced period for a contract, anchored on the contract start like the DB
 * (compute_contract_next_invoice_date: next = start_date + count * interval
 * months), so month-end starts stay contiguous (31 Jan start: periods start
 * 31 Jan, 28 Feb, 31 Mar...). Period start = `nextInvoiceDate`; recurring
 * terms: end = contractStart + (invoicedPeriodCount + 1) * interval months - 1
 * day. Non-recurring/missing terms: the contract end date when set, else the
 * start date itself. Always capped at `contractEnd`, never before the start.
 */
export function computeContractPeriod(
  nextInvoiceDate: string,
  contractStart: string,
  invoicedPeriodCount: number,
  intervalMonths: number | null,
  contractEnd: string | null,
): { start: string; end: string } {
  const start = nextInvoiceDate;
  let end = intervalMonths
    ? addDaysIso(addMonthsIso(contractStart, (invoicedPeriodCount + 1) * intervalMonths), -1)
    : (contractEnd ?? start);
  if (contractEnd && end > contractEnd) end = contractEnd;
  if (end < start) end = start;
  return { start, end };
}

const labelFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(iso: string): string {
  const { y, m, d } = parseIso(iso);
  return labelFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}

/** "1 Jan 2027 – 31 Mar 2027", or a single date when `end` is null/equal. */
export function formatPeriodLabel(start: string, end: string | null): string {
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Applies the terms/period multiplier to a contract line: scales the quantity
 * when quantity x multiplier is exact (and positive) at 2 decimals, otherwise
 * keeps the quantity and scales the unit price (rounded to cents).
 */
export function scaleContractLine(
  quantity: number,
  unitPrice: number,
  multiplier: number,
): { quantity: number; unitPrice: number } {
  if (multiplier === 1) return { quantity, unitPrice };
  const scaledQuantity = quantity * multiplier;
  const rounded = round2(scaledQuantity);
  if (rounded > 0 && Math.abs(scaledQuantity - rounded) < 1e-9) return { quantity: rounded, unitPrice };
  return { quantity, unitPrice: round2(unitPrice * multiplier) };
}

export interface ContractAssetNote {
  name: string;
  serialNumber: string | null;
  externalReference: string | null;
  model: string | null;
  siteName: string | null;
}

const MAX_ASSETS_IN_NOTES = 200;

/** Plain-text "Covered assets" block for the quote notes. */
export function describeContractAssets(assets: readonly ContractAssetNote[]): string {
  if (assets.length === 0) return "Covered assets: none";
  const lines = assets.slice(0, MAX_ASSETS_IN_NOTES).map((asset) => {
    const details = [
      asset.model ? `Model: ${asset.model}` : null,
      asset.serialNumber ? `Serial: ${asset.serialNumber}` : null,
      asset.externalReference ? `Ref: ${asset.externalReference}` : null,
      asset.siteName ? `Site: ${asset.siteName}` : null,
    ].filter(Boolean);
    return `- ${asset.name}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
  });
  const more = assets.length > MAX_ASSETS_IN_NOTES ? [`... and ${assets.length - MAX_ASSETS_IN_NOTES} more`] : [];
  return [`Covered assets (${assets.length}):`, ...lines, ...more].join("\n");
}
