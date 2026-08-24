import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type BadgeVariant = "muted" | "accent" | "success" | "danger" | "warning";

/**
 * Named swatch palette for tenant-configurable colors (mirrors
 * `REFERENCE_ITEM_COLOR_PALETTE` in the app's `lib/reference-lists/schema.ts`
 * — duplicated here as a plain literal map, not imported, since this package
 * must stay app-agnostic). A reference-list item's `color` (Asset Type/
 * Status today, more picklists later) is either one of these names or a raw
 * hex code — `Badge`'s `color` prop accepts either.
 */
const NAMED_BADGE_COLORS: Record<string, string> = {
  gray: "#6b7280",
  red: "#dc2626",
  orange: "#ea580c",
  amber: "#d97706",
  yellow: "#ca8a04",
  lime: "#65a30d",
  green: "#16a34a",
  teal: "#0d9488",
  cyan: "#0891b2",
  blue: "#2563eb",
  indigo: "#4f46e5",
  violet: "#7c3aed",
  pink: "#db2777",
};

function normalizeHex(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = match[1]!;
  if (value.length === 3) {
    return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`;
  }
  return `#${value}`;
}

function resolveColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) return normalizeHex(trimmed);
  return NAMED_BADGE_COLORS[trimmed] ?? null;
}

/** Light tint background + full-strength text/border, same visual formula
 * every fixed `variant` already uses (see `.ui-badge-*` in styles.css) —
 * computed at render time via hex + alpha since an arbitrary tenant color
 * can't be a static CSS class. */
function colorStyle(hex: string): CSSProperties {
  return {
    backgroundColor: `${hex}1a`,
    borderColor: `${hex}40`,
    color: hex,
  };
}

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "color"> {
  variant?: BadgeVariant;
  /**
   * Tenant-configurable custom color — a hex code (`#22c55e`) or one of the
   * named swatches from `REFERENCE_ITEM_COLOR_PALETTE` (`"blue"`, `"green"`,
   * etc). Takes precedence over `variant` when recognized; falls back to
   * `variant`/the default muted look when `color` is absent, `null`, or not
   * a recognized name/hex (e.g. a picklist item with no color set).
   */
  color?: string | null;
  children?: ReactNode;
}

export function Badge({ variant, color, className, style, children, ...rest }: BadgeProps) {
  const hex = resolveColor(color);
  return (
    <span
      className={cx("ui-badge", !hex && variant && `ui-badge-${variant}`, className)}
      style={hex ? { ...colorStyle(hex), ...style } : style}
      {...rest}
    >
      {children}
    </span>
  );
}
