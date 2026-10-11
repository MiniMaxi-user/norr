import type {
  DashboardActivity,
  DashboardDataset,
  DashboardQuote,
  DashboardWorkOrder,
} from "./types";

/**
 * Pure aggregation for the dashboard: given the serialized dataset and the
 * current filter state it derives every KPI, chart series and list. Runs in
 * the browser (the screen is a cross-filtering Client Component) but has no
 * browser dependencies, so it can be unit-tested or reused on the server.
 *
 * Cross-filter semantics: every widget applies all active filters EXCEPT the
 * one for its own dimension (a status donut keeps showing every status so the
 * selected slice can be highlighted and un-selected), and the time-series
 * charts ignore the bucket filter for the same reason. A filter only affects
 * widgets whose rows carry that dimension (e.g. the engineer filter does not
 * touch quotes).
 */

export type PeriodKey = "30d" | "3m" | "6m" | "12m";

export const PERIOD_OPTIONS: ReadonlyArray<{
  value: PeriodKey;
  label: string;
}> = [
  { value: "30d", label: "30 days" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
];

export const DEFAULT_PERIOD: PeriodKey = "6m";

export interface DashboardFilters {
  period: PeriodKey;
  /** `YYYY-MM` (month) or `YYYY-MM-DD` (day, for the 30-day period). */
  bucket: string | null;
  clientId: string | null;
  assetId: string | null;
  engineerId: string | null;
  statusValue: string | null;
  woTypeValue: string | null;
  activityTypeValue: string | null;
}

export type FilterDimension = Exclude<keyof DashboardFilters, "period">;

export const EMPTY_FILTERS: DashboardFilters = {
  period: DEFAULT_PERIOD,
  bucket: null,
  clientId: null,
  assetId: null,
  engineerId: null,
  statusValue: null,
  woTypeValue: null,
  activityTypeValue: null,
};

const PARAM_BY_DIMENSION: Record<FilterDimension, string> = {
  bucket: "bucket",
  clientId: "client",
  assetId: "asset",
  engineerId: "engineer",
  statusValue: "status",
  woTypeValue: "type",
  activityTypeValue: "atype",
};

export function parsePeriod(raw: string | null | undefined): PeriodKey | null {
  return PERIOD_OPTIONS.find((option) => option.value === raw)?.value ?? null;
}

export function parseFilters(
  params: Record<string, string | undefined>,
): DashboardFilters {
  const read = (dimension: FilterDimension) =>
    params[PARAM_BY_DIMENSION[dimension]]?.trim() || null;
  const period = parsePeriod(params.period) ?? DEFAULT_PERIOD;
  const bucket = read("bucket");
  const validBucket =
    bucket &&
    /^\d{4}-\d{2}(-\d{2})?$/.test(bucket) &&
    (bucket.length === 10) === (period === "30d");
  return {
    period,
    bucket: validBucket ? bucket : null,
    clientId: read("clientId"),
    assetId: read("assetId"),
    engineerId: read("engineerId"),
    statusValue: read("statusValue"),
    woTypeValue: read("woTypeValue"),
    activityTypeValue: read("activityTypeValue"),
  };
}

export function serializeFilters(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.period !== DEFAULT_PERIOD) params.set("period", filters.period);
  for (const dimension of Object.keys(
    PARAM_BY_DIMENSION,
  ) as FilterDimension[]) {
    const value = filters[dimension];
    if (value) params.set(PARAM_BY_DIMENSION[dimension], value);
  }
  return params;
}

export function hasActiveFilters(filters: DashboardFilters): boolean {
  return (Object.keys(PARAM_BY_DIMENSION) as FilterDimension[]).some(
    (dimension) => filters[dimension] !== null,
  );
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (value: number) => String(value).padStart(2, "0");

type Granularity = "day" | "month";

interface Range {
  start: number;
  end: number;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function dayKey(date: Date): string {
  return `${monthKey(date)}-${pad(date.getDate())}`;
}

function bucketKeyOf(iso: string, granularity: Granularity): string {
  const date = new Date(iso);
  return granularity === "day" ? dayKey(date) : monthKey(date);
}

function bucketRange(bucket: string): { current: Range; previous: Range } {
  const parts = bucket.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = (parts[1] ?? 1) - 1;
  if (parts.length === 3) {
    const day = parts[2] ?? 1;
    const start = new Date(year, month, day).getTime();
    const end = new Date(year, month, day + 1).getTime();
    return {
      current: { start, end },
      previous: { start: new Date(year, month, day - 1).getTime(), end: start },
    };
  }
  const start = new Date(year, month, 1).getTime();
  const end = new Date(year, month + 1, 1).getTime();
  return {
    current: { start, end },
    previous: { start: new Date(year, month - 1, 1).getTime(), end: start },
  };
}

function periodRange(
  period: PeriodKey,
  now: Date,
): { current: Range; previous: Range; granularity: Granularity } {
  const end = now.getTime() + 1;
  if (period === "30d") {
    const start = startOfDay(now).getTime() - 29 * DAY_MS;
    return {
      current: { start, end },
      previous: { start: start - 30 * DAY_MS, end: start },
      granularity: "day",
    };
  }
  const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
  const start = new Date(
    now.getFullYear(),
    now.getMonth() - (months - 1),
    1,
  ).getTime();
  const previousStart = new Date(
    now.getFullYear(),
    now.getMonth() - (2 * months - 1),
    1,
  ).getTime();
  return {
    current: { start, end },
    previous: { start: previousStart, end: start },
    granularity: "month",
  };
}

function inRange(iso: string | null, range: Range): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return time >= range.start && time < range.end;
}

function bucketLabels(
  key: string,
  granularity: Granularity,
): { label: string; longLabel: string } {
  const parts = key.split("-").map(Number);
  const date = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  if (granularity === "day") {
    return {
      label: date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      }),
      longLabel: date.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    };
  }
  return {
    label:
      date.getMonth() === 0
        ? date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
        : date.toLocaleDateString("en-GB", { month: "short" }),
    longLabel: date.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    }),
  };
}

function bucketKeys(range: Range, granularity: Granularity): string[] {
  const keys: string[] = [];
  const first = new Date(range.start);
  if (granularity === "day") {
    for (let time = range.start; time < range.end; time += DAY_MS)
      keys.push(dayKey(new Date(time)));
    // DST shifts can duplicate/skip an hour; de-duplicate defensively.
    return [...new Set(keys)];
  }
  for (
    let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    cursor.getTime() < range.end;
  ) {
    keys.push(monthKey(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return keys;
}

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

export interface Kpi {
  value: number;
  /** Value over the previous equivalent period (null when not comparable). */
  previous: number | null;
}

export interface SeriesPoint {
  key: string;
  label: string;
  longLabel: string;
  /** Still-running bucket (month or day to date). */
  partial: boolean;
  values: Record<string, number>;
}

export interface SliceDatum {
  key: string;
  label: string;
  value: number;
  color: string | null;
}

export interface RankedDatum {
  key: string;
  label: string;
  secondary: string;
  value: number;
  /** Singular/plural-aware text for non-currency values. */
  valueLabel?: string;
  href?: string;
}

export interface DashboardModel {
  granularity: Granularity;
  rangeLabel: string;
  kpis: {
    revenue: Kpi;
    marginPercent: Kpi;
    averageInvoice: Kpi;
    invoiceCount: number;
    pipelineValue: number;
    pipelineCount: number;
    openWorkOrders: number;
    unscheduledWorkOrders: number;
    awaitingReview: number;
    overdueWorkOrders: number;
    openMalfunctions: number;
    malfunctionsReported: Kpi;
    completedWorkOrders: Kpi;
    averageCompletionHours: number | null;
  };
  revenueSeries: SeriesPoint[];
  flowSeries: SeriesPoint[];
  malfunctionSeries: SeriesPoint[];
  workOrderStatus: SliceDatum[];
  workOrderTypes: SliceDatum[];
  activityTypes: SliceDatum[];
  engineers: RankedDatum[];
  topClients: RankedDatum[];
  topAssets: RankedDatum[];
  topArticles: RankedDatum[];
  upcoming: DashboardWorkOrder[];
  overdue: DashboardWorkOrder[];
  oldestMalfunctions: DashboardActivity[];
  /** Per-bucket numbers for the KPI sparklines. */
  sparks: { revenue: number[]; completed: number[]; malfunctions: number[] };
  /** Whole-period totals behind the chart subtitles. */
  totals: { revenue: number; created: number; completed: number };
  /** Uncapped list sizes for the tab badges. */
  counts: { upcoming: number; overdue: number; malfunctions: number };
  chips: Array<{ dimension: FilterDimension; label: string; value: string }>;
  isEmpty: boolean;
}

const MALFUNCTION_TYPE = "storing";

function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function sliceUp<T>(
  rows: T[],
  keyOf: (row: T) => string,
  labelOf: (row: T) => string,
  colorOf: (row: T) => string | null,
): SliceDatum[] {
  const map = new Map<string, SliceDatum>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = map.get(key);
    if (existing) existing.value += 1;
    else
      map.set(key, { key, label: labelOf(row), value: 1, color: colorOf(row) });
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export function computeDashboard(
  data: DashboardDataset,
  filters: DashboardFilters,
): DashboardModel {
  const now = new Date(data.now);
  const nowMs = now.getTime();
  const {
    current: periodCurrent,
    previous: periodPrevious,
    granularity,
  } = periodRange(filters.period, now);
  const active = filters.bucket
    ? bucketRange(filters.bucket)
    : { current: periodCurrent, previous: periodPrevious };
  const range = active.current;
  const previousRange = active.previous;

  type Exclusion = FilterDimension;
  const woPass = (wo: DashboardWorkOrder, exclude: Exclusion[] = []) =>
    (exclude.includes("clientId") ||
      !filters.clientId ||
      wo.clientId === filters.clientId) &&
    (exclude.includes("assetId") ||
      !filters.assetId ||
      wo.assetId === filters.assetId) &&
    (exclude.includes("engineerId") ||
      !filters.engineerId ||
      wo.engineerId === filters.engineerId) &&
    (exclude.includes("statusValue") ||
      !filters.statusValue ||
      wo.statusValue === filters.statusValue) &&
    (exclude.includes("woTypeValue") ||
      !filters.woTypeValue ||
      wo.typeValue === filters.woTypeValue);
  const actPass = (activity: DashboardActivity, exclude: Exclusion[] = []) =>
    (exclude.includes("clientId") ||
      !filters.clientId ||
      activity.clientId === filters.clientId) &&
    (exclude.includes("assetId") ||
      !filters.assetId ||
      activity.assetId === filters.assetId) &&
    (exclude.includes("activityTypeValue") ||
      !filters.activityTypeValue ||
      activity.typeValue === filters.activityTypeValue);
  const quotePass = (quote: DashboardQuote, exclude: Exclusion[] = []) =>
    exclude.includes("clientId") ||
    !filters.clientId ||
    quote.clientId === filters.clientId;

  const workOrders = (exclude: Exclusion[] = []) =>
    data.workOrders.filter((wo) => woPass(wo, exclude));
  const activities = (exclude: Exclusion[] = []) =>
    data.activities.filter((a) => actPass(a, exclude));
  const invoiced = (exclude: Exclusion[] = []) =>
    data.quotes.filter((q) => q.status === "invoiced" && quotePass(q, exclude));

  const sumTotal = (quotes: DashboardQuote[]) =>
    quotes.reduce((sum, q) => sum + q.total, 0);
  const margin = (quotes: DashboardQuote[]) => {
    const costed = quotes.reduce((sum, q) => sum + q.costedTotal, 0);
    const cost = quotes.reduce((sum, q) => sum + q.cost, 0);
    return costed > 0 ? ((costed - cost) / costed) * 100 : 0;
  };

  /* KPIs */
  const invoicedNow = invoiced().filter((q) => inRange(q.date, range));
  const invoicedPrev = invoiced().filter((q) => inRange(q.date, previousRange));
  const doneNow = workOrders().filter((wo) => inRange(wo.doneAt, range));
  const donePrev = workOrders().filter((wo) =>
    inRange(wo.doneAt, previousRange),
  );
  const storingAll = activities(["activityTypeValue"]).filter(
    (a) => a.typeValue === MALFUNCTION_TYPE,
  );
  const openOrders = workOrders().filter((wo) => wo.isOpen);
  const completionHours = doneNow
    .filter((wo) => wo.doneAt)
    .map(
      (wo) =>
        (new Date(wo.doneAt as string).getTime() -
          new Date(wo.createdAt).getTime()) /
        3_600_000,
    )
    .filter((hours) => hours >= 0);
  const drafts = data.quotes.filter(
    (q) => q.status === "draft" && quotePass(q),
  );

  const kpis: DashboardModel["kpis"] = {
    revenue: { value: sumTotal(invoicedNow), previous: sumTotal(invoicedPrev) },
    marginPercent: {
      value: margin(invoicedNow),
      previous: invoicedPrev.length ? margin(invoicedPrev) : null,
    },
    averageInvoice: {
      value: invoicedNow.length
        ? sumTotal(invoicedNow) / invoicedNow.length
        : 0,
      previous: invoicedPrev.length
        ? sumTotal(invoicedPrev) / invoicedPrev.length
        : null,
    },
    invoiceCount: invoicedNow.length,
    pipelineValue: sumTotal(drafts),
    pipelineCount: drafts.length,
    openWorkOrders: openOrders.length,
    unscheduledWorkOrders: openOrders.filter((wo) => !wo.scheduledAt).length,
    awaitingReview: workOrders().filter((wo) => wo.statusValue === "to_review")
      .length,
    overdueWorkOrders: openOrders.filter(
      (wo) => wo.scheduledAt && new Date(wo.scheduledAt).getTime() < nowMs,
    ).length,
    openMalfunctions: storingAll.filter((a) => a.isOpen).length,
    malfunctionsReported: {
      value: storingAll.filter((a) => inRange(a.reportedAt, range)).length,
      previous: storingAll.filter((a) => inRange(a.reportedAt, previousRange))
        .length,
    },
    completedWorkOrders: { value: doneNow.length, previous: donePrev.length },
    averageCompletionHours: completionHours.length
      ? completionHours.reduce((a, b) => a + b, 0) / completionHours.length
      : null,
  };

  /* Time series: always the whole period, bucket filter ignored. */
  const keys = bucketKeys(periodCurrent, granularity);
  const emptySeries = (names: string[]): SeriesPoint[] =>
    keys.map((key, index) => {
      const labels = bucketLabels(key, granularity);
      const partial = index === keys.length - 1;
      return {
        key,
        label: labels.label,
        longLabel: partial
          ? `${labels.longLabel} (${granularity === "day" ? "today" : "MTD"})`
          : labels.longLabel,
        partial,
        values: Object.fromEntries(names.map((name) => [name, 0])),
      };
    });
  const seriesIndex = (series: SeriesPoint[]) =>
    new Map(series.map((point) => [point.key, point]));

  const revenueSeries = emptySeries(["default", "contract"]);
  const revenueIndex = seriesIndex(revenueSeries);
  for (const quote of invoiced()) {
    if (!inRange(quote.date, periodCurrent)) continue;
    const point = revenueIndex.get(bucketKeyOf(quote.date, granularity));
    if (point)
      point.values[quote.quoteType] =
        (point.values[quote.quoteType] ?? 0) + quote.total;
  }

  const flowSeries = emptySeries(["created", "completed"]);
  const flowIndex = seriesIndex(flowSeries);
  for (const wo of workOrders()) {
    if (inRange(wo.createdAt, periodCurrent)) {
      const point = flowIndex.get(bucketKeyOf(wo.createdAt, granularity));
      if (point) point.values.created = (point.values.created ?? 0) + 1;
    }
    if (wo.doneAt && inRange(wo.doneAt, periodCurrent)) {
      const point = flowIndex.get(bucketKeyOf(wo.doneAt, granularity));
      if (point) point.values.completed = (point.values.completed ?? 0) + 1;
    }
  }

  const malfunctionSeries = emptySeries(["reported"]);
  const malfunctionIndex = seriesIndex(malfunctionSeries);
  for (const activity of storingAll) {
    if (!inRange(activity.reportedAt, periodCurrent)) continue;
    const point = malfunctionIndex.get(
      bucketKeyOf(activity.reportedAt, granularity),
    );
    if (point) point.values.reported = (point.values.reported ?? 0) + 1;
  }

  /* Distributions (respect the bucket/period, exclude their own dimension). */
  const woInRange = (exclude: Exclusion[]) =>
    workOrders(exclude).filter((wo) => inRange(wo.createdAt, range));
  const workOrderStatus = sliceUp(
    woInRange(["statusValue"]),
    (wo) => wo.statusValue,
    (wo) => wo.statusLabel,
    (wo) => wo.statusColor,
  );
  const workOrderTypes = sliceUp(
    woInRange(["woTypeValue"]),
    (wo) => wo.typeValue ?? "none",
    (wo) => wo.typeLabel,
    (wo) => wo.typeColor,
  );
  const activityTypes = sliceUp(
    activities(["activityTypeValue"]).filter((a) =>
      inRange(a.reportedAt, range),
    ),
    (a) => a.typeValue,
    (a) => a.typeLabel,
    (a) => a.typeColor,
  );

  /* Ranked lists. */
  const engineerMap = new Map<
    string,
    { name: string; done: number; open: number }
  >();
  for (const wo of workOrders(["engineerId"])) {
    if (!wo.engineerId) continue;
    const entry = engineerMap.get(wo.engineerId) ?? {
      name: wo.engineerName,
      done: 0,
      open: 0,
    };
    if (wo.doneAt && inRange(wo.doneAt, range)) entry.done += 1;
    if (wo.isOpen) entry.open += 1;
    engineerMap.set(wo.engineerId, entry);
  }
  const engineers: RankedDatum[] = [...engineerMap.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.name,
      secondary: `${entry.open} open`,
      value: entry.done,
      valueLabel: plural(entry.done, "job"),
    }))
    .filter((entry) => entry.value > 0 || engineerMap.size <= 8)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const clientMap = new Map<
    string,
    { name: string; revenue: number; count: number }
  >();
  for (const quote of invoiced(["clientId"]).filter((q) =>
    inRange(q.date, range),
  )) {
    if (!quote.clientId) continue;
    const entry = clientMap.get(quote.clientId) ?? {
      name: quote.clientName,
      revenue: 0,
      count: 0,
    };
    entry.revenue += quote.total;
    entry.count += 1;
    clientMap.set(quote.clientId, entry);
  }
  const topClients: RankedDatum[] = [...clientMap.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.name,
      secondary: plural(entry.count, "invoice"),
      value: entry.revenue,
      href: `/clients/${key}`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const assetMap = new Map<
    string,
    { name: string; model: string | null; client: string; count: number }
  >();
  for (const activity of activities(["assetId", "activityTypeValue"])) {
    if (
      activity.typeValue !== MALFUNCTION_TYPE ||
      !activity.assetId ||
      !inRange(activity.reportedAt, range)
    )
      continue;
    const entry = assetMap.get(activity.assetId) ?? {
      name: activity.assetName ?? "Unnamed asset",
      model: activity.assetModel,
      client: activity.clientName,
      count: 0,
    };
    entry.count += 1;
    assetMap.set(activity.assetId, entry);
  }
  const topAssets: RankedDatum[] = [...assetMap.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.name,
      secondary: [entry.model, entry.client].filter(Boolean).join(" · "),
      value: entry.count,
      valueLabel: plural(entry.count, "malfunction"),
      href: `/assets/${key}`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const articleMap = new Map<
    string,
    { name: string; quantity: number; revenue: number }
  >();
  for (const quote of invoicedNow) {
    for (const line of quote.lines) {
      const entry = articleMap.get(line.key) ?? {
        name: line.name,
        quantity: 0,
        revenue: 0,
      };
      entry.quantity += line.quantity;
      entry.revenue += line.revenue;
      articleMap.set(line.key, entry);
    }
  }
  const topArticles: RankedDatum[] = [...articleMap.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.name,
      secondary: `${Math.round(entry.quantity * 100) / 100} sold`,
      value: entry.revenue,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  /* Operational lists (not period-bound). */
  const weekAhead = nowMs + 7 * DAY_MS;
  const upcomingAll = openOrders
    .filter((wo) => {
      const time = wo.scheduledAt ? new Date(wo.scheduledAt).getTime() : null;
      return time !== null && time >= nowMs && time <= weekAhead;
    })
    .sort(
      (a, b) =>
        new Date(a.scheduledAt as string).getTime() -
        new Date(b.scheduledAt as string).getTime(),
    );
  const overdueAll = openOrders
    .filter(
      (wo) => wo.scheduledAt && new Date(wo.scheduledAt).getTime() < nowMs,
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt as string).getTime() -
        new Date(b.scheduledAt as string).getTime(),
    );
  const malfunctionsAll = storingAll
    .filter((a) => a.isOpen)
    .sort(
      (a, b) =>
        new Date(a.reportedAt).getTime() - new Date(b.reportedAt).getTime(),
    );
  const upcoming = upcomingAll.slice(0, 8);
  const overdue = overdueAll.slice(0, 6);
  const oldestMalfunctions = malfunctionsAll.slice(0, 6);

  /* Active-filter chips. */
  const nameOf = (dimension: FilterDimension): string | null => {
    const value = filters[dimension];
    if (!value) return null;
    switch (dimension) {
      case "bucket":
        return bucketLabels(value, value.length === 10 ? "day" : "month")
          .longLabel;
      case "clientId":
        return (
          data.workOrders.find((wo) => wo.clientId === value)?.clientName ??
          data.quotes.find((q) => q.clientId === value)?.clientName ??
          data.activities.find((a) => a.clientId === value)?.clientName ??
          "Client"
        );
      case "assetId":
        return (
          data.workOrders.find((wo) => wo.assetId === value)?.assetName ??
          data.activities.find((a) => a.assetId === value)?.assetName ??
          "Asset"
        );
      case "engineerId":
        return (
          data.workOrders.find((wo) => wo.engineerId === value)?.engineerName ??
          "Engineer"
        );
      case "statusValue":
        return (
          data.workOrders.find((wo) => wo.statusValue === value)?.statusLabel ??
          value
        );
      case "woTypeValue":
        return (
          data.workOrders.find((wo) => wo.typeValue === value)?.typeLabel ??
          value
        );
      case "activityTypeValue":
        return (
          data.activities.find((a) => a.typeValue === value)?.typeLabel ?? value
        );
    }
  };
  const chipLabels: Record<FilterDimension, string> = {
    bucket: granularity === "day" ? "Day" : "Month",
    clientId: "Client",
    assetId: "Asset",
    engineerId: "Engineer",
    statusValue: "Status",
    woTypeValue: "Work order type",
    activityTypeValue: "Activity type",
  };
  const chips = (Object.keys(chipLabels) as FilterDimension[]).flatMap(
    (dimension) => {
      const value = nameOf(dimension);
      return value ? [{ dimension, label: chipLabels[dimension], value }] : [];
    },
  );

  const rangeLabel = filters.bucket
    ? bucketLabels(
        filters.bucket,
        filters.bucket.length === 10 ? "day" : "month",
      ).longLabel
    : (PERIOD_OPTIONS.find((option) => option.value === filters.period)
        ?.label ?? "");

  return {
    granularity,
    rangeLabel,
    kpis,
    revenueSeries,
    flowSeries,
    malfunctionSeries,
    workOrderStatus,
    workOrderTypes,
    activityTypes,
    engineers,
    topClients,
    topAssets,
    topArticles,
    upcoming,
    overdue,
    oldestMalfunctions,
    sparks: {
      revenue: revenueSeries.map(
        (point) => (point.values.default ?? 0) + (point.values.contract ?? 0),
      ),
      completed: flowSeries.map((point) => point.values.completed ?? 0),
      malfunctions: malfunctionSeries.map(
        (point) => point.values.reported ?? 0,
      ),
    },
    totals: {
      revenue: revenueSeries.reduce(
        (sum, point) =>
          sum + (point.values.default ?? 0) + (point.values.contract ?? 0),
        0,
      ),
      created: flowSeries.reduce(
        (sum, point) => sum + (point.values.created ?? 0),
        0,
      ),
      completed: flowSeries.reduce(
        (sum, point) => sum + (point.values.completed ?? 0),
        0,
      ),
    },
    counts: {
      upcoming: upcomingAll.length,
      overdue: overdueAll.length,
      malfunctions: malfunctionsAll.length,
    },
    chips,
    isEmpty:
      data.workOrders.length === 0 &&
      data.activities.length === 0 &&
      data.quotes.length === 0,
  };
}

/** "+12%" / "-3%" style delta, or null when there is nothing to compare to. */
export function percentDelta(
  current: number,
  previous: number | null,
): { text: string; direction: "up" | "down" } | null {
  if (previous === null || previous === 0) return null;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change) || Math.abs(change) < 0.5) return null;
  return {
    text: `${change > 0 ? "+" : "-"}${Math.abs(Math.round(change))}%`,
    direction: change > 0 ? "up" : "down",
  };
}

/** Percentage-point delta for ratios such as margin. */
export function pointDelta(
  current: number,
  previous: number | null,
): { text: string; direction: "up" | "down" } | null {
  if (previous === null) return null;
  const change = current - previous;
  if (Math.abs(change) < 0.1) return null;
  return {
    text: `${change > 0 ? "+" : "-"}${Math.abs(change).toFixed(1)} pt`,
    direction: change > 0 ? "up" : "down",
  };
}
