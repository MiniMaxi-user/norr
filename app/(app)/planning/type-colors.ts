import type { CSSProperties } from "react";
import { toneFromColor } from "@yourorg/ui/web";

/**
 * Base colour of an activity type on the Planning page (DS 07 section 4).
 * The colour comes from the type item itself (Settings > Activity types, a
 * named palette value or a hex code) — never from the type's name. Named
 * values map to the design system's seed tones (red, green, teal, gold,
 * otherwise neutral grey); an explicit hex code is used as-is. Block
 * background (11%), border (35%) and dot (100%) are derived in CSS from this
 * one value via `--type-color`.
 */
const TONE_HEX = {
  danger: "#b2503f",
  success: "#4f8a4a",
  info: "#0f6d80",
  warning: "#8a6522",
  neutral: "#61716b",
} as const;

export function typeBaseColor(color: string | null | undefined): string {
  const trimmed = (color ?? "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  return TONE_HEX[toneFromColor(trimmed)];
}

/** Inline style that feeds the `--type-color` custom property. */
export function typeColorStyle(color: string | null | undefined): CSSProperties {
  return { ["--type-color" as string]: typeBaseColor(color) } as CSSProperties;
}
