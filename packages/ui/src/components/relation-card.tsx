import type { ReactNode } from "react";
import { cx } from "../cx";
import type { Icon } from "../icons";
import { ChevronDown, Pencil } from "../icons";
import { Card } from "./card";
import { IconButton } from "./button";

export interface RelationCardProps {
  icon: Icon;
  /** Small uppercase mono eyebrow label, e.g. "Client"/"Site"/"Asset"/
   * "Contract". */
  label: string;
  /** The linked record's name — pass a `<Link>` (or plain text when the
   * related entity has no detail page of its own, e.g. a Site). Omit (along
   * with `subtitle`) while nothing is selected yet. */
  title?: ReactNode;
  /** One or two key facts, already formatted/joined by the caller (e.g. "KvK
   * 30146980 · H. Dijkstra"). */
  subtitle?: ReactNode;
  loading?: boolean;
  /** Shown instead of `title`/`subtitle` when nothing is linked yet — a
   * work order's brand-new (create-mode) relation cards start here, which is
   * expected, not an error state. */
  emptyText?: string;
  /** Opens the small edit popup for this relation — omitted entirely
   * (rather than disabled) in `readOnly` contexts, per this app's own
   * "never render an affordance RLS would just reject" convention. */
  onEdit?: () => void;
  editLabel?: string;
  /** Extra detail revealed on hover (issue #106) — a small chevron trigger in
   * the card's bottom-right corner. ONLY hovering/focusing that trigger
   * reveals this content (hovering the rest of the card — title, subtitle,
   * Edit button — does nothing); the revealed panel is a floating overlay
   * (`position: absolute`), not a participant in document flow, so it
   * expands OVER whatever sits below the card instead of pushing it down.
   * Pure CSS (no JS state), matching this design system's `Tooltip`
   * "CSS-only hover" convention — see the trigger/panel rules in
   * `styles.css` for how the nested-hover DOM structure keeps it open while
   * the pointer moves from the icon into the panel. Omit for a card with
   * nothing further to show. */
  expandedContent?: ReactNode;
  className?: string;
}

/**
 * A compact "linked record" card — icon + eyebrow label, the record's own
 * name/link, a one-line subtitle of key facts, and a small Edit affordance —
 * from the work order detail redesign (issue #102: Client/Site/Asset/
 * Contract cards, each individually re-pickable via its own Edit button).
 * Generic enough for any top-level entity's own "related record" summary
 * card, not work-order-specific.
 *
 * Issue #106 added `expandedContent` — an optional icon-triggered hover-expand
 * overlay, see that prop's own doc comment.
 */
export function RelationCard({
  icon: IconComp,
  label,
  title,
  subtitle,
  loading,
  emptyText = "Not set",
  onEdit,
  editLabel = "Edit",
  expandedContent,
  className,
}: RelationCardProps) {
  return (
    <Card className={cx("ui-relation-card", expandedContent ? "ui-relation-card-expandable" : undefined, className)}>
      <div className="ui-relation-card-head">
        <span className="ui-relation-card-eyebrow">
          <IconComp />
          {label}
        </span>
        {onEdit && (
          <IconButton variant="ghost" aria-label={editLabel} onClick={onEdit}>
            <Pencil />
          </IconButton>
        )}
      </div>
      {loading ? (
        <span className="ui-relation-card-empty">Loading…</span>
      ) : title ? (
        <div className="ui-relation-card-body">
          <span className="ui-relation-card-title">{title}</span>
          {subtitle && <span className="ui-relation-card-subtitle">{subtitle}</span>}
        </div>
      ) : (
        <span className="ui-relation-card-empty">{emptyText}</span>
      )}
      {expandedContent && (
        <span
          className="ui-relation-card-expand-trigger"
          tabIndex={0}
          role="button"
          aria-label={`Show more ${label.toLowerCase()} details`}
        >
          <ChevronDown className="ui-relation-card-expand-icon" aria-hidden="true" />
          <div className="ui-relation-card-expand-panel">
            <div className="ui-relation-card-expand-inner">{expandedContent}</div>
          </div>
        </span>
      )}
    </Card>
  );
}
