import type { ReactNode } from "react";
import { cx } from "../cx";
import { Text } from "./typography";

export interface KeyValueListItem {
  /** Stable React key when `index` alone would be unstable (e.g. rows can be
   * conditionally omitted). Falls back to `index` when omitted. */
  key?: string;
  label: ReactNode;
  /** Rendered as-is — NOT force-wrapped in `<Text>`. Most rows pass a plain
   * string/`<Text>` node, but some (e.g. a "View activity" link) need to pass
   * a raw `<Link>` instead, so this stays flexible rather than opinionated. */
  value: ReactNode;
}

export interface KeyValueListProps {
  items: KeyValueListItem[];
  className?: string;
}

/**
 * A record's "Assigned to / Scheduled for / …" facts (issue #102) —
 * full-width label-left/value-right rows with a hairline divider between
 * them, distinct from `DefinitionList`'s two-column grid (which reads better
 * for a short label + long value pair, not a list of short label/value pairs
 * that each want the full row width). Generalized from the work order
 * Assignment section's key/value list (issue #107) so any future record
 * detail page (Quotes, Projects, Orders) can reuse the same shape.
 */
export function KeyValueList({ items, className }: KeyValueListProps) {
  return (
    <div className={cx("ui-kv-list", className)}>
      {items.map((item, index) => (
        <div className="ui-kv-row" key={item.key ?? index}>
          <Text tone="muted">{item.label}</Text>
          {item.value}
        </div>
      ))}
    </div>
  );
}
