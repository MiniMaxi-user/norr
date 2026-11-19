import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

/**
 * Field-PWA layout primitives (issue #222, DS "08 PWA"). Hook-free and
 * server-safe, styling is `pwa.css` (loaded by the PWA only). Visual
 * primitives that exist on web (Badge, Button, Card, StatusBadge,
 * TypeBadge) are NOT redefined here — the PWA uses the same components with
 * `size="touch"`.
 */

/** Wrapper of one screen inside the shell's scroll area: page header on top,
 * content below. */
export function PwaScreen({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("pwa-screen", className)} {...rest}>
      {children}
    </div>
  );
}

export interface PwaPageHeaderProps {
  /** Row above the title (status badge + time slot on a work order). */
  top?: ReactNode;
  /** Mono overline above the title (Today: the date). */
  overline?: ReactNode;
  title: ReactNode;
  /** Rows below the title: badges, type badge + client link, address. */
  children?: ReactNode;
}

/** Navy page header that continues seamlessly under the app bar. */
export function PwaPageHeader({ top, overline, title, children }: PwaPageHeaderProps) {
  return (
    <header className="pwa-header">
      {top ? <div className="pwa-header-row">{top}</div> : null}
      {overline ? <p className="pwa-header-overline">{overline}</p> : null}
      <h1 className="pwa-header-title">{title}</h1>
      {children}
    </header>
  );
}

/** A flex row of badges / links inside the page header. */
export function PwaHeaderRow({ children }: { children?: ReactNode }) {
  return <div className="pwa-header-row">{children}</div>;
}

/** Mono time slot next to the status badge ("14:00-16:00"). */
export function PwaHeaderTime({ children }: { children?: ReactNode }) {
  return <span className="pwa-header-time">{children}</span>;
}

/** Muted line under the header title (the address). */
export function PwaHeaderMeta({ children }: { children?: ReactNode }) {
  return <p className="pwa-header-meta">{children}</p>;
}

/** Content on `surface-page`: 16px screen padding, 14px gap between cards. */
export function PwaBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("pwa-body", className)} {...rest}>
      {children}
    </div>
  );
}

export function PwaStack({
  gap = "md",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { gap?: "sm" | "md" }) {
  return (
    <div className={cx("pwa-stack", className)} data-gap={gap} {...rest}>
      {children}
    </div>
  );
}

export function PwaRow({
  justify,
  wrap,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { justify?: "between"; wrap?: boolean }) {
  return (
    <div className={cx("pwa-row", className)} data-justify={justify} data-wrap={wrap ? "true" : undefined} {...rest}>
      {children}
    </div>
  );
}

/** Mono overline label for a group of cards ("Now", "Later today"). */
export function PwaOverline({ children }: { children?: ReactNode }) {
  return <p className="pwa-overline">{children}</p>;
}

/** A labelled group of cards. */
export function PwaSection({ label, children }: { label: ReactNode; children?: ReactNode }) {
  return (
    <section className="pwa-section">
      <PwaOverline>{label}</PwaOverline>
      {children}
    </section>
  );
}

/** One calm 13px line (explanations, helper text). */
export function PwaNote({
  align,
  tone,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & { align?: "center"; tone?: "danger" }) {
  return (
    <p className="pwa-note" data-align={align} data-tone={tone} {...rest}>
      {children}
    </p>
  );
}

/** Sync line: one centred muted line under the content. */
export function PwaSyncLine({ children }: { children?: ReactNode }) {
  return <p className="pwa-sync">{children}</p>;
}

/** Fixed action bar above the bottom bar: the one primary action of a screen
 * (plus its error line). */
export function PwaActionBar({ children }: { children?: ReactNode }) {
  return <div className="pwa-actionbar">{children}</div>;
}

/** Floating primary action (issue #223, "+ Work order" on Today): a navy pill
 * pinned to the bottom-right of the scroll area, above the nav bar. Render it
 * as the LAST child of `PwaScreen` (it is `position: sticky`). */
export function PwaFab({ className, type = "button", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div className="pwa-fab-slot">
      <button type={type} className={cx("pwa-fab", className)} {...rest}>
        {children}
      </button>
    </div>
  );
}

export interface PwaKeyValueRow {
  label: ReactNode;
  value: ReactNode;
  /** IDs and numbers in the mono face. */
  mono?: boolean;
  /** Reference/ID that points at a record: link colour (`text-link`). */
  link?: boolean;
}

/** Key/value card body: 48px rows, muted label left, value right. Put it
 * inside a `WebCard size="touch"`. */
export function PwaKeyValue({ rows }: { rows: PwaKeyValueRow[] }) {
  return (
    <dl className="pwa-kv">
      {rows.map((row, index) => (
        <div className="pwa-kv-row" key={index}>
          <dt className="pwa-kv-label">{row.label}</dt>
          <dd className="pwa-kv-value" data-mono={row.mono ? "true" : undefined} data-link={row.link ? "true" : undefined}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Running text body of a card (description, notes). */
export function PwaCardText({ empty, children }: { empty?: boolean; children?: ReactNode }) {
  return (
    <p className="pwa-card-text" data-empty={empty ? "true" : undefined}>
      {children}
    </p>
  );
}

/** Padded body of a card that holds controls (fields, buttons). */
export function PwaCardPad({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("pwa-card-pad", className)} {...rest}>
      {children}
    </div>
  );
}

/** Action buttons in a card: side by side, equal width. Unavailable actions
 * are disabled and explained in `hint`. */
export function PwaActions({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="pwa-actions">{children}</div>
      {hint ? <p className="pwa-actions-hint">{hint}</p> : null}
    </>
  );
}
