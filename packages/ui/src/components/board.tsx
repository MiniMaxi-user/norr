import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

/**
 * Board — generic horizontally-scrollable column board (Kanban), issue #58.
 * Fills the design-system gap `clients-kanban.tsx` used to flag in its own
 * doc comment ("the `@yourorg/ui` stub has no non-sticky horizontal
 * row/grid primitive today... a generic `Board`/`Columns` primitive").
 *
 * Deliberately hook-free, matching this package's established convention for
 * every compound component reachable from the main `dist/index.js` entry
 * (`Dialog`, `DropdownMenu`, `CommandPalette`, `Timeline`, ...) — see
 * `dropdown-menu.tsx`'s own doc comment for why: this file is bundled
 * alongside dozens of other components reachable from Server Components, and
 * Next's RSC compiler rejects ANY hook usage anywhere in a file reached that
 * way. Drag-and-drop STATE (which card is being dragged, optimistic column
 * membership, ...) and EVENT HANDLERS belong entirely to the "use client"
 * call site (see `app/(app)/clients/clients-kanban.tsx`) — `Board`/
 * `Board.Column`/`Board.Card` just render boxes and forward whatever
 * `draggable`/`onDragStart`/`onDragEnd`/`onDragOver`/`onDrop`/`onClick` props
 * the caller passes down (all already covered by `HTMLAttributes`, so no
 * bespoke prop needs declaring for any of them — plain `...rest` spreading
 * is enough). No dedicated tsup client-boundary entry needed for the same
 * reason (see tsup.config.ts's top comment: that machinery is only for a
 * component that owns its OWN internal hooks/state).
 *
 * The 4 stage colors/tints (Lead/Qualified/Proposal/Won) are an app-level
 * concern, not this primitive's — `Board.Column` accepts a plain
 * `accentColor`/`tint` pair (CSS color values, repointed onto two
 * `--ui-board-column-*` custom properties consumed in `styles.css`) rather
 * than a fixed variant union, so any future board (a different module's own
 * kanban) can supply its own palette without this file needing to know about
 * it.
 *
 * ```tsx
 * <Board>
 *   <Board.Column label="Lead" count={3} subtitle="€ 42k" accentColor="var(--ui-gray-600)" tint="var(--ui-gray-50)"
 *     onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, "lead")}>
 *     <Board.Card draggable onDragStart={() => setDragging(client.id)} onClick={() => onEdit(client)}>
 *       ...
 *     </Board.Card>
 *   </Board.Column>
 * </Board>
 * ```
 */
export interface BoardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

function BoardRoot({ className, children, ...rest }: BoardProps) {
  return (
    <div className={cx("ui-board", className)} {...rest}>
      {children}
    </div>
  );
}

export interface BoardColumnProps extends HTMLAttributes<HTMLDivElement> {
  /** Column heading, e.g. "Lead". */
  label: ReactNode;
  /** Small count badge beside the label, e.g. the number of visible cards —
   * omitted entirely (not rendered as "0") when left `undefined`. */
  count?: number;
  /** Secondary line under the header, e.g. a column total ("€ 42k") — plain
   * `ReactNode` so a caller can style/compose it freely. */
  subtitle?: ReactNode;
  /** Top-border + count-badge color for this column, e.g. a status color —
   * any valid CSS color (including a `var(--ui-*)` token reference). Falls
   * back to a neutral border when omitted. */
  accentColor?: string;
  /** Background tint for the whole column — same "any valid CSS color"
   * contract as `accentColor`. Falls back to the ordinary surface tint when
   * omitted. */
  tint?: string;
  children?: ReactNode;
}

function BoardColumn({
  label,
  count,
  subtitle,
  accentColor,
  tint,
  className,
  style,
  children,
  ...rest
}: BoardColumnProps) {
  const columnStyle = {
    ...style,
    ...(accentColor ? { "--ui-board-column-accent": accentColor } : {}),
    ...(tint ? { "--ui-board-column-tint": tint } : {}),
  } as CSSProperties;

  return (
    // `...rest` carries `onDragOver`/`onDrop` (HTML5 DnD requires
    // `event.preventDefault()` in the caller's own `onDragOver` for a drop to
    // be accepted at all — this component has no opinion on that, it just
    // forwards whatever the caller passes) alongside any other native div
    // attribute the call site wants to set directly on the column surface.
    <div className={cx("ui-board-column", className)} style={columnStyle} {...rest}>
      <div className="ui-board-column-header">
        <span className="ui-board-column-label">{label}</span>
        {count !== undefined && <span className="ui-board-column-count">{count}</span>}
      </div>
      {subtitle !== undefined && <div className="ui-board-column-subtitle">{subtitle}</div>}
      <div className="ui-board-column-body">{children}</div>
    </div>
  );
}

export interface BoardCardProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

/** One draggable card within a `Board.Column`. `draggable`/`onDragStart`/
 * `onDragEnd`/`onClick` are all plain `HTMLAttributes`, forwarded straight
 * through via `...rest` — this component owns none of that STATE itself
 * (see the file doc comment); it's still responsible for its own baseline
 * accessibility, though, same as any other actionable design-system surface.
 * Drag-and-drop has no keyboard equivalent by nature (see the call site for
 * the actual non-drag alternative this needs — e.g. a per-card status
 * control), but a card with an `onClick` (e.g. "open this record") MUST
 * still be operable without a mouse: `tabIndex=0` + `role="button"` +
 * Enter/Space triggering the same `onClick` is plain derived-from-props
 * logic, not component state, so it stays inside this file's "no hooks"
 * rule while fixing what would otherwise be a real keyboard-trap (a card
 * with literally no way to open it without a mouse). Only added when the
 * caller actually passes `onClick` — a card with none has nothing to
 * trigger and shouldn't intercept Tab stops for no reason. */
function BoardCard({ className, onClick, onKeyDown, tabIndex, role, children, ...rest }: BoardCardProps) {
  const isActionable = Boolean(onClick);
  return (
    <article
      className={cx("ui-board-card", className)}
      onClick={onClick}
      tabIndex={tabIndex ?? (isActionable ? 0 : undefined)}
      role={role ?? (isActionable ? "button" : undefined)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (isActionable && !event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick?.(event as unknown as Parameters<NonNullable<typeof onClick>>[0]);
        }
      }}
      {...rest}
    >
      {children}
    </article>
  );
}

BoardRoot.Column = BoardColumn;
BoardRoot.Card = BoardCard;

export const Board = BoardRoot;
