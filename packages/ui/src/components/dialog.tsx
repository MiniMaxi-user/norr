import type { HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
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
 *
 * Portaled to `document.body` (issue #101) — every real call site renders
 * its trigger `Button` and this `Dialog` as siblings in one fragment (e.g.
 * `CreateArticleButton`, `CreateActivityButton`), and that fragment gets
 * mounted wherever the caller's own JSX happens to place it, which is very
 * often inside a `Toolbar` (Articles'/Activities' filter-bar toolbar,
 * `Toolbar.Section align="end"`). `.ui-toolbar` has `backdrop-filter:
 * blur(10px)` for its glass effect (styles.css), and `backdrop-filter` —
 * like `filter`/`transform`/`perspective`/`contain`/`will-change` naming one
 * of those — makes the element it's on the containing block for ANY
 * `position: fixed` descendant, instead of the viewport. `.ui-dialog-overlay`
 * and `.ui-dialog-panel`/`.ui-dialog-panel-lg` are all `position: fixed`, so
 * nested inside a `Toolbar` they silently resolved against the toolbar's own
 * (short, offset-from-the-true-top) box instead of the real viewport: `top:
 * 0` landed at the toolbar's own on-page position (below the page heading,
 * matching the reported "starts below the header" symptom exactly), while
 * `height: 100dvh` still computed against the true viewport (`dvh`/`vh`
 * units are always viewport-relative, never containing-block-relative) — so
 * the panel's bottom edge, footer included, overflowed off the bottom of the
 * visible viewport by however far the toolbar sat from the true top. Clients'
 * `NewClientPanel`/`EditClientPanel` never exhibited this because they're
 * mounted at the page's own `Stack` level, never inside a `Toolbar` — not
 * because panels are special-cased there, just incidental DOM placement,
 * which is exactly the kind of per-call-site fragility this class of bug
 * produces (any future call site placed inside a `backdrop-filter`/
 * `transform`/`contain` ancestor — `.ui-toolbar` or otherwise — would trip
 * the same thing). `DropdownMenu.Content` hit the identical
 * `.ui-toolbar`/`backdrop-filter` interaction for its own `position: fixed`
 * click-catching backdrop and fixed it the same way — see that file's own
 * doc comment for the full mechanism. Portaling the whole overlay (which
 * contains the dialog/panel surface) to `document.body` — a real DOM sibling
 * of every such ancestor — guarantees it always resolves against the true
 * viewport regardless of where a call site mounts the trigger, which is the
 * generic fix: no per-call-site CSS overrides, no rule about where a
 * `Dialog` is/isn't allowed to be rendered. `typeof document` guards the
 * (never actually hit, since `open` only ever becomes `true` from
 * post-hydration client state owned by an already-`"use client"` call site)
 * case of this rendering during SSR, where there is no `document` — same
 * guard `DropdownMenu.Content` uses. `createPortal` is a plain function, not
 * a hook, so this file stays hook-free and needs no dedicated client-
 * boundary build entry (see the file's top doc comment, and
 * `dropdown-menu.tsx`, which already does exactly this from the package's
 * main non-"use client" entry).
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

  if (typeof document === "undefined") return null;

  return createPortal(
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
    </div>,
    document.body,
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
