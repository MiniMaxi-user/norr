"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ClipboardList,
  Clock,
  FileText,
  Receipt,
  Users,
  Boxes,
  type Icon,
} from "@yourorg/ui/icons";
import {
  BarList,
  Button,
  Callout,
  Card,
  ColumnChart,
  DonutChart,
  EmptyState,
  FilterChip,
  Grid,
  Inline,
  RecordList,
  SectionHeader,
  Stack,
  StatCard,
  Text,
  TrendChart,
  ViewSwitcher,
  chartColor,
  resolveColor,
  type DonutSlice,
  type StatCardTrend,
} from "@yourorg/ui";
import { formatCurrency } from "@/lib/format/currency";
import { formatDateTime, formatDurationSince } from "@/lib/format/date";
import {
  EMPTY_FILTERS,
  PERIOD_OPTIONS,
  computeDashboard,
  hasActiveFilters,
  parsePeriod,
  percentDelta,
  pointDelta,
  serializeFilters,
  type DashboardFilters,
  type FilterDimension,
  type PeriodKey,
  type RankedDatum,
  type SliceDatum,
} from "@/lib/dashboard/compute";
import type { DashboardDataset } from "@/lib/dashboard/types";
import { DashboardSkeleton } from "./dashboard-skeleton";

const PERIOD_STORAGE_KEY = "norr.dashboard.period";

const compactMoney = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export interface DashboardViewProps {
  dataset: DashboardDataset;
  initialFilters: DashboardFilters;
  /** Which record detail pages the viewer may open (so rows only link where it will not 404). */
  links: { clients: boolean; assets: boolean; workOrders: boolean; activities: boolean };
}

const subscribeNoop = () => () => {};

function Panel({ icon, title, hint, children }: { icon: Icon; title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <Stack gap="md">
        <SectionHeader icon={icon} title={title} />
        {hint ? <Text tone="muted">{hint}</Text> : null}
        {children}
      </Stack>
    </Card>
  );
}


function toSlices(data: SliceDatum[]): DonutSlice[] {
  return data.map((slice) => {
    const color = resolveColor(slice.color);
    return { key: slice.key, label: slice.label, value: slice.value, ...(color ? { color } : {}) };
  });
}

function toTrend(
  delta: { text: string; direction: "up" | "down" } | null,
  positiveWhen: "up" | "down" = "up",
): StatCardTrend | undefined {
  return delta ? { value: delta.text, direction: delta.direction, positiveWhen } : undefined;
}

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}

function rankedItems(items: RankedDatum[], baseHref: string | null) {
  return items.map((item) => ({
    key: item.key,
    label: item.label,
    secondary: item.secondary,
    value: item.value,
    ...(item.valueLabel ? { valueLabel: item.valueLabel } : {}),
    ...(baseHref ? { href: `${baseHref}/${item.key}` } : {}),
  }));
}

/**
 * The cross-filtering dashboard. Holds the filter state, recomputes every
 * widget from the serialized dataset (`computeDashboard`) and mirrors the
 * filters into the URL (shareable) and the period into localStorage
 * (remembered per browser). Rendered behind a mount gate: the figures are
 * formatted with the viewer's locale/timezone, which the server cannot know,
 * so the skeleton is what server-renders and hydration never mismatches.
 */
export function DashboardView({ dataset, initialFilters, links }: DashboardViewProps) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const [filters, setFilters] = useState<DashboardFilters>(() => {
    if (typeof window === "undefined" || new URLSearchParams(window.location.search).has("period")) {
      return initialFilters;
    }
    const stored = parsePeriod(window.localStorage.getItem(PERIOD_STORAGE_KEY));
    return stored && stored !== initialFilters.period ? { ...initialFilters, period: stored, bucket: null } : initialFilters;
  });

  useEffect(() => {
    const query = serializeFilters(filters).toString();
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
    window.localStorage.setItem(PERIOD_STORAGE_KEY, filters.period);
  }, [filters]);

  const setValue = useCallback((dimension: FilterDimension, value: string | null) => {
    setFilters((previous) => ({ ...previous, [dimension]: value }));
  }, []);
  const clearAll = useCallback(() => {
    setFilters((previous) => ({ ...EMPTY_FILTERS, period: previous.period }));
  }, []);

  const model = useMemo(() => computeDashboard(dataset, filters), [dataset, filters]);

  if (!mounted) return <DashboardSkeleton />;

  const { visible } = dataset;
  if (!visible.workOrders && !visible.activities && !visible.finance) {
    return (
      <EmptyState
        heading="Nothing to show yet"
        text="The dashboard fills with work orders, malfunctions and revenue once those modules are enabled for you."
      />
    );
  }
  if (model.isEmpty) {
    return (
      <EmptyState
        heading="No data yet"
        text="Create clients, work orders and quotes and your KPIs, charts and rankings will appear here."
      />
    );
  }

  const { kpis } = model;
  const canFilterBy = (dimension: FilterDimension, value: string | null) => setValue(dimension, value);
  const money = formatCurrency;
  const compact = (value: number) => compactMoney.format(value);
  const plain = (value: number) => value.toLocaleString();

  const revenueDelta = percentDelta(kpis.revenue.value, kpis.revenue.previous);
  const marginDelta = pointDelta(kpis.marginPercent.value, kpis.marginPercent.previous);
  const avgDelta = percentDelta(kpis.averageInvoice.value, kpis.averageInvoice.previous);
  const completedDelta = percentDelta(kpis.completedWorkOrders.value, kpis.completedWorkOrders.previous);
  const malfunctionDelta = percentDelta(kpis.malfunctionsReported.value, kpis.malfunctionsReported.previous);
  const comparison = filters.bucket ? "vs previous" : "vs previous period";

  const showTimeLabel = model.granularity === "day" ? "day" : "month";

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Inline justify="between" wrap gap="md">
          <ViewSwitcher<PeriodKey>
            aria-label="Dashboard period"
            value={filters.period}
            options={PERIOD_OPTIONS}
            onChange={(period) => setFilters((previous) => ({ ...previous, period, bucket: null }))}
          />
          <Text tone="muted">
            Showing {model.rangeLabel.toLowerCase()} - click any chart or list to filter the whole dashboard
          </Text>
        </Inline>
        {hasActiveFilters(filters) ? (
          <Inline gap="sm" wrap>
            {model.chips.map((chip) => (
              <FilterChip key={chip.dimension} label={chip.label} onRemove={() => setValue(chip.dimension, null)}>
                {chip.value}
              </FilterChip>
            ))}
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          </Inline>
        ) : null}
      </Stack>

      {dataset.truncated ? (
        <Callout icon={AlertTriangle}>
          Large dataset: some queries hit their row limit, so older figures may be understated.
        </Callout>
      ) : null}

      {visible.finance ? (
        <Grid columns={4}>
          <StatCard
            tone="highlight"
            icon={Receipt}
            label="Revenue (invoiced)"
            value={money(kpis.revenue.value)}
            trend={toTrend(revenueDelta)}
            hint={revenueDelta ? comparison : plural(kpis.invoiceCount, "invoice")}
          />
          <StatCard
            icon={BarChart3}
            label="Gross margin"
            value={kpis.revenue.value > 0 && kpis.marginPercent.value !== 0 ? `${kpis.marginPercent.value.toFixed(1)}%` : "—"}
            trend={toTrend(marginDelta)}
            hint={marginDelta ? comparison : "On lines with a purchase price"}
          />
          <StatCard
            icon={FileText}
            label="Draft pipeline"
            value={money(kpis.pipelineValue)}
            hint={`${plural(kpis.pipelineCount, "draft quote")} not yet invoiced`}
          />
          <StatCard
            icon={Receipt}
            label="Average invoice"
            value={money(kpis.averageInvoice.value)}
            trend={toTrend(avgDelta)}
            hint={avgDelta ? comparison : `${plural(kpis.invoiceCount, "invoice")} in range`}
          />
        </Grid>
      ) : null}

      {visible.workOrders || visible.activities ? (
        <Grid columns={4}>
          {visible.workOrders ? (
            <>
              <StatCard
                icon={ClipboardList}
                label="Open work orders"
                value={plain(kpis.openWorkOrders)}
                hint={`${kpis.unscheduledWorkOrders} unscheduled - ${kpis.awaitingReview} awaiting review`}
              />
              <StatCard
                icon={Clock}
                label="Overdue work orders"
                value={plain(kpis.overdueWorkOrders)}
                hint="Scheduled in the past, still open"
              />
            </>
          ) : null}
          {visible.activities ? (
            <StatCard
              icon={AlertTriangle}
              label="Open malfunctions"
              value={plain(kpis.openMalfunctions)}
              trend={toTrend(malfunctionDelta, "down")}
              hint={`${kpis.malfunctionsReported.value} reported ${malfunctionDelta ? comparison : "in range"}`}
            />
          ) : null}
          {visible.workOrders ? (
            <StatCard
              icon={Check}
              label="Completed work orders"
              value={plain(kpis.completedWorkOrders.value)}
              trend={toTrend(completedDelta)}
              hint={`Avg. ${formatHours(kpis.averageCompletionHours)} from creation to done`}
            />
          ) : null}
        </Grid>
      ) : null}

      {visible.finance ? (
        <Grid columns={"2-1"}>
          <Panel
            icon={Receipt}
            title={`Revenue per ${showTimeLabel}`}
            hint="Invoiced quotes by invoice date. Click a bar to focus on that period."
          >
            <ColumnChart
              ariaLabel={`Revenue per ${showTimeLabel}`}
              points={model.revenueSeries}
              series={[
                { key: "default", label: "Standard", color: chartColor(0) },
                { key: "contract", label: "Contract", color: chartColor(1) },
              ]}
              formatValue={money}
              formatAxis={compact}
              selectedKey={filters.bucket}
              onSelect={(key) => canFilterBy("bucket", key)}
            />
          </Panel>
          <Panel icon={Users} title="Top clients by revenue">
            <BarList
              ariaLabel="Top clients by revenue"
              items={rankedItems(model.topClients, links.clients ? "/clients" : null)}
              formatValue={money}
              selectedKey={filters.clientId}
              onSelect={(key) => canFilterBy("clientId", key)}
              emptyLabel="No invoiced revenue in this range"
              color={chartColor(0)}
            />
          </Panel>
        </Grid>
      ) : null}

      {visible.workOrders ? (
        <Grid columns={"2-1"}>
          <Panel
            icon={ClipboardList}
            title={`Work orders created vs completed per ${showTimeLabel}`}
            hint="Click a point to focus on that period."
          >
            <TrendChart
              area
              ariaLabel="Work orders created versus completed"
              points={model.flowSeries}
              series={[
                { key: "created", label: "Created", color: chartColor(0) },
                { key: "completed", label: "Completed", color: chartColor(2) },
              ]}
              formatAxis={plain}
              selectedKey={filters.bucket}
              onSelect={(key) => canFilterBy("bucket", key)}
            />
          </Panel>
          <Panel icon={ClipboardList} title="Work orders by status" hint="Created in the selected range.">
            <DonutChart
              ariaLabel="Work orders by status"
              centerLabel="Work orders"
              slices={toSlices(model.workOrderStatus)}
              selectedKey={filters.statusValue}
              onSelect={(key) => canFilterBy("statusValue", key)}
            />
          </Panel>
        </Grid>
      ) : null}

      {visible.activities ? (
        <Grid columns={"2-1"}>
          <Panel
            icon={AlertTriangle}
            title={`Malfunctions per ${showTimeLabel}`}
            hint="Reported malfunctions (storingen). Click a bar to focus on that period."
          >
            <ColumnChart
              ariaLabel={`Malfunctions reported per ${showTimeLabel}`}
              points={model.malfunctionSeries}
              series={[{ key: "reported", label: "Malfunctions reported", color: chartColor(3) }]}
              formatAxis={plain}
              selectedKey={filters.bucket}
              onSelect={(key) => canFilterBy("bucket", key)}
            />
          </Panel>
          <Panel icon={AlertTriangle} title="Assets with most malfunctions">
            <BarList
              ariaLabel="Assets with most malfunctions"
              items={rankedItems(model.topAssets, links.assets ? "/assets" : null)}
              selectedKey={filters.assetId}
              onSelect={(key) => canFilterBy("assetId", key)}
              emptyLabel="No malfunctions reported in this range"
              color={chartColor(3)}
            />
          </Panel>
        </Grid>
      ) : null}

      <Grid columns={3}>
        {visible.activities ? (
          <Panel icon={AlertTriangle} title="Activities by type">
            <DonutChart
              ariaLabel="Activities by type"
              centerLabel="Activities"
              size={148}
              slices={toSlices(model.activityTypes)}
              selectedKey={filters.activityTypeValue}
              onSelect={(key) => canFilterBy("activityTypeValue", key)}
            />
          </Panel>
        ) : null}
        {visible.workOrders ? (
          <Panel icon={ClipboardList} title="Work orders by type">
            <DonutChart
              ariaLabel="Work orders by type"
              centerLabel="Work orders"
              size={148}
              slices={toSlices(model.workOrderTypes)}
              selectedKey={filters.woTypeValue}
              onSelect={(key) => canFilterBy("woTypeValue", key)}
            />
          </Panel>
        ) : null}
        {visible.workOrders ? (
          <Panel icon={Users} title="Engineer workload" hint="Jobs completed in the selected range.">
            <BarList
              ariaLabel="Jobs completed per engineer"
              items={rankedItems(model.engineers, null)}
              selectedKey={filters.engineerId}
              onSelect={(key) => canFilterBy("engineerId", key)}
              emptyLabel="No assigned work orders"
              color={chartColor(2)}
            />
          </Panel>
        ) : null}
      </Grid>

      <Grid columns={3}>
        {visible.workOrders ? (
          <Panel icon={CalendarDays} title="Scheduled in the next 7 days">
            <RecordList
              ariaLabel="Upcoming work orders"
              emptyLabel="Nothing scheduled this week"
              items={model.upcoming.map((wo) => ({
                key: wo.id,
                title: wo.title,
                subtitle: `${wo.clientName} - ${wo.engineerName}`,
                meta: formatDateTime(wo.scheduledAt, { year: false }),
                ...(links.workOrders ? { href: `/work-orders/${wo.id}` } : {}),
              }))}
            />
          </Panel>
        ) : null}
        {visible.workOrders ? (
          <Panel icon={Clock} title="Overdue work orders">
            <RecordList
              ariaLabel="Overdue work orders"
              emptyLabel="Nothing is overdue"
              items={model.overdue.map((wo) => ({
                key: wo.id,
                title: wo.title,
                subtitle: `${wo.clientName} - ${wo.engineerName}`,
                meta: `${formatDurationSince(wo.scheduledAt)} late`,
                metaTone: "danger" as const,
                ...(links.workOrders ? { href: `/work-orders/${wo.id}` } : {}),
              }))}
            />
          </Panel>
        ) : null}
        {visible.activities ? (
          <Panel icon={AlertTriangle} title="Oldest open malfunctions">
            <RecordList
              ariaLabel="Oldest open malfunctions"
              emptyLabel="No open malfunctions"
              items={model.oldestMalfunctions.map((activity) => ({
                key: activity.id,
                title: activity.assetName ?? activity.clientName,
                subtitle: activity.summary ? `${activity.clientName} - ${activity.summary}` : activity.clientName,
                meta: formatDurationSince(activity.reportedAt),
                metaTone: "warning" as const,
                ...(links.activities ? { href: `/activities/${activity.id}` } : {}),
              }))}
            />
          </Panel>
        ) : null}
      </Grid>

      {visible.finance ? (
        <Panel icon={Boxes} title="Top-selling lines" hint="Invoiced line items by revenue in the selected range.">
          <BarList
            ariaLabel="Top-selling invoice lines"
            items={rankedItems(model.topArticles, null)}
            formatValue={money}
            emptyLabel="No invoiced lines in this range"
            color={chartColor(1)}
          />
        </Panel>
      ) : null}
    </Stack>
  );
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

