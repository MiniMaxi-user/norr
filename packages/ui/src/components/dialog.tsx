import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type DialogSize = "sm" | "lg" | "panel" | "panel-lg";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: DialogSize;
  children?: ReactNode;
}

/**
 * Dialog / Modal — same `open`/`onOpenChange` contract as `CommandPalette`:
 * clicking the overlay calls `onOpenChange(false)`. Deliberately has no
 * internal state/hooks (same as every other component re-exported from the
 * package's main entry, aside from `ThemeProvider`/`Tabs`, which are their
 * own dedicated "use client" entries — see tsup.config.ts) — this file is
 * bundled together with dozens of hook-free components into one
 * `dist/index.js`, and that whole file is reachable from Server Components
 * (e.g. `app/layout.tsx` importing `ThemeProvider`), so Next's RSC compiler
 * would reject ANY hook usage anywhere in it. There is no built-in
 * Escape-key handling or close button, same as before — compose one into
 * `Dialog.Header` yourself (e.g. an `IconButton` calling
 * `onOpenChange(false)`), and see `useEscapeToClose` (app-level) for
 * Escape — both are the call site's job, since a call site is always
 * already a "use client" component (it owns `open` state), so hooks are
 * cheap to add there with zero RSC-boundary risk.
 *
 * Scroll fix: the dialog surface is capped at `max-height: 85vh` and is a
 * column flexbox; `Dialog.Header`/`Dialog.Footer` are `flex-shrink: 0`
 * (pinned) and `Dialog.Body` is `flex: 1; min-height: 0; overflow-y: auto`.
 * That `min-height: 0` is the actual fix for "can't scroll a tall form": a
 * flex child's default `min-height` is `auto` (its content's height), which
 * stops it from ever shrinking below that — so with `min-height` left at
 * `auto`, the body never actually engaged `overflow-y: auto`, it just grew
 * past `max-height` and got silently clipped by the dialog surface's
 * `overflow: hidden` instead of scrolling. See styles.css `.ui-dialog-body`.
 *
 * `size="panel"` is a different shape entirely — a full-height sheet
 * anchored to the right edge of the viewport (`position: fixed`, so it
 * escapes `.ui-dialog-overlay`'s flex centering rather than needing it) that
 * slides in from the right, for a record-editing form that wants more width
 * and less forced vertical scrolling than a centered card. It reuses the
 * exact same column-flexbox scroll fix described above — a panel tall
 * enough to overflow a short viewport still scrolls its `Dialog.Body`
 * correctly, that architecture didn't change. See `.ui-dialog-panel` in
 * styles.css.
 *
 * `size="panel-lg"` is the same right-edge sheet, just wider (see
 * `.ui-dialog-panel-lg` in styles.css) — for a single form that outgrows the
 * default panel width (e.g. Articles, issue #98) without widening every
 * other panel in the app. Prefer `"panel"` unless a specific form's own
 * field count/layout genuinely needs the extra room.
 */
export function Dialog({ open, onOpenChange, size, children }: DialogProps) {
  if (!open) return null;

  // Close-on-outside-click needs the *press* to have started on the overlay
  // itself, not just the *release* — a plain `onClick` fires on the nearest
  // common ancestor of the mousedown and mouseup targets, so dragging a text
  // selection from an input inside the dialog out past its edge (a normal
  // way to select an email address, say) ends the drag over the overlay and
  // was closing the dialog out from under that selection. `pointerDownOnOverlay`
  // is a plain per-render closure variable, not state — this component is
  // deliberately hook-free (see the file doc comment: it's bundled where the
  // RSC compiler forbids hooks), and a plain variable is sufficient here
  // since a mousedown→click gesture completes synchronously well within one
  // render; the only failure mode if a re-render did land in between is the
  // conservative one (an outside click gets ignored, not a false close).
  let pointerDownOnOverlay = false;

  return (
    <div
      className="ui-dialog-overlay"
      onMouseDown={(event) => {
        pointerDownOnOverlay = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pointerDownOnOverlay && event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className={cx("ui-dialog", size && `ui-dialog-${size}`)}
        role="dialog"
        aria-modal
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export interface DialogSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

function DialogHeader({ className, children, ...rest }: DialogSectionProps) {
  return (
    <div className={cx("ui-dialog-header", className)} {...rest}>
      {children}
    </div>
  );
}

function DialogBody({ className, children, ...rest }: DialogSectionProps) {
  return (
    <div className={cx("ui-dialog-body", className)} {...rest}>
      {children}
    </div>
  );
}

function DialogFooter({ className, children, ...rest }: DialogSectionProps) {
  return (
    <div className={cx("ui-dialog-footer", className)} {...rest}>
      {children}
    </div>
  );
}

Dialog.Header = DialogHeader;
Dialog.Body = DialogBody;
Dialog.Footer = DialogFooter;
