"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle } from "@yourorg/ui/icons";
import {
  Badge,
  BarList,
  Button,
  Callout,
  ChartLegend,
  ChartPanel,
  ColumnChart,
  DonutChart,
  EmptyState,
  FilterChip,
  Grid,
  Inline,
  OverviewHeroBand,
  RecordList,
  StackedBar,
  Stack,
  StatStrip,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  TrendChart,
  ViewSwitcher,
  chartColor,
  resolveColor,
  type DonutSlice,
  type StatStripItem,
  type StatStripTrend,
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

function toSlices(data: SliceDatum[]): DonutSlice[] {
  return data.map((slice) => {
    const color = resolveColor(slice.color);
    return { key: slice.key, label: slice.label, value: slice.value, ...(color ? { color } : {}) };
  });
}

function toTrend(
  delta: { text: string; direction: "up" | "down" } | null,
  positiveWhen: "up" | "down" = "up",
): StatStripTrend | undefined {
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

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

/**
 * The cross-filtering dashboard. Holds the filter state, recomputes every
 * widget from the serialized dataset (`computeDashboard`) and mirrors the
 * filters into the URL (shareable) and the period into localStorage
 * (remembered per browser). Renders its own hero band (title, period switcher
 * and the KPI strip live in the band, so they share the filter state).
 * Rendered behind a mount gate: the figures are formatted with the viewer's
 * locale/timezone, which the server cannot know, so the skeleton is what
 * server-renders and hydration never mismatches.
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
  const periodSwitcher = (
    <ViewSwitcher<PeriodKey>
      aria-label="Dashboard period"
      value={filters.period}
      options={PERIOD_OPTIONS}
      onChange={(period) => setFilters((previous) => ({ ...previous, period, bucket: null }))}
    />
  );
  const subtitle = `${model.rangeLabel} · click any chart to filter`;

  if (!visible.workOrders && !visible.activities && !visible.finance) {
    return (
      <Stack gap="md">
        <OverviewHeroBand compact title="Dashboard" />
        <EmptyState
          heading="Nothing to show yet"
          text="The dashboard fills with work orders, malfunctions and revenue once those modules are enabled for you."
        />
      </Stack>
    );
  }
  if (model.isEmpty) {
    return (
      <Stack gap="md">
        <OverviewHeroBand compact title="Dashboard" />
        <EmptyState
          heading="No data yet"
          text="Create clients, work orders and quotes and your KPIs, charts and rankings will appear here."
        />
      </Stack>
    );
  }

  const { kpis, sparks, totals, counts } = model;
  const money = formatCurrency;
  const compact = (value: number) => compactMoney.format(value);
  const plain = (value: number) => value.toLocaleString();
  const vs = filters.bucket ? "vs prev." : "vs prev. period";

  const revenueDelta = percentDelta(kpis.revenue.value, kpis.revenue.previous);
  const marginDelta = pointDelta(kpis.marginPercent.value, kpis.marginPercent.previous);
  const avgDelta = percentDelta(kpis.averageInvoice.value, kpis.averageInvoice.previous);
  const completedDelta = percentDelta(kpis.completedWorkOrders.value, kpis.completedWorkOrders.previous);
  const malfunctionDelta = percentDelta(kpis.malfunctionsReported.value, kpis.malfunctionsReported.previous);

  const trendOf = (delta: ReturnType<typeof percentDelta>, positiveWhen?: "up" | "down") => {
    const trend = toTrend(delta, positiveWhen);
    return trend ? { trend } : {};
  };
  const finance = "Finance";
  const operations = "Operations";
  const items: StatStripItem[] = [];
  if (visible.finance) {
    items.push(
      {
        group: finance,
        label: "Revenue",
        value: <span title={money(kpis.revenue.value)}>{compact(kpis.revenue.value)}</span>,
        spark: sparks.revenue,
        ...trendOf(revenueDelta),
        hint: revenueDelta ? vs : `${kpis.invoiceCount} invoices`,
      },
      {
        group: finance,
        label: "Gross margin",
        value: kpis.revenue.value > 0 && kpis.marginPercent.value !== 0 ? `${kpis.marginPercent.value.toFixed(1)}%` : "—",
        ...trendOf(marginDelta),
        hint: marginDelta ? vs : "costed lines only",
      },
      {
        group: finance,
        label: "Draft pipeline",
        value: <span title={money(kpis.pipelineValue)}>{compact(kpis.pipelineValue)}</span>,
        hint: `${kpis.pipelineCount} draft quotes`,
      },
      {
        group: finance,
        label: "Avg. invoice",
        value: <span title={money(kpis.averageInvoice.value)}>{compact(kpis.averageInvoice.value)}</span>,
        ...trendOf(avgDelta),
        hint: avgDelta ? vs : `${kpis.invoiceCount} invoices`,
      },
    );
  }
  if (visible.workOrders) {
    items.push(
      {
        group: operations,
        label: "Open work orders",
        value: plain(kpis.openWorkOrders),
        hint: `${kpis.unscheduledWorkOrders} unscheduled · ${kpis.awaitingReview} review`,
      },
      { group: operations, label: "Overdue", value: plain(kpis.overdueWorkOrders), hint: "scheduled, still open" },
    );
  }
  if (visible.activities) {
    items.push({
      group: operations,
      label: "Open malfunctions",
      value: plain(kpis.openMalfunctions),
      spark: sparks.malfunctions,
      ...trendOf(malfunctionDelta, "down"),
      hint: malfunctionDelta ? vs : `${kpis.malfunctionsReported.value} reported`,
    });
  }
  if (visible.workOrders) {
    items.push({
      group: operations,
      label: "Completed",
      value: plain(kpis.completedWorkOrders.value),
      spark: sparks.completed,
      ...trendOf(completedDelta),
      hint: `avg. ${formatHours(kpis.averageCompletionHours)} to done`,
    });
  }

  const showTimeLabel = model.granularity === "day" ? "day" : "month";
  const bucketSelect = (key: string | null) => setValue("bucket", key);
  const backlogGrowth = totals.created - totals.completed;

  const hasListTabs = visible.workOrders || visible.activities;
  const defaultTab = visible.workOrders && counts.overdue > 0 ? "overdue" : visible.workOrders ? "upcoming" : "malfunctions";
  const mixVisible = visible.activities || visible.workOrders;

  return (
    <Stack gap="md">
      <OverviewHeroBand compact title="Dashboard" subtitle={subtitle} actions={periodSwitcher}>
        <StatStrip compact items={items} />
      </OverviewHeroBand>

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

      {dataset.truncated ? (
        <Callout icon={AlertTriangle}>
          Large dataset: some queries hit their row limit, so older figures may be understated.
        </Callout>
      ) : null}

      {visible.workOrders ? (
        <Grid columns="2-1-1">
          <ChartPanel
            title="Work orders created vs completed"
            subtitle={`Net backlog growth: ${signed(backlogGrowth)} (${totals.created} created, ${totals.completed} completed)`}
            actions={
              <ChartLegend
                items={[
                  { key: "created", label: "Created", color: chartColor(0) },
                  { key: "completed", label: "Completed", color: chartColor(2) },
                ]}
              />
            }
          >
            <TrendChart
              area
              hideLegend
              height={200}
              ariaLabel="Work orders created versus completed"
              points={model.flowSeries}
              series={[
                { key: "created", label: "Created", color: chartColor(0) },
                { key: "completed", label: "Completed", color: chartColor(2) },
              ]}
              formatAxis={plain}
              selectedKey={filters.bucket}
              onSelect={bucketSelect}
            />
          </ChartPanel>
          <ChartPanel title="Work orders by status" subtitle="Created in the selected range">
            <DonutChart
              compact
              size={132}
              ariaLabel="Work orders by status"
              centerLabel="Work orders"
              slices={toSlices(model.workOrderStatus)}
              selectedKey={filters.statusValue}
              onSelect={(key) => setValue("statusValue", key)}
            />
          </ChartPanel>
          <ChartPanel title="Engineer workload" subtitle="Jobs completed in range">
            <BarList
              compact
              ariaLabel="Jobs completed per engineer"
              items={rankedItems(model.engineers, null)}
              selectedKey={filters.engineerId}
              onSelect={(key) => setValue("engineerId", key)}
              emptyLabel="No assigned work orders"
              color={chartColor(2)}
            />
          </ChartPanel>
        </Grid>
      ) : null}

      {visible.finance ? (
        <Grid columns="2-1">
          <ChartPanel
            title={`Revenue per ${showTimeLabel}`}
            subtitle={`${compact(totals.revenue)} total · invoiced quotes by invoice date`}
            actions={
              <ChartLegend
                items={[
                  { key: "default", label: "Standard", color: chartColor(0) },
                  { key: "contract", label: "Contract", color: chartColor(1) },
                ]}
              />
            }
          >
            <ColumnChart
              hideLegend
              height={260}
              ariaLabel={`Revenue per ${showTimeLabel}`}
              points={model.revenueSeries}
              series={[
                { key: "default", label: "Standard", color: chartColor(0) },
                { key: "contract", label: "Contract", color: chartColor(1) },
              ]}
              formatValue={money}
              formatAxis={compact}
              selectedKey={filters.bucket}
              onSelect={bucketSelect}
            />
          </ChartPanel>
          <ChartPanel
            title="Top clients by revenue"
            {...(links.clients ? { link: { label: "All clients", href: "/clients" } } : {})}
          >
            <BarList
              ariaLabel="Top clients by revenue"
              items={rankedItems(model.topClients, links.clients ? "/clients" : null)}
              formatValue={money}
              selectedKey={filters.clientId}
              onSelect={(key) => setValue("clientId", key)}
              emptyLabel="No invoiced revenue in this range"
              color={chartColor(0)}
            />
          </ChartPanel>
        </Grid>
      ) : null}

      {visible.activities || mixVisible ? (
        <Grid columns={3}>
          {visible.activities ? (
            <ChartPanel
              title="Malfunctions reported"
              subtitle={`${kpis.malfunctionsReported.value} in range${malfunctionDelta ? ` · ${malfunctionDelta.text} ${vs}` : ""}`}
            >
              <ColumnChart
                height={170}
                ariaLabel={`Malfunctions reported per ${showTimeLabel}`}
                points={model.malfunctionSeries}
                series={[{ key: "reported", label: "Malfunctions reported", color: chartColor(3) }]}
                formatAxis={plain}
                selectedKey={filters.bucket}
                onSelect={bucketSelect}
              />
            </ChartPanel>
          ) : null}
          {visible.activities ? (
            <ChartPanel title="Assets with most malfunctions">
              <BarList
                secondaryInline
                ariaLabel="Assets with most malfunctions"
                items={rankedItems(model.topAssets, links.assets ? "/assets" : null)}
                selectedKey={filters.assetId}
                onSelect={(key) => setValue("assetId", key)}
                emptyLabel="No malfunctions reported in this range"
                color={chartColor(3)}
              />
            </ChartPanel>
          ) : null}
          {mixVisible ? (
            <ChartPanel title="Mix by type" subtitle="Click a segment to filter">
              <Stack gap="md">
                {visible.activities ? (
                  <StackedBar
                    title="Activities"
                    ariaLabel="Activities by type"
                    slices={toSlices(model.activityTypes)}
                    selectedKey={filters.activityTypeValue}
                    onSelect={(key) => setValue("activityTypeValue", key)}
                  />
                ) : null}
                {visible.workOrders ? (
                  <StackedBar
                    title="Work orders"
                    ariaLabel="Work orders by type"
                    slices={toSlices(model.workOrderTypes)}
                    selectedKey={filters.woTypeValue}
                    onSelect={(key) => setValue("woTypeValue", key)}
                  />
                ) : null}
              </Stack>
            </ChartPanel>
          ) : null}
        </Grid>
      ) : null}

      {hasListTabs || visible.finance ? (
        <Grid columns={hasListTabs && visible.finance ? "2-1" : 1}>
          {hasListTabs ? (
            <ListsPanel
              defaultTab={defaultTab}
              visible={visible}
              links={links}
              model={model}
              counts={counts}
            />
          ) : null}
          {visible.finance ? (
            <ChartPanel title="Top-selling lines" subtitle="Invoiced line items by revenue">
              <BarList
                compact
                ariaLabel="Top-selling invoice lines"
                items={rankedItems(model.topArticles, null)}
                formatValue={money}
                emptyLabel="No invoiced lines in this range"
                color={chartColor(1)}
              />
            </ChartPanel>
          ) : null}
        </Grid>
      ) : null}
    </Stack>
  );
}

function ListsPanel({
  defaultTab,
  visible,
  links,
  model,
  counts,
}: {
  defaultTab: string;
  visible: DashboardDataset["visible"];
  links: DashboardViewProps["links"];
  model: ReturnType<typeof computeDashboard>;
  counts: { upcoming: number; overdue: number; malfunctions: number };
}) {
  const workOrderHref = (id: string) => (links.workOrders ? { href: `/work-orders/${id}` } : {});
  return (
    <ChartPanel title="Work to watch" subtitle="Not affected by the period">
      <Tabs defaultValue={defaultTab}>
        <TabsList aria-label="Work to watch">
          {visible.workOrders ? (
            <TabsTab value="upcoming">
              Next 7 days <Badge>{counts.upcoming}</Badge>
            </TabsTab>
          ) : null}
          {visible.workOrders ? (
            <TabsTab value="overdue">
              Overdue <Badge variant={counts.overdue > 0 ? "danger" : undefined}>{counts.overdue}</Badge>
            </TabsTab>
          ) : null}
          {visible.activities ? (
            <TabsTab value="malfunctions">
              Oldest malfunctions <Badge>{counts.malfunctions}</Badge>
            </TabsTab>
          ) : null}
        </TabsList>
        {visible.workOrders ? (
          <TabsPanel value="upcoming">
            <RecordList
              ariaLabel="Upcoming work orders"
              emptyLabel="Nothing scheduled this week"
              {...(links.workOrders ? { footerLink: { label: "Open planning", href: "/planning" } } : {})}
              items={model.upcoming.map((wo) => ({
                key: wo.id,
                title: wo.title,
                subtitle: `${wo.clientName} - ${wo.engineerName}`,
                meta: formatDateTime(wo.scheduledAt, { year: false }),
                ...workOrderHref(wo.id),
              }))}
            />
          </TabsPanel>
        ) : null}
        {visible.workOrders ? (
          <TabsPanel value="overdue">
            <RecordList
              ariaLabel="Overdue work orders"
              emptyLabel="Nothing is overdue"
              {...(links.workOrders ? { footerLink: { label: "All overdue work orders", href: "/work-orders" } } : {})}
              items={model.overdue.map((wo) => ({
                key: wo.id,
                title: wo.title,
                subtitle: `${wo.clientName} - ${wo.engineerName}`,
                meta: `${formatDurationSince(wo.scheduledAt)} late`,
                metaTone: "danger" as const,
                ...workOrderHref(wo.id),
              }))}
            />
          </TabsPanel>
        ) : null}
        {visible.activities ? (
          <TabsPanel value="malfunctions">
            <RecordList
              ariaLabel="Oldest open malfunctions"
              emptyLabel="No open malfunctions"
              {...(links.activities ? { footerLink: { label: "All open malfunctions", href: "/activities" } } : {})}
              items={model.oldestMalfunctions.map((activity) => ({
                key: activity.id,
                title: activity.assetName ?? activity.clientName,
                subtitle: activity.summary ? `${activity.clientName} - ${activity.summary}` : activity.clientName,
                meta: formatDurationSince(activity.reportedAt),
                metaTone: "warning" as const,
                ...(links.activities ? { href: `/activities/${activity.id}` } : {}),
              }))}
            />
          </TabsPanel>
        ) : null}
      </Tabs>
    </ChartPanel>
  );
}

