"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Pencil, Trash2 } from "@yourorg/ui/icons";

/** Width of a revealed action button, px — also the swipe distance that
 * counts as a deliberate reveal (half of it is the "did they mean it"
 * threshold on release, same idea as `pull-to-refresh.tsx`'s own
 * `PULL_THRESHOLD`). */
const REVEAL_WIDTH = 88;
const SWIPE_THRESHOLD = REVEAL_WIDTH / 2;

/**
 * Swipe-to-reveal row (product feedback, 2026-09-13, Hours tab) — dragging
 * the content right reveals a green Edit button on the left (an `onEdit`
 * tap opens the hour/minute correction sheet); dragging it left reveals a
 * red Delete button on the right (an `onDelete` tap removes the row
 * outright, no extra confirm — same "the swipe-then-tap gesture already IS
 * the confirmation" convention as the Mail-app pattern this mirrors).
 * Either handler can be omitted (a row with nothing to offer, e.g. a
 * server-synced entry or the currently-running period — see
 * `hours-section.tsx`) and the row is then inert: no reveal, no drag.
 *
 * Native pointer events, no gesture library — same "no external drawing
 * library" convention `signature-pad.tsx` and `pull-to-refresh.tsx` already
 * establish in this app. `touch-action: pan-y` on the draggable content (not
 * `none`, unlike the signature canvas) deliberately leaves native vertical
 * scroll of the page alone; only horizontal drags are captured here.
 */
export function SwipeableRow({
  children,
  onEdit,
  onDelete,
}: {
  children: ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startOffsetRef = useRef(0);
  const draggingRef = useRef(false);

  const maxLeft = onEdit ? REVEAL_WIDTH : 0;
  const maxRight = onDelete ? REVEAL_WIDTH : 0;
  const swipeable = maxLeft > 0 || maxRight > 0;

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeable) return;
    startXRef.current = event.clientX;
    startOffsetRef.current = offset;
    draggingRef.current = true;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || startXRef.current === null) return;
    const delta = event.clientX - startXRef.current;
    setOffset(Math.min(maxLeft, Math.max(-maxRight, startOffsetRef.current + delta)));
  }

  function handlePointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    startXRef.current = null;
    setDragging(false);
    setOffset((current) => {
      if (current > SWIPE_THRESHOLD) return maxLeft;
      if (current < -SWIPE_THRESHOLD) return -maxRight;
      return 0;
    });
  }

  function runAction(action?: () => void) {
    setOffset(0);
    action?.();
  }

  return (
    <div className="ui-swipe-row">
      {onEdit && (
        <div className="ui-swipe-row-actions ui-swipe-row-actions-left" style={{ width: REVEAL_WIDTH }}>
          <button
            type="button"
            className="ui-swipe-row-action ui-swipe-row-action-edit"
            onClick={() => runAction(onEdit)}
          >
            <Pencil aria-hidden width={18} height={18} />
            Edit
          </button>
        </div>
      )}
      {onDelete && (
        <div className="ui-swipe-row-actions ui-swipe-row-actions-right" style={{ width: REVEAL_WIDTH }}>
          <button
            type="button"
            className="ui-swipe-row-action ui-swipe-row-action-delete"
            onClick={() => runAction(onDelete)}
          >
            <Trash2 aria-hidden width={18} height={18} />
            Delete
          </button>
        </div>
      )}
      <div
        className={dragging ? "ui-swipe-row-content ui-swipe-row-content-dragging" : "ui-swipe-row-content"}
        style={{ transform: `translateX(${offset}px)`, touchAction: swipeable ? "pan-y" : undefined }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {children}
      </div>
    </div>
  );
}
