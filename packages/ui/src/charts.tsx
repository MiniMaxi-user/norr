"use client";
// Chart primitives (dashboard, 2026-10): hand-rolled SVG, data-agnostic,
// no third-party chart dependency. Every chart is controlled for selection
// (`selectedKey` + `onSelect`) so a screen can use any click as a
// cross-filter; non-selected items dim. Hover/focus show a detailed tooltip.
// Owns hover state and a ResizeObserver, so — like combobox.tsx — it needs its
// own dedicated "use client" tsup build entry at the top level of `src/` (see
// tsup.config.ts's top-of-file comment).

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { cx } from "./cx";
import { ChevronRight } from "./icons";

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

const PALETTE_SIZE = 8;

/** CSS color for the nth categorical series (`--ui-chart-1..8`, theme-aware). */
export function chartColor(index: number): string {
  return `var(--ui-chart-${(((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE) + 1})`;
}

const compactFormatter = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
function defaultAxisFormat(value: number): string {
  return compactFormatter.format(value);
}
function defaultValueFormat(value: number): string {
  return value.toLocaleString();
}

/** "Nice" axis maximum + step for roughly `ticks` gridlines. */
function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const rough = max / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = nice * magnitude;
  return { max: Math.ceil(max / step) * step, step };
}

function useContainerWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (next: number) => setWidth(Math.max(240, Math.floor(next)));
    update(element.clientWidth || fallback);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallback]);
  return { ref, width };
}

function activateOnKey(event: KeyboardEvent, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

/* ------------------------------------------------------------------ *
 * Legend
 * ------------------------------------------------------------------ */

export interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  /** Optional formatted value shown after the label. */
  value?: ReactNode;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  className?: string;
}

/** Row of colored keys; becomes a set of toggle buttons when `onSelect` is set. */
export function ChartLegend({ items, selectedKey = null, onSelect, className }: ChartLegendProps) {
  return (
    <ul className={cx("ui-chart-legend", className)}>
      {items.map((item) => {
        const dim = selectedKey !== null && selectedKey !== item.key;
        const content = (
          <>
            <span className="ui-chart-legend-swatch" style={{ background: item.color }} />
            <span className="ui-chart-legend-label">{item.label}</span>
            {item.value !== undefined ? <span className="ui-chart-legend-value">{item.value}</span> : null}
          </>
        );
        return (
          <li key={item.key} className={cx("ui-chart-legend-item", dim && "ui-chart-dim")}>
            {onSelect ? (
              <button
                type="button"
                className="ui-chart-legend-button"
                aria-pressed={selectedKey === item.key}
                onClick={() => onSelect(selectedKey === item.key ? null : item.key)}
              >
                {content}
              </button>
            ) : (
              <span className="ui-chart-legend-button">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */

interface TooltipRow {
  color: string;
  label: string;
  value: string;
}

function ChartTooltip({
  x,
  y,
  width,
  title,
  rows,
  footer,
}: {
  x: number;
  y: number;
  width: number;
  title: string;
  rows: TooltipRow[];
  footer?: TooltipRow;
}) {
  const left = Math.min(Math.max(x, 90), Math.max(90, width - 90));
  return (
    <div className="ui-chart-tooltip" role="presentation" style={{ left, top: y }}>
      <div className="ui-chart-tooltip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="ui-chart-tooltip-row">
          <span className="ui-chart-legend-swatch" style={{ background: row.color }} />
          <span className="ui-chart-tooltip-label">{row.label}</span>
          <span className="ui-chart-tooltip-value">{row.value}</span>
        </div>
      ))}
      {footer ? (
        <div className="ui-chart-tooltip-row ui-chart-tooltip-footer">
          <span className="ui-chart-tooltip-label">{footer.label}</span>
          <span className="ui-chart-tooltip-value">{footer.value}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Series charts (Column + Trend) — shared types & frame
 * ------------------------------------------------------------------ */

export interface ChartSeries {
  key: string;
  label: string;
  /** Any CSS color; defaults to the palette color for the series' index. */
  color?: string;
}

export interface ChartPoint {
  key: string;
  /** Short axis label (e.g. "Oct"). */
  label: string;
  /** Longer label for the tooltip/aria (e.g. "October 2026"). */
  longLabel?: string;
  /** Still-running bucket (month or day to date): drawn dimmed. */
  partial?: boolean;
  values: Record<string, number>;
}

interface SeriesChartBaseProps {
  points: ChartPoint[];
  series: ChartSeries[];
  /** Tooltip / aria value formatter. */
  formatValue?: (value: number) => string;
  /** Y-axis tick formatter (defaults to compact notation). */
  formatAxis?: (value: number) => string;
  height?: number;
  ariaLabel: string;
  /** Currently selected point key (cross-filter). */
  selectedKey?: string | null;
  /** Fired with the clicked point's key, or `null` when it is clicked again. */
  onSelect?: (key: string | null) => void;
  /** Hide the built-in legend (when a screen renders its own). */
  hideLegend?: boolean;
  className?: string;
}

const MARGIN = { top: 10, right: 10, bottom: 26, left: 46 };

function resolveSeries(series: ChartSeries[]) {
  return series.map((entry, index) => ({ ...entry, color: entry.color ?? chartColor(index) }));
}

interface FrameArgs extends SeriesChartBaseProps {
  stacked: boolean;
  children: (ctx: {
    width: number;
    plotW: number;
    plotH: number;
    band: number;
    scaleY: (value: number) => number;
    resolved: ReturnType<typeof resolveSeries>;
    hovered: number | null;
    setHovered: (index: number | null) => void;
    select: (index: number) => void;
  }) => ReactNode;
}

function SeriesChartFrame(props: FrameArgs) {
  const {
    points,
    series,
    stacked,
    formatValue = defaultValueFormat,
    formatAxis = defaultAxisFormat,
    height = 240,
    ariaLabel,
    selectedKey = null,
    onSelect,
    hideLegend,
    className,
    children,
  } = props;
  const { ref, width } = useContainerWidth();
  const [hovered, setHovered] = useState<number | null>(null);
  const resolved = resolveSeries(series);

  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const band = plotW / Math.max(points.length, 1);

  const totals = points.map((point) => {
    const vals = resolved.map((s) => point.values[s.key] ?? 0);
    return stacked ? vals.reduce((a, b) => a + b, 0) : Math.max(0, ...vals);
  });
  const { max, step } = niceScale(Math.max(0, ...totals));
  const scaleY = (value: number) => MARGIN.top + plotH - (value / max) * plotH;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max + step / 1000; tick += step) ticks.push(tick);

  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 54))));
  const hasData = totals.some((total) => total > 0);

  const select = (index: number) => {
    const point = points[index];
    if (!point || !onSelect) return;
    onSelect(selectedKey === point.key ? null : point.key);
  };

  const hoveredPoint = hovered !== null ? points[hovered] : null;
  const tooltipRows = hoveredPoint
    ? resolved.map((s) => ({ color: s.color, label: s.label, value: formatValue(hoveredPoint.values[s.key] ?? 0) }))
    : [];
  const tooltipTotal =
    hoveredPoint && hovered !== null && resolved.length > 1 && stacked
      ? { color: "", label: "Total", value: formatValue(totals[hovered] ?? 0) }
      : undefined;

  return (
    <div className={cx("ui-chart", className)}>
      {!hideLegend && resolved.length > 1 ? (
        <ChartLegend items={resolved.map((s) => ({ key: s.key, label: s.label, color: s.color }))} />
      ) : null}
      <div className="ui-chart-frame" ref={ref} style={{ height }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={ariaLabel}
          className="ui-chart-svg"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="ui-chart-grid"
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={scaleY(tick)}
                y2={scaleY(tick)}
              />
              <text className="ui-chart-axis-label" x={MARGIN.left - 8} y={scaleY(tick)} textAnchor="end" dy="0.32em">
                {formatAxis(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.key}
                className={cx("ui-chart-axis-label", selectedKey === point.key && "ui-chart-axis-label-active")}
                x={MARGIN.left + band * (index + 0.5)}
                y={height - 8}
                textAnchor="middle"
              >
                {point.label}
              </text>
            ) : null,
          )}
          {children({ width, plotW, plotH, band, scaleY, resolved, hovered, setHovered, select })}
          {/* Hit targets last so they sit on top; one focusable region per point. */}
          {points.map((point, index) => (
            <rect
              key={point.key}
              className="ui-chart-hit"
              x={MARGIN.left + band * index}
              y={MARGIN.top}
              width={band}
              height={plotH}
              tabIndex={0}
              role={onSelect ? "button" : "img"}
              aria-pressed={onSelect ? selectedKey === point.key : undefined}
              aria-label={`${point.longLabel ?? point.label}: ${resolved
                .map((s) => `${s.label} ${formatValue(point.values[s.key] ?? 0)}`)
                .join(", ")}`}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              onClick={() => select(index)}
              onKeyDown={(event) => activateOnKey(event, () => select(index))}
            />
          ))}
        </svg>
        {!hasData ? <div className="ui-chart-empty">No data for this period</div> : null}
        {hoveredPoint && hovered !== null ? (
          <ChartTooltip
            x={MARGIN.left + band * (hovered + 0.5)}
            y={4}
            width={width}
            title={hoveredPoint.longLabel ?? hoveredPoint.label}
            rows={tooltipRows}
            footer={tooltipTotal}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ColumnChart
 * ------------------------------------------------------------------ */

export interface ColumnChartProps extends SeriesChartBaseProps {
  /** Stack series on top of each other (default) instead of grouping. */
  stacked?: boolean;
}

/** Vertical bars per point; click a column to select (cross-filter). */
export function ColumnChart({ stacked = true, ...props }: ColumnChartProps) {
  const { points, selectedKey = null } = props;
  return (
    <SeriesChartFrame {...props} stacked={stacked}>
      {({ band, scaleY, resolved, hovered }) => {
        const groupWidth = Math.min(band * 0.64, 56 * (stacked ? 1 : resolved.length));
        const barWidth = stacked ? groupWidth : groupWidth / resolved.length;
        const baseline = scaleY(0);
        return (
          <g>
            {points.map((point, index) => {
              const dim = selectedKey !== null && selectedKey !== point.key;
              const groupX = MARGIN.left + band * index + (band - groupWidth) / 2;
              let stackTop = baseline;
              return (
                <g
                  key={point.key}
                  className={cx("ui-chart-column", dim && "ui-chart-dim", point.partial && "ui-chart-partial", hovered === index && "ui-chart-hot")}
                >
                  {selectedKey === point.key ? (
                    <rect
                      className="ui-chart-selected-band"
                      x={MARGIN.left + band * index}
                      y={MARGIN.top}
                      width={band}
                      height={baseline - MARGIN.top}
                      rx={6}
                    />
                  ) : null}
                  {resolved.map((s, seriesIndex) => {
                    const value = Math.max(0, point.values[s.key] ?? 0);
                    const barHeight = baseline - scaleY(value);
                    if (barHeight <= 0) return null;
                    const y = stacked ? stackTop - barHeight : baseline - barHeight;
                    const x = stacked ? groupX : groupX + seriesIndex * barWidth;
                    if (stacked) stackTop -= barHeight;
                    return (
                      <rect
                        key={s.key}
                        className="ui-chart-bar"
                        x={x + (stacked ? 0 : 1)}
                        y={y}
                        width={Math.max(2, barWidth - (stacked ? 0 : 2))}
                        height={barHeight}
                        rx={3}
                        style={{ fill: s.color, animationDelay: `${index * 18}ms` }}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      }}
    </SeriesChartFrame>
  );
}

/* ------------------------------------------------------------------ *
 * TrendChart (line / area)
 * ------------------------------------------------------------------ */

export interface TrendChartProps extends SeriesChartBaseProps {
  /** Fill under each line with a soft gradient. */
  area?: boolean;
  /** Stack areas (only meaningful with `area`). */
  stacked?: boolean;
}

/** Line/area trend with hover crosshair; click a point to select it. */
export function TrendChart({ area = false, stacked = false, ...props }: TrendChartProps) {
  const { points, selectedKey = null } = props;
  const gradientBase = useId().replace(/:/g, "");
  return (
    <SeriesChartFrame {...props} stacked={stacked && area}>
      {({ band, plotH, scaleY, resolved, hovered }) => {
        const xAt = (index: number) => MARGIN.left + band * (index + 0.5);
        const baseline = scaleY(0);
        const cumulative = points.map(() => 0);
        return (
          <g>
            {resolved.map((s) => {
              const lower = [...cumulative];
              const values = points.map((point, index) => {
                const value = Math.max(0, point.values[s.key] ?? 0);
                if (stacked && area) cumulative[index] = (cumulative[index] ?? 0) + value;
                return stacked && area ? (cumulative[index] ?? 0) : value;
              });
              const linePoints = values.map((value, index) => `${xAt(index)},${scaleY(value)}`);
              const gradientId = `${gradientBase}-${s.key}`;
              const areaPath =
                points.length > 0
                  ? `M${xAt(0)},${stacked ? scaleY(lower[0] ?? 0) : baseline} L${linePoints.join(" L")} L${xAt(points.length - 1)},${
                      stacked ? scaleY(lower[points.length - 1] ?? 0) : baseline
                    } ${
                      stacked
                        ? [...points.keys()]
                            .reverse()
                            .map((index) => `L${xAt(index)},${scaleY(lower[index] ?? 0)}`)
                            .join(" ")
                        : ""
                    } Z`
                  : "";
              return (
                <g key={s.key}>
                  {area ? (
                    <>
                      <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.34 }} />
                          <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0.02 }} />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill={`url(#${gradientId})`} className="ui-chart-area" />
                    </>
                  ) : null}
                  <polyline className="ui-chart-line" points={linePoints.join(" ")} style={{ stroke: s.color }} />
                  {values.map((value, index) => {
                    const point = points[index];
                    if (!point) return null;
                    const active = hovered === index || selectedKey === point.key;
                    const dim = selectedKey !== null && selectedKey !== point.key;
                    return (
                      <circle
                        key={point.key}
                        className={cx("ui-chart-dot", active && "ui-chart-dot-active", dim && "ui-chart-dim")}
                        cx={xAt(index)}
                        cy={scaleY(value)}
                        r={active ? 5 : 3}
                        style={{ stroke: s.color }}
                      />
                    );
                  })}
                </g>
              );
            })}
            {hovered !== null ? (
              <line className="ui-chart-crosshair" x1={xAt(hovered)} x2={xAt(hovered)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
            ) : null}
            {selectedKey !== null
              ? points.map((point, index) =>
                  point.key === selectedKey ? (
                    <line
                      key={point.key}
                      className="ui-chart-crosshair ui-chart-crosshair-selected"
                      x1={xAt(index)}
                      x2={xAt(index)}
                      y1={MARGIN.top}
                      y2={MARGIN.top + plotH}
                    />
                  ) : null,
                )
              : null}
          </g>
        );
      }}
    </SeriesChartFrame>
  );
}

/* ------------------------------------------------------------------ *
 * DonutChart
 * ------------------------------------------------------------------ */

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  ariaLabel: string;
  /** Small caption under the center value (default "Total"). */
  centerLabel?: string;
  formatValue?: (value: number) => string;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  /** Diameter in px (default 168). */
  size?: number;
  /** Legend beside the ring (no wrapping) with tighter rows. */
  compact?: boolean;
  className?: string;
}

/** Distribution ring with a center readout and a clickable legend. */
export function DonutChart({
  slices,
  ariaLabel,
  centerLabel = "Total",
  formatValue = defaultValueFormat,
  selectedKey = null,
  onSelect,
  size = 168,
  compact,
  className,
}: DonutChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const visible = slices.filter((slice) => slice.value > 0);
  const total = visible.reduce((sum, slice) => sum + slice.value, 0);
  const colored = slices.map((slice, index) => ({ ...slice, color: slice.color ?? chartColor(index) }));

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const gap = visible.length > 1 ? 2.5 : 0;
  let offset = 0;

  const focusKey = hoveredKey ?? selectedKey;
  const focused = focusKey ? colored.find((slice) => slice.key === focusKey) : undefined;
  const centerValue = focused ? focused.value : total;
  const centerCaption = focused ? focused.label : centerLabel;

  const toggle = (key: string) => onSelect?.(selectedKey === key ? null : key);

  return (
    <div className={cx("ui-chart ui-donut", compact && "ui-donut-compact", className)}>
      <div className="ui-donut-figure" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={ariaLabel}>
          <circle className="ui-donut-track" cx={100} cy={100} r={radius} />
          {total > 0
            ? colored.map((slice) => {
                if (slice.value <= 0) return null;
                const length = (slice.value / total) * circumference;
                const dash = Math.max(0, length - gap);
                const currentOffset = offset;
                offset += length;
                const dim = selectedKey !== null && selectedKey !== slice.key;
                return (
                  <circle
                    key={slice.key}
                    className={cx(
                      "ui-donut-segment",
                      dim && "ui-chart-dim",
                      (hoveredKey === slice.key || selectedKey === slice.key) && "ui-donut-segment-hot",
                      onSelect && "ui-donut-segment-clickable",
                    )}
                    cx={100}
                    cy={100}
                    r={radius}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-currentOffset}
                    transform="rotate(-90 100 100)"
                    style={{ stroke: slice.color }}
                    onMouseEnter={() => setHoveredKey(slice.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                    onClick={() => toggle(slice.key)}
                  />
                );
              })
            : null}
        </svg>
        <div className="ui-donut-center" aria-hidden="true">
          <span className="ui-donut-center-value">{formatValue(centerValue)}</span>
          <span className="ui-donut-center-caption">{centerCaption}</span>
        </div>
      </div>
      <ul className="ui-donut-legend">
        {colored.map((slice) => {
          const dim = selectedKey !== null && selectedKey !== slice.key;
          const percent = total > 0 ? Math.round((slice.value / total) * 100) : 0;
          const content = (
            <>
              <span className="ui-chart-legend-swatch" style={{ background: slice.color }} />
              <span className="ui-chart-legend-label">{slice.label}</span>
              <span className="ui-chart-legend-value">{formatValue(slice.value)}</span>
              <span className="ui-donut-percent">{percent}%</span>
            </>
          );
          return (
            <li
              key={slice.key}
              className={cx("ui-donut-legend-item", dim && "ui-chart-dim")}
              onMouseEnter={() => setHoveredKey(slice.key)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              {onSelect ? (
                <button
                  type="button"
                  className="ui-chart-legend-button"
                  aria-pressed={selectedKey === slice.key}
                  onClick={() => toggle(slice.key)}
                  onFocus={() => setHoveredKey(slice.key)}
                  onBlur={() => setHoveredKey(null)}
                >
                  {content}
                </button>
              ) : (
                <span className="ui-chart-legend-button">{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * BarList
 * ------------------------------------------------------------------ */

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  /** Small line under the label (client name, model, ...). */
  secondary?: string;
  /** Opens the record; rendered as a trailing chevron link. */
  href?: string;
  color?: string;
  /** Overrides the formatted value text. */
  valueLabel?: string;
}

export interface BarListProps {
  items: BarListItem[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  /** Shown when `items` is empty. */
  emptyLabel?: string;
  /** Default bar color (CSS color); falls back to `--ui-chart-1`. */
  color?: string;
  /** One line per row: name | bar | value (secondary text hidden). */
  compact?: boolean;
  /** Show the secondary text on the label line, after the name. */
  secondaryInline?: boolean;
  className?: string;
}

/** Ranked horizontal bars: label, value, secondary text, optional record link. */
export function BarList({
  items,
  ariaLabel,
  formatValue = defaultValueFormat,
  selectedKey = null,
  onSelect,
  emptyLabel = "Nothing to show yet",
  color,
  compact,
  secondaryInline,
  className,
}: BarListProps) {
  if (items.length === 0) {
    return <p className={cx("ui-barlist-empty", className)}>{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.value), 1);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <ol className={cx("ui-barlist", compact && "ui-barlist-compact", secondaryInline && "ui-barlist-inline-secondary", className)} aria-label={ariaLabel}>
      {items.map((item, index) => {
        const dim = selectedKey !== null && selectedKey !== item.key;
        const valueText = item.valueLabel ?? formatValue(item.value);
        const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
        const body = (
          <>
            <span className="ui-barlist-rank">{index + 1}</span>
            <span className="ui-barlist-text">
              <span className="ui-barlist-label">{item.label}</span>
              {item.secondary ? <span className="ui-barlist-secondary">{item.secondary}</span> : null}
            </span>
            <span className="ui-barlist-value">{valueText}</span>
            <span className="ui-barlist-track" aria-hidden="true">
              <span
                className="ui-barlist-fill"
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: item.color ?? color ?? "var(--ui-chart-1)" }}
              />
            </span>
          </>
        );
        const title = `${item.label}: ${valueText} (${share}% of list)`;
        return (
          <li
            key={item.key}
            className={cx("ui-barlist-row", dim && "ui-chart-dim", selectedKey === item.key && "ui-barlist-row-selected")}
          >
            {onSelect ? (
              <button
                type="button"
                className="ui-barlist-main"
                title={title}
                aria-pressed={selectedKey === item.key}
                onClick={() => onSelect(selectedKey === item.key ? null : item.key)}
              >
                {body}
              </button>
            ) : (
              <div className="ui-barlist-main" title={title}>
                {body}
              </div>
            )}
            {item.href ? (
              <Link className="ui-barlist-link" href={item.href} aria-label={`Open ${item.label}`}>
                <ChevronRight />
              </Link>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * StackedBar
 * ------------------------------------------------------------------ */

export interface StackedBarProps {
  slices: DonutSlice[];
  ariaLabel: string;
  /** Caption above the bar (the dimension, e.g. "Work orders"). */
  title?: string;
  formatValue?: (value: number) => string;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  className?: string;
}

/** 100%-stacked horizontal bar (14px) with a two-column legend of label +
 * count. Segments and legend items are toggle buttons when `onSelect` is set. */
export function StackedBar({
  slices,
  ariaLabel,
  title,
  formatValue = defaultValueFormat,
  selectedKey = null,
  onSelect,
  className,
}: StackedBarProps) {
  const colored = slices.map((slice, index) => ({ ...slice, color: slice.color ?? chartColor(index) }));
  const total = colored.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const toggle = (key: string) => onSelect?.(selectedKey === key ? null : key);
  return (
    <div className={cx("ui-chart ui-stacked-bar", className)}>
      {title ? (
        <div className="ui-stacked-bar-title">
          <span>{title}</span>
          <span className="ui-stacked-bar-total">{formatValue(total)}</span>
        </div>
      ) : null}
      <div className="ui-stacked-bar-track" role="group" aria-label={ariaLabel}>
        {total === 0 ? <span className="ui-stacked-bar-empty">No data</span> : null}
        {colored.map((slice) => {
          if (slice.value <= 0) return null;
          const percent = Math.round((slice.value / total) * 100);
          const dim = selectedKey !== null && selectedKey !== slice.key;
          return (
            <button
              key={slice.key}
              type="button"
              className={cx("ui-stacked-bar-segment", dim && "ui-chart-dim")}
              style={{ flexGrow: slice.value, background: slice.color }}
              title={`${slice.label}: ${formatValue(slice.value)} (${percent}%)`}
              aria-label={`${slice.label}: ${formatValue(slice.value)}, ${percent}%`}
              aria-pressed={onSelect ? selectedKey === slice.key : undefined}
              disabled={!onSelect}
              onClick={() => toggle(slice.key)}
            />
          );
        })}
      </div>
      <ul className="ui-stacked-bar-legend">
        {colored.map((slice) => {
          const dim = selectedKey !== null && selectedKey !== slice.key;
          const content = (
            <>
              <span className="ui-chart-legend-swatch" style={{ background: slice.color }} />
              <span className="ui-chart-legend-label">{slice.label}</span>
              <span className="ui-chart-legend-value">{formatValue(slice.value)}</span>
            </>
          );
          return (
            <li key={slice.key} className={cx(dim && "ui-chart-dim")}>
              {onSelect ? (
                <button
                  type="button"
                  className="ui-chart-legend-button"
                  aria-pressed={selectedKey === slice.key}
                  onClick={() => toggle(slice.key)}
                >
                  {content}
                </button>
              ) : (
                <span className="ui-chart-legend-button">{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
