import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

/**
 * Deterministic scatter of decorative "city block" rectangles (percent-based
 * `left`/`top`/`width`/`height`) — no `Math.random()`, so the surface renders
 * identically every time (matches `NordicScene`'s "no raster assets, no
 * randomness" approach). Purely a visual composition device: this is NOT a
 * real map (no tiles, no geocoding) — see the `MapSurface` doc comment.
 */
const DECORATIVE_BLOCKS = [
  { left: 8, top: 14, width: 12, height: 10 },
  { left: 24, top: 10, width: 8, height: 14 },
  { left: 6, top: 58, width: 10, height: 16 },
  { left: 20, top: 70, width: 14, height: 10 },
  { left: 40, top: 6, width: 10, height: 8 },
  { left: 62, top: 12, width: 14, height: 12 },
  { left: 80, top: 8, width: 10, height: 16 },
  { left: 70, top: 38, width: 8, height: 10 },
  { left: 86, top: 55, width: 9, height: 14 },
  { left: 50, top: 60, width: 12, height: 9 },
  { left: 36, top: 78, width: 10, height: 12 },
  { left: 58, top: 82, width: 14, height: 8 },
];

export interface MapSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * A stylized, brand-toned decorative map surface — an abstract road grid +
 * soft terrain tint + scattered "block" shapes, built entirely from
 * `--ui-*` tokens (so it tracks light/dark theme). Deliberately NOT a real
 * map (no Leaflet, no network tiles) — good enough to sell a
 * Planning/dispatch or job-detail "location" composition in a screenshot.
 * Real map integration already exists for Assets at
 * `app/(app)/assets/components/asset-map.tsx` and is out of scope here.
 *
 * Position `MapSurface.Pin`/`MapPinPopup` children absolutely within it via
 * their `x`/`y` percent props.
 *
 * ```tsx
 * <MapSurface style={{ height: 320 }}>
 *   <MapSurface.Pin x={30} y={40} />
 *   <MapSurface.Pin x={55} y={25} active />
 *   <MapPinPopup x={55} y={25} title="HVAC repair" status={<Badge variant="accent">In progress</Badge>} rows={[...]} />
 * </MapSurface>
 * ```
 */
export function MapSurface({ className, children, ...rest }: MapSurfaceProps) {
  return (
    <div className={cx("ui-map-surface", className)} {...rest}>
      <div className="ui-map-surface-terrain" aria-hidden />
      {DECORATIVE_BLOCKS.map((block, index) => (
        <div
          key={index}
          className="ui-map-surface-block"
          aria-hidden
          style={{ left: `${block.left}%`, top: `${block.top}%`, width: `${block.width}%`, height: `${block.height}%` }}
        />
      ))}
      {children}
    </div>
  );
}

export interface MapSurfacePinProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Percent position within the nearest `MapSurface` (0-100). */
  x: number;
  y: number;
  /** Highlighted/selected pin — rendered in the accent color, slightly
   * larger stacking order. */
  active?: boolean;
}

function MapSurfacePin({ x, y, active, className, style, ...rest }: MapSurfacePinProps) {
  return (
    <button
      type="button"
      aria-hidden={rest["aria-label"] ? undefined : true}
      className={cx("ui-map-pin", active && "ui-map-pin-active", className)}
      style={{ left: `${x}%`, top: `${y}%`, ...style }}
      {...rest}
    />
  );
}

export interface MapPinPopupRow {
  label: string;
  value: ReactNode;
}

export interface MapPinPopupProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Percent position within the nearest `MapSurface` (0-100) — anchors the
   * popup above this point, same coordinate space as `MapSurface.Pin`. */
  x: number;
  y: number;
  title: ReactNode;
  status?: ReactNode;
  rows: MapPinPopupRow[];
}

/**
 * Floating "selected pin" detail card — title, an optional status `Badge`,
 * and a few label/value rows, anchored above a point on a `MapSurface`.
 * Genuinely reusable beyond this decorative surface (the real Assets/
 * Planning map views will want the same anchored-popup pattern later), so
 * it's exported as its own component rather than baked into `MapSurface`.
 */
export function MapPinPopup({ x, y, title, status, rows, className, style, ...rest }: MapPinPopupProps) {
  return (
    <div
      className={cx("ui-map-pin-popup", className)}
      style={{ left: `${x}%`, top: `${y}%`, ...style }}
      {...rest}
    >
      <div className="ui-map-pin-popup-header">
        <strong>{title}</strong>
        {status}
      </div>
      <div>
        {rows.map((row, index) => (
          <div className="ui-map-pin-popup-row" key={index}>
            <span className="ui-map-pin-popup-label">{row.label}</span>
            <span className="ui-map-pin-popup-value">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

MapSurface.Pin = MapSurfacePin;
